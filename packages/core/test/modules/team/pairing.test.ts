import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { TeamJoinMessage } from "@ancientvoid/contracts";
import {
  acceptJoin, checkCode, createTeamInvite, invalidate, newPairingWindow,
  pairingCodes, pairingComplete, pairingExporterContext, parseTeamInviteText, teamInviteHash,
} from "../../../src/modules/team/pairing.ts";

/** EPIC-P83 T83.3 (ADR-0118 §7): Kopplungslogik — Einladung, Fenster, Codes, Prüffolge. */

const CERT = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";

describe("EPIC-P83 T83.3 — Einladung (ADR-0118 §7.1)", () => {
  it("erzeugt 128-Bit-Geheimnis, 10 Minuten Gültigkeit, Präfix avteam1., speichert nur den Hash", () => {
    const { invite, secretSha256, text } = createTeamInvite({
      address: "127.0.0.1", port: 7400, spkiSha256: "a".repeat(64), certPem: CERT,
    });
    expect(invite.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(invite.teamId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(Date.parse(invite.expiresAt)).toBeLessThan(Date.now() + 11 * 60_000);
    expect(text.startsWith("avteam1.")).toBe(true);
    expect(text).not.toContain("://");
    expect(secretSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(teamInviteHash(invite.teamId, invite.secret)).toBe(secretSha256);
  });

  it("Einladungstext geht formtreu durch parseTeamInviteText", () => {
    const { invite, text } = createTeamInvite({
      address: "100.64.0.9", port: 7401, spkiSha256: "b".repeat(64), certPem: CERT, teamId: "team-fest",
    });
    const back = parseTeamInviteText(text);
    expect(back).toEqual(invite);
    expect(parseTeamInviteText("avteam1.kein-json")).toBeNull();
    expect(parseTeamInviteText("https://hub.example/invite#x")).toBeNull();
    expect(parseTeamInviteText("")).toBeNull();
  });
});

describe("EPIC-P83 T83.3 — Kopplungsfenster (ADR-0118 §7.1/7.3/7.6)", () => {
  const setup = () => {
    const { invite, secretSha256 } = createTeamInvite({
      address: "127.0.0.1", port: 7400, spkiSha256: "a".repeat(64), certPem: CERT,
    });
    const window = newPairingWindow(invite.teamId, secretSha256, new Date(Date.parse(invite.expiresAt)));
    const join: TeamJoinMessage = {
      v: 1, teamId: invite.teamId, secret: invite.secret,
      profile: { v: 1, instanceId: "B".repeat(43), spkiSha256: "c".repeat(64), certPem: CERT, label: "Bens Hub", protocolVersion: 1 },
    };
    return { invite, window, join };
  };

  it("Beitritt mit richtigem Geheimnis übernimmt das Profil; Ablauf und Wiederverwendung scheitern", () => {
    const { window, join } = setup();
    expect(acceptJoin(window, join, new Date())).toBeNull();
    expect(window.joined?.label).toBe("Bens Hub");
    // einmalig: zweiter Beitritt mit demselben Geheimnis
    expect(acceptJoin(window, join, new Date())).toBe("used");
  });

  it("abgelaufene Einladung wird abgelehnt", () => {
    const { invite, window, join } = setup();
    const late = new Date(Date.parse(invite.expiresAt) + 1000);
    expect(acceptJoin(window, join, late)).toBe("expired");
  });

  it("falsches Geheimnis zählt Fehlversuche; nach fünf ist das Fenster zu (ADR-0118 §7.3)", () => {
    const { window, join } = setup();
    const wrong = { ...join, secret: "AAAAAAAAAAAAAAAAAAAAAA" };
    for (let i = 0; i < 4; i++) expect(acceptJoin(window, wrong, new Date())).toBe("bad_invite");
    expect(acceptJoin(window, wrong, new Date())).toBe("attempts_exhausted");
    expect(acceptJoin(window, join, new Date())).toBe("attempts_exhausted");
  });

  it("Codes: je drei Versuche,_WRONG zählt, Erfolg merkt sich je Seite", () => {
    const { window, join } = setup();
    acceptJoin(window, join, new Date());
    expect(checkCode(window, "a", "00000000", "11112222")).toBe("wrong_code");
    expect(checkCode(window, "a", "11112222", "11112222")).toBeNull();
    expect(checkCode(window, "a", "egal", "11112222")).toBeNull(); // bereits bestätigt
    expect(checkCode(window, "b", "99999999", "33334444")).toBe("wrong_code");
    expect(checkCode(window, "b", "33334444", "33334444")).toBeNull();
    expect(pairingComplete(window)).toBe(true);
  });

  it("drei falsche Code-Eingaben schließen die Seite ab (attempts_exhausted)", () => {
    const { window, join } = setup();
    acceptJoin(window, join, new Date());
    for (let i = 0; i < 3; i++) expect(checkCode(window, "a", "00000000", "11112222")).toBe("wrong_code");
    expect(checkCode(window, "a", "11112222", "11112222")).toBe("attempts_exhausted");
  });

  it("Kopplung gilt erst nach BEIDEN Bestätigungen (ADR-0118 §7.6)", () => {
    const { window, join } = setup();
    acceptJoin(window, join, new Date());
    expect(pairingComplete(window)).toBe(false);
    checkCode(window, "a", "11112222", "11112222");
    expect(pairingComplete(window)).toBe(false);
    checkCode(window, "b", "33334444", "33334444");
    expect(pairingComplete(window)).toBe(true);
  });

  it("invalidate verwirft das Fenster (Abbruch/Neustart)", () => {
    const { window, join } = setup();
    acceptJoin(window, join, new Date());
    invalidate(window);
    expect(window.joined).toBeNull();
    expect(pairingComplete(window)).toBe(false);
    expect(acceptJoin(window, join, new Date())).toBe("used");
  });
});

describe("EPIC-P83 T83.3 — Exporter-Codes (ADR-0118 §7.4)", () => {
  it("achtstellig, deterministisch aus demselben Material, unterschiedlich je Label", () => {
    const a = new Uint8Array([0x00, 0x00, 0x00, 0x2a, 1, 2, 3, 4]);
    const b = new Uint8Array([0x00, 0x00, 0x00, 0x2b, 1, 2, 3, 4]);
    const { codeA, codeB } = pairingCodes(a, b);
    expect(codeA).toMatch(/^\d{8}$/);
    expect(codeB).toMatch(/^\d{8}$/);
    expect(codeA).not.toBe(codeB);
    expect(pairingCodes(a, b)).toEqual({ codeA, codeB });
  });

  it("Exporter-Kontext = teamId + beide SPKI-Hashes", () => {
    const ctx = pairingExporterContext(randomUUID(), "a".repeat(64), "b".repeat(64));
    expect(ctx.toString("utf8")).toContain("\0");
    expect(ctx.length).toBeGreaterThan(64);
  });
});

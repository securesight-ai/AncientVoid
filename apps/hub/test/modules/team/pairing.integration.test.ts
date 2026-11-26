import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateTeamIdentity, newPairingWindow, spkiSha256Hex, createTeamInvite, checkCode, pairingComplete, type TeamTlsMaterial } from "@ancientvoid/core";
import { startPairingServer, joinOverPairing } from "../../../src/modules/team/pairing-server.ts";

/**
 * EPIC-P83 T83.3 (ADR-0118 §7): Kopplungszweck gegen echte Sockets —
 * Einladung → Beitritt über den Kopplungsserver (unbekanntes Client-Zertifikat
 * erlaubt, 5 s Frist) → gleiche Codes auf beiden Seiten aus dem
 * TLS-Exporter (nie übertragen) → Fenster-Regeln (falsches Geheimnis,
 * einmalige Nutzung, Ablauf).
 */

function material(dir: string): Promise<TeamTlsMaterial> {
  return loadOrCreateTeamIdentity(dir).then((f) => ({ identity: f.identity, privateKey: f.privateKey, publicKey: f.publicKey }));
}

describe("EPIC-P83 T83.3 — Kopplungsserver (ADR-0118 §7)", () => {
  let root: string;
  let a: TeamTlsMaterial;
  let b: TeamTlsMaterial;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "av-t83-pair-"));
    a = await material(join(root, "a"));
    b = await material(join(root, "b"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("Beitritt über den Kopplungsserver: beide Seiten leiten dieselben Codes ab (Exporter, nie übertragen)", async () => {
    const spkiA = spkiSha256Hex(a.publicKey);
    const spkiB = spkiSha256Hex(b.publicKey);
    const { invite, secretSha256 } = createTeamInvite({ address: "127.0.0.1", port: 0, spkiSha256: spkiA, certPem: a.identity.certPem });
    const window = newPairingWindow(invite.teamId, secretSha256, new Date(Date.parse(invite.expiresAt)));
    let serverCodes: { codeA: string; codeB: string } | null = null;
    const server = await startPairingServer({
      port: 0,
      material: a,
      window,
      ownSpkiSha256: spkiA,
      onJoined: ({ codes }) => { serverCodes = codes; },
    });
    try {
      const result = await joinOverPairing({
        invite: { ...invite, port: server.port },
        material: b,
        label: "Bens Hub",
        ownSpkiSha256: spkiB,
        ownInstanceId: b.identity.instanceId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(serverCodes).not.toBeNull();
      // Dieselben Codes auf beiden Seiten — ableitbar, nie gesendet.
      expect(result.codes.codeA).toBe(serverCodes!.codeA);
      expect(result.codes.codeB).toBe(serverCodes!.codeB);
      // Zeremonie: A tippt Code B, B tippt Code A (vom eigenen Ende abgeleitet).
      expect(checkCode(window, "a", result.codes.codeB, serverCodes!.codeB)).toBeNull();
      expect(pairingComplete(window)).toBe(false);
      expect(checkCode(window, "b", result.codes.codeA, result.codes.codeA)).toBeNull();
      expect(pairingComplete(window)).toBe(true);
      result.socket.destroy();
    } finally {
      await server.close();
    }
  });

  it("falsches Geheimnis wird abgewiesen; das Fenster bleibt für den echten Beitritt offen (bis Fünf)", async () => {
    const spkiA = spkiSha256Hex(a.publicKey);
    const spkiB = spkiSha256Hex(b.publicKey);
    const { invite, secretSha256 } = createTeamInvite({ address: "127.0.0.1", port: 0, spkiSha256: spkiA, certPem: a.identity.certPem });
    const window = newPairingWindow(invite.teamId, secretSha256, new Date(Date.parse(invite.expiresAt)));
    const server = await startPairingServer({
      port: 0,
      material: a,
      window,
      ownSpkiSha256: spkiA,
      onJoined: () => undefined,
    });
    try {
      const wrong = await joinOverPairing({
        invite: { ...invite, port: server.port, secret: "AAAAAAAAAAAAAAAAAAAAAA" },
        material: b,
        label: "Fremd",
        ownSpkiSha256: spkiB,
        ownInstanceId: b.identity.instanceId,
      });
      expect(wrong.ok).toBe(false);
      if (wrong.ok) return;
      expect(wrong.error, "falsches Geheimnis: " + JSON.stringify(wrong)).toBe("bad_invite");
      // Der echte Beitritt klappt danach noch (Fehlversuch gezählt, Fenster offen).
      const good = await joinOverPairing({
        invite: { ...invite, port: server.port },
        material: b,
        label: "Bens Hub",
        ownSpkiSha256: spkiB,
        ownInstanceId: b.identity.instanceId,
      });
      expect(good.ok).toBe(true);
      if (good.ok) good.socket.destroy();
    } finally {
      await server.close();
    }
  });

  it("wiederverwendete Einladung wird abgewiesen (einmalig)", async () => {
    const spkiA = spkiSha256Hex(a.publicKey);
    const spkiB = spkiSha256Hex(b.publicKey);
    const { invite, secretSha256 } = createTeamInvite({ address: "127.0.0.1", port: 0, spkiSha256: spkiA, certPem: a.identity.certPem });
    const window = newPairingWindow(invite.teamId, secretSha256, new Date(Date.parse(invite.expiresAt)));
    const server = await startPairingServer({
      port: 0,
      material: a,
      window,
      ownSpkiSha256: spkiA,
      onJoined: () => undefined,
    });
    try {
      const first = await joinOverPairing({ invite: { ...invite, port: server.port }, material: b, label: "Bens Hub", ownSpkiSha256: spkiB, ownInstanceId: b.identity.instanceId });
      expect(first.ok).toBe(true);
      if (first.ok) first.socket.destroy();
      const second = await joinOverPairing({ invite: { ...invite, port: server.port }, material: b, label: "Bens Hub", ownSpkiSha256: spkiB, ownInstanceId: b.identity.instanceId });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toBe("used");
    } finally {
      await server.close();
    }
  });

  it("Pin-Prüfung auf B-Seite: abweichender SPKI in der Einladung scheitert am Handshake", async () => {
    const spkiA = spkiSha256Hex(a.publicKey);
    const spkiB = spkiSha256Hex(b.publicKey);
    const { invite, secretSha256 } = createTeamInvite({ address: "127.0.0.1", port: 0, spkiSha256: "f".repeat(64), certPem: a.identity.certPem });
    const window = newPairingWindow(invite.teamId, secretSha256, new Date(Date.parse(invite.expiresAt)));
    const server = await startPairingServer({
      port: 0,
      material: a,
      window,
      ownSpkiSha256: spkiA,
      onJoined: () => undefined,
    });
    try {
      const result = await joinOverPairing({ invite: { ...invite, port: server.port }, material: b, label: "Bens Hub", ownSpkiSha256: spkiB, ownInstanceId: b.identity.instanceId });
      expect(result.ok).toBe(false);
    } finally {
      await server.close();
    }
  });
});

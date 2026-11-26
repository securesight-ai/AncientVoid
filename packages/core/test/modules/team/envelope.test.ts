import { describe, expect, it } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { TeamCommand, TeamEvent } from "@ancientvoid/contracts";
import { TEAM_COMMAND_MAX_BYTES, TEAM_EVENT_MAX_BYTES } from "@ancientvoid/contracts";
import {
  checkCommandDedup, checkEventChain, checkTeamCommandWire, checkTeamEventSize,
  decodeTeamCommand, encodeTeamCommand, encodeTeamEvent, signTeamBytes,
  teamEventHash, teamGenesisPrevHash, verifyTeamBytes,
} from "../../../src/modules/team/envelope.ts";

/** EPIC-P83 T83.4 S1 (ADR-0119 §2–3): Umschlag — Signatur, Größe, Kette, Dedup. */

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, publicKey };
}

function command(partial: Partial<TeamCommand> = {}): TeamCommand {
  const now = new Date();
  return {
    v: 1,
    commandId: randomUUID(),
    teamId: "team-1",
    taskId: null,
    from: "from-instance",
    to: "to-instance",
    actor: { kind: "human", memberId: "alice" },
    onBehalfOf: "alice",
    reason: "test",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    expectedRev: 0,
    kind: "task.offer",
    body: { title: "x" },
    ...partial,
  };
}

describe("EPIC-P83 T83.4 — Signatur (ADR-0119 §2)", () => {
  it("signiert und prüft exakte Bytes; geänderte Bytes fallen durch", () => {
    const { privateKey, publicKey } = keys();
    const bytes = encodeTeamCommand(command());
    const sig = signTeamBytes(privateKey, bytes);
    expect(verifyTeamBytes(publicKey, bytes, sig)).toBe(true);
    const tampered = new Uint8Array(bytes);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(verifyTeamBytes(publicKey, tampered, sig)).toBe(false);
  });

  it("fremde Schlüssel werden abgelehnt", () => {
    const a = keys();
    const b = keys();
    const bytes = encodeTeamCommand(command());
    const sig = signTeamBytes(a.privateKey, bytes);
    expect(verifyTeamBytes(b.publicKey, bytes, sig)).toBe(false);
  });
});

describe("EPIC-P83 T83.4 — Prüffolge Befehl", () => {
  it("lehnt Übergröße, falsche Signatur, falschen from/to und Ablauf ab", () => {
    const { privateKey, publicKey } = keys();
    const cmd = command({ from: "peer-a", to: "home-b" });
    const bytes = encodeTeamCommand(cmd);
    const sig = signTeamBytes(privateKey, bytes);
    expect(checkTeamCommandWire({
      bytes, sig, publicKey, peerInstanceId: "peer-a", ownInstanceId: "home-b",
    })).toBeNull();

    expect(checkTeamCommandWire({
      bytes, sig, publicKey, peerInstanceId: "other", ownInstanceId: "home-b",
    })).toBe("bad_signature");
    expect(checkTeamCommandWire({
      bytes, sig, publicKey, peerInstanceId: "peer-a", ownInstanceId: "wrong",
    })).toBe("forbidden");

    const expired = command({ from: "peer-a", to: "home-b", expiresAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const expBytes = encodeTeamCommand(expired);
    const expSig = signTeamBytes(privateKey, expBytes);
    expect(checkTeamCommandWire({
      bytes: expBytes, sig: expSig, publicKey, peerInstanceId: "peer-a", ownInstanceId: "home-b",
    })).toBe("expired");

    const huge = new Uint8Array(TEAM_COMMAND_MAX_BYTES + 1);
    expect(checkTeamCommandWire({
      bytes: huge, sig, publicKey, peerInstanceId: "peer-a", ownInstanceId: "home-b",
    })).toBe("too_large");
  });

  it("Dedup: gleiche ID+Hash ok, gleiche ID andere Bytes = duplicate_mismatch", () => {
    const a = encodeTeamCommand(command({ commandId: "11111111-1111-4111-8111-111111111111" }));
    const b = encodeTeamCommand(command({ commandId: "11111111-1111-4111-8111-111111111111", body: { title: "y" } }));
    const seen = new Map([["11111111-1111-4111-8111-111111111111", teamEventHash(a)]]);
    expect(checkCommandDedup(seen, "11111111-1111-4111-8111-111111111111", teamEventHash(a))).toBeNull();
    expect(checkCommandDedup(seen, "11111111-1111-4111-8111-111111111111", teamEventHash(b))).toBe("duplicate_mismatch");
  });
});

describe("EPIC-P83 T83.4 — Ereignis-Kette", () => {
  it("Genesis und Nachfolger; gebrochener prevHash friert als bad_hash", () => {
    const e0: TeamEvent = {
      v: 1, teamId: "t", stream: "task:1", epoch: 1, seq: 0,
      prevHash: teamGenesisPrevHash(), at: new Date().toISOString(),
      kind: "task.offered", command: null, commandSig: null, body: {},
    };
    const b0 = encodeTeamEvent(e0);
    expect(checkEventChain(null, e0)).toBeNull();
    expect(checkTeamEventSize(b0)).toBeNull();

    const e1: TeamEvent = {
      ...e0, seq: 1, prevHash: teamEventHash(b0), kind: "task.accepted",
    };
    expect(checkEventChain(b0, e1)).toBeNull();

    const bad: TeamEvent = { ...e1, prevHash: "a".repeat(64) };
    expect(checkEventChain(b0, bad)).toBe("bad_hash");
  });

  it("Ereignis über 4 KiB → too_large", () => {
    expect(checkTeamEventSize(new Uint8Array(TEAM_EVENT_MAX_BYTES + 1))).toBe("too_large");
  });

  it("decode rundet formtreu", () => {
    const cmd = command();
    expect(decodeTeamCommand(encodeTeamCommand(cmd))).toEqual(cmd);
  });
});

describe("EPIC-P83 T83.4 — KeyObject-Roundtrip (PEM)", () => {
  it("PEM-exportierte Keys bleiben prüfbar", () => {
    const { privateKey, publicKey } = keys();
    const priv = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }));
    const pub = createPublicKey(publicKey.export({ type: "spki", format: "pem" }));
    const bytes = encodeTeamCommand(command());
    const sig = signTeamBytes(priv, bytes);
    expect(verifyTeamBytes(pub, bytes, sig)).toBe(true);
  });
});

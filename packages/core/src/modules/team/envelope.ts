import { createHash, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import {
  TEAM_COMMAND_MAX_BYTES, TEAM_EVENT_MAX_BYTES, TEAM_SIG_PREFIX,
  TeamCommand, TeamEvent, type TeamRejectCode,
} from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.4 S1 (ADR-0119 §2–3): Umschlag — Signatur über exakte Bytes
 * (Präfix av-team-v1\\0, ECDSA-P-256/SHA-256), Hash-Kette, Prüffolge-Hilfen.
 * Keine Kanonisierung: was auf dem Draht liegt, wird so signiert und gehasht.
 */

const GENESIS_PREV = "0".repeat(64);
const CLOCK_SKEW_MS = 2 * 60_000;
const EXPIRY_TOLERANCE_MS = 5 * 60_000;

/** SHA-256 hex über die Ereignis-Bytes (Kette / Kopfvergleich). */
export function teamEventHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function teamGenesisPrevHash(): string {
  return GENESIS_PREV;
}

/** Signatur über Präfix + Bytes (ADR-0119 §2). */
export function signTeamBytes(privateKey: KeyObject, bytes: Uint8Array): Uint8Array {
  const payload = Buffer.concat([Buffer.from(TEAM_SIG_PREFIX, "utf8"), Buffer.from(bytes)]);
  return new Uint8Array(cryptoSign(null, payload, privateKey));
}

export function verifyTeamBytes(publicKey: KeyObject, bytes: Uint8Array, sig: Uint8Array): boolean {
  const payload = Buffer.concat([Buffer.from(TEAM_SIG_PREFIX, "utf8"), Buffer.from(bytes)]);
  try {
    return cryptoVerify(null, payload, publicKey, Buffer.from(sig));
  } catch {
    return false;
  }
}

export function encodeTeamCommand(cmd: TeamCommand): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(cmd));
}

export function encodeTeamEvent(ev: TeamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(ev));
}

export function decodeTeamCommand(bytes: Uint8Array): TeamCommand | null {
  try {
    const parsed = TeamCommand.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function decodeTeamEvent(bytes: Uint8Array): TeamEvent | null {
  try {
    const parsed = TeamEvent.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Größe → Signatur → from=peer → teamId/to → Ablauf (ADR-0119 §3, Kernschritte). */
export function checkTeamCommandWire(input: {
  bytes: Uint8Array;
  sig: Uint8Array;
  publicKey: KeyObject;
  peerInstanceId: string;
  ownInstanceId: string;
  now?: Date;
}): TeamRejectCode | null {
  if (input.bytes.byteLength > TEAM_COMMAND_MAX_BYTES) return "too_large";
  if (!verifyTeamBytes(input.publicKey, input.bytes, input.sig)) return "bad_signature";
  const cmd = decodeTeamCommand(input.bytes);
  if (cmd === null) return "incompatible";
  if (cmd.from !== input.peerInstanceId) return "bad_signature";
  if (cmd.to !== input.ownInstanceId) return "forbidden";
  const now = input.now ?? new Date();
  const expires = Date.parse(cmd.expiresAt);
  if (!Number.isFinite(expires) || expires + EXPIRY_TOLERANCE_MS < now.getTime()) return "expired";
  const issued = Date.parse(cmd.issuedAt);
  if (Number.isFinite(issued) && Math.abs(issued - now.getTime()) > CLOCK_SKEW_MS) {
    // Abweichung wird angezeigt — Ablauf bleibt der harte Schnitt (ADR-0119 §3).
  }
  return null;
}

export function checkTeamEventSize(bytes: Uint8Array): TeamRejectCode | null {
  return bytes.byteLength > TEAM_EVENT_MAX_BYTES ? "too_large" : null;
}

/** Nächstes Ereignis: prevHash muss dem Hash der Vorgänger-Bytes gleichen. */
export function checkEventChain(prevBytes: Uint8Array | null, event: TeamEvent): TeamRejectCode | null {
  const expected = prevBytes === null ? GENESIS_PREV : teamEventHash(prevBytes);
  if (event.prevHash !== expected) return "bad_hash";
  if (prevBytes === null && event.seq !== 0) return "bad_hash";
  if (prevBytes !== null) {
    const prev = decodeTeamEvent(prevBytes);
    if (prev === null) return "incompatible";
    if (event.seq !== prev.seq + 1) return "bad_hash";
    if (event.epoch !== prev.epoch) return "conflict";
    if (event.stream !== prev.stream || event.teamId !== prev.teamId) return "conflict";
  }
  return null;
}

/** Gleiche commandId mit anderen Bytes → Sicherheitsereignis (ADR-0119 §3). */
export function checkCommandDedup(
  seen: ReadonlyMap<string, string>,
  commandId: string,
  bytesHash: string,
): TeamRejectCode | null {
  const prior = seen.get(commandId);
  if (prior === undefined) return null;
  return prior === bytesHash ? null : "duplicate_mismatch";
}

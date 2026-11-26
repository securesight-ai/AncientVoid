/** EPIC-P83 T83.4 (ADR-0119 §2–3): Team-Umschlag — Befehl, Ereignis, Draht, Ablehnungscodes. */

import { z } from "zod";

/** Signatur-Präfix über den Draht-Bytes (ADR-0119 §2). */
export const TEAM_SIG_PREFIX = "av-team-v1\0";

/** Befehl ≤ 2 KiB, Ereignis ≤ 4 KiB (K5 / ADR-0119 §2). */
export const TEAM_COMMAND_MAX_BYTES = 2 * 1024;
export const TEAM_EVENT_MAX_BYTES = 4 * 1024;

export const TeamActor = z.object({
  kind: z.enum(["human", "agent"]),
  memberId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64).optional(),
  deviceLabel: z.string().min(1).max(80).optional(),
  sessionRef: z.string().min(1).max(128).optional(),
});
export type TeamActor = z.infer<typeof TeamActor>;

/** Ablehnungscodes der Prüffolge (ADR-0119 §3) — sichtbar, nie still. */
export const TeamRejectCode = z.enum([
  "revoked",
  "forbidden",
  "expired",
  "conflict",
  "bad_signature",
  "too_large",
  "rate_limited",
  "invalid_transition",
  "incompatible",
  "duplicate_mismatch",
  "bad_hash",
  "frozen",
]);
export type TeamRejectCode = z.infer<typeof TeamRejectCode>;

/**
 * Befehl — signierte Absicht an das Heim. `body` bleibt untypisiert auf
 * Contract-Ebene (Art hängt von `kind`); Größe wird über die Bytes geprüft.
 */
export const TeamCommand = z.object({
  v: z.literal(1),
  commandId: z.string().uuid(),
  teamId: z.string().min(1).max(64),
  taskId: z.string().min(1).max(64).nullable(),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  actor: TeamActor,
  onBehalfOf: z.string().min(1).max(64),
  reason: z.string().min(1).max(500).nullable(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  expectedRev: z.number().int().nonnegative(),
  kind: z.string().min(1).max(64),
  body: z.unknown(),
});
export type TeamCommand = z.infer<typeof TeamCommand>;

/** Ereignis in einem Strom — Hash-Kette über prevHash (ADR-0119 §2). */
export const TeamEvent = z.object({
  v: z.literal(1),
  teamId: z.string().min(1).max(64),
  stream: z.string().min(1).max(128),
  epoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  prevHash: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string(),
  kind: z.string().min(1).max(64),
  command: z.string().uuid().nullable(),
  commandSig: z.string().min(1).max(512).nullable(),
  body: z.unknown(),
});
export type TeamEvent = z.infer<typeof TeamEvent>;

/** Draht: exakte Bytes + ECDSA-P-256/SHA-256-Signatur (ADR-0119 §2). */
export const TeamWire = z.object({
  bytes: z.instanceof(Uint8Array),
  sig: z.instanceof(Uint8Array),
});
export type TeamWire = z.infer<typeof TeamWire>;

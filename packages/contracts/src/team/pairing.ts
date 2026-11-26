/** EPIC-P83 T83.3 (ADR-0118 §7, Feinkonzept §2.1/§5): Kopplung — Einladung, Beitritt, Codes, Bestätigung. */

import { z } from "zod";

/** Einladungspräfix (ADR-0118 §7.1): Text, nie URL. */
export const TEAM_INVITE_PREFIX = "avteam1.";

/** 128-Bit-Geheimnis als base64url (22 Zeichen). */
export const TeamInviteSecret = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Die Einladung als Daten — nur der Hash des Geheimnisses wird gespeichert (ADR-0118 §7.1). */
export const TeamInviteData = z.object({
  v: z.literal(1),
  /** Protokollversion des Einladenden. */
  protocolVersion: z.literal(1),
  /** Adresse (kein Hostname-Vertrauen: der Beitritt prüft nach Auflösung) und Port des Kopplungsservers. */
  address: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  /** SPKI-SHA-256 (hex) und Zertifikat des Einladenden — der Pin, den B prüft. */
  spkiSha256: z.string().regex(/^[a-f0-9]{64}$/),
  certPem: z.string().min(1).max(4096),
  teamId: z.string().min(1).max(64),
  secret: TeamInviteSecret,
  /** Gültigkeit: 10 Minuten ab Ausstellung (ADR-0118 §7.1). */
  expiresAt: z.string(),
});
export type TeamInviteData = z.infer<typeof TeamInviteData>;

/** Gespeicherte Einladung (Journal/K7): nur Hash und Rahmen, nie das Geheimnis. */
export const TeamInviteRecord = z.object({
  teamId: z.string().min(1).max(64),
  /** SHA-256 über teamId + „\0" + secret, hex. */
  secretSha256: z.string().regex(/^[a-f0-9]{64}$/),
  address: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  issuedAt: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable().default(null),
});
export type TeamInviteRecord = z.infer<typeof TeamInviteRecord>;

/** Profil des Beitretenden über die Kopplungsverbindung (ADR-0118 §7.3). */
export const TeamJoinProfile = z.object({
  v: z.literal(1),
  instanceId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  spkiSha256: z.string().regex(/^[a-f0-9]{64}$/),
  certPem: z.string().min(1).max(4096),
  /** Anzeigename der Instanz (Angabe; bewiesen ist nur der Schlüssel). */
  label: z.string().min(1).max(80),
  protocolVersion: z.literal(1),
});
export type TeamJoinProfile = z.infer<typeof TeamJoinProfile>;

/** Beitrittsnachricht: Geheimnis der Einladung (Klartext nur hier auf der Leitung) + Profil. */
export const TeamJoinMessage = z.object({
  v: z.literal(1),
  teamId: z.string().min(1).max(64),
  secret: TeamInviteSecret,
  profile: TeamJoinProfile,
});
export type TeamJoinMessage = z.infer<typeof TeamJoinMessage>;

/** Ablehnungsgründe der Kopplung (sichtbar, nie still; ADR-0118 §7 + Feinkonzept §2.1). */
export const TeamPairingError = z.enum([
  "bad_invite",
  "expired",
  "used",
  "wrong_code",
  "attempts_exhausted",
  "not_confirmed",
  "version",
  "rate_limited",
]);
export type TeamPairingError = z.infer<typeof TeamPairingError>;

/** Zustand eines Kopplungsfensters — beidseitig sichtbar (K1/K9). */
export const TeamPairingState = z.enum([
  "waiting",
  "joined",
  "a_typed",
  "b_typed",
  "confirmed",
  "failed",
]);
export type TeamPairingState = z.infer<typeof TeamPairingState>;

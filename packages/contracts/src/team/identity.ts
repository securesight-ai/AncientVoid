/** EPIC-P83 (ADR-0118 §5/§11): Instanzidentität, Pins und Verbindungszustand der Team-Links. */

import { z } from "zod";

/** SHA-256 über den SPKI, base64url (43 Zeichen) — die Instanz-ID (ADR-0118 §5). */
export const TeamInstanceId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export type TeamInstanceId = z.infer<typeof TeamInstanceId>;

/** PEM des selbstsignierten Zertifikats (CN = instanceId, ECDSA-P-256, 180 Tage). */
export const TeamCertPem = z.string().min(1).max(4096);

/** Identität dieser Instanz — Schlüssel liegt daneben im Dateisystem, nie im Contract. */
export const TeamIdentity = z.object({
  v: z.literal(1),
  instanceId: TeamInstanceId,
  certPem: TeamCertPem,
  notAfter: z.string(),
  createdAt: z.string(),
});
export type TeamIdentity = z.infer<typeof TeamIdentity>;

/** Verbindungszustand eines Peers (K9: sichtbar, nie geraten; ADR-0118 §11/§12). */
export const TeamLinkState = z.enum(["disconnected", "connecting", "connected", "incompatible", "revoked"]);
export type TeamLinkState = z.infer<typeof TeamLinkState>;

/** Pin eines Peers: SPKI-Hash und Zertifikat, je Verbindung vor der ersten Nachricht geprüft (ADR-0118 §4). */
export const TeamPeerPin = z.object({
  instanceId: TeamInstanceId,
  /** SPKI-SHA-256 des Peer-Zertifikats, hex. */
  spkiSha256: z.string().regex(/^[a-f0-9]{64}$/),
  certPem: TeamCertPem,
  /** Adresse/Port, unter der der Peer laut Kopplung erreichbar ist (Angabe; dial prüft neu). */
  address: z.string().min(1).max(253).nullable().default(null),
  port: z.number().int().min(1).max(65535).nullable().default(null),
  state: TeamLinkState.default("disconnected"),
  pinnedAt: z.string(),
});
export type TeamPeerPin = z.infer<typeof TeamPeerPin>;

/** Wire-Nachricht eines Links: übertragene Bytes plus Signatur über genau diese Bytes (ADR-0119 §2). */
export const TeamWireMessage = z.object({
  /** Rohbytes der Nachricht, base64. */
  bytes: z.string().min(1).max(90_000),
  /** ECDSA-P-256/SHA-256-Signatur über genau diese Bytes, Präfix „av-team-v1\0", base64. */
  sig: z.string().min(1).max(1024),
});
export type TeamWireMessage = z.infer<typeof TeamWireMessage>;

/** Grund der Ablehnung beim Verbinden (ADR-0118 §3 — gleiche Regeln für Wählen und Lauschen). */
export const TeamAddressError = z.enum([
  "wildcard",
  "public_address",
  "unresolvable",
  "rebinding",
]);
export type TeamAddressError = z.infer<typeof TeamAddressError>;

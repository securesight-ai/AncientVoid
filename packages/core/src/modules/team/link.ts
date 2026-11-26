import { createHash, X509Certificate, type KeyObject } from "node:crypto";
import type { PeerCertificate } from "node:tls";
import { type TeamIdentity, type TeamPeerPin } from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §2/§4): TLS-Regeln und Naht des Team-Links.
 * Die Naht ist echt: `TeamLink` (senden, empfangen, schließen) hat zwei
 * Umsetzungen — mTLS-Listener/-Dialer im Hub und das In-Memory-Paar im Test.
 * Peers erreichen nie die Fastify-App unter `/api`; der Team-Server hat
 * genau einen WebSocket-Pfad `/team/v1`.
 */

export const TEAM_PATH = "/team/v1";
export const TEAM_ALPN = "av-team/1";

/** TLS 1.3, beidseitig (ADR-0118 §4): kein 0-RTT, keine Wiederverwendung von
 *  Sitzungen durch den Client — der Dialer baut je Verbindung einen neuen
 *  TLS-Kontext (frischer Agent, kein session-Cache); der Server trägt
 *  sessionTimeout 0. */
export interface TeamTlsMaterial {
  identity: TeamIdentity;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** SPKI-SHA-256 eines Peer-Zertifikats (hex) — für den Pin-Vergleich. */
export function peerSpkiSha256(cert: PeerCertificate): string | null {
  try {
    const x = new X509Certificate(cert.raw);
    return createHash("sha256").update(x.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  } catch {
    return null;
  }
}

/** Server-seitige TLS-Optionen: minVersion 1.3, Client-Zertifikat verpflichtend,
 *  CA = genau die gepinnten Zertifikate, ALPN av-team/1, keine Tickets. */
export function teamServerTlsOptions(material: TeamTlsMaterial, pins: readonly TeamPeerPin[]) {
  return {
    minVersion: "TLSv1.3" as const,
    requestCert: true,
    rejectUnauthorized: true,
    ca: pins.map((p) => p.certPem),
    cert: material.identity.certPem,
    key: material.privateKey.export({ type: "pkcs8", format: "pem" }),
    ALPNProtocols: [TEAM_ALPN],
    sessionTimeout: 0,
    allowHalfOpen: false,
  };
}

/** Client-seitige TLS-Optionen für den Dialer: frischer Kontext je Verbindung
 *  (keine Wiederverwendung von Sitzungen), Pin-Prüfung statt Namensprüfung. */
export function teamClientTlsOptions(material: TeamTlsMaterial, pin: TeamPeerPin) {
  return {
    minVersion: "TLSv1.3" as const,
    maxVersion: "TLSv1.3" as const,
    cert: material.identity.certPem,
    key: material.privateKey.export({ type: "pkcs8", format: "pem" }),
    ca: [pin.certPem],
    rejectUnauthorized: true,
    ALPNProtocols: [TEAM_ALPN],
    checkServerIdentity: (hostname: string, cert: PeerCertificate): Error | undefined => {
      const spki = peerSpkiSha256(cert);
      if (spki === null || spki !== pin.spkiSha256) {
        return new Error(`Pin-Prüfung fehlgeschlagen: SPKI ${spki ?? "unlesbar"} ≠ Pin ${pin.spkiSha256.slice(0, 16)}…`);
      }
      return undefined;
    },
  };
}

/** Eine Richtung des Links — Bytes in, Bytes raus (die Wire-Signatur trägt
 *  die Journal-Schicht, T83.4). */
export interface TeamLink {
  send(bytes: Uint8Array): Promise<void>;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  /** Schließt die Verbindung; weitere Sends lehnen ab. */
  close(): Promise<void>;
}

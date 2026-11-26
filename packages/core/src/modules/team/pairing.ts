import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TeamInviteData, type TeamJoinMessage, type TeamPairingError } from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.3 (ADR-0118 §7): Kopplungslogik — rein, testbar ohne Netz.
 * Einladung (128-Bit-Geheimnis, 10 Minuten, einmalig, Text mit Präfix),
 * Code-Ableitung aus dem TLS-Exporter (RFC 9266) und das Fenster-Regelwerk
 * (fünf Fehlversuche, Ablauf, einmalige Nutzung; Pins erst nach beiden
 * Bestätigungen).
 */

const INVITE_TTL_MS = 10 * 60_000;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_CODE_ATTEMPTS = 3;

/** Einladung erzeugen: Geheimnis bleibt beim Aufrufer (Text/Anzeige), gespeichert wird nur der Hash. */
export function createTeamInvite(input: {
  address: string;
  port: number;
  spkiSha256: string;
  certPem: string;
  teamId?: string;
  ttlMs?: number;
}): { invite: TeamInviteData; secretSha256: string; text: string } {
  const teamId = input.teamId ?? randomUUID();
  const secret = randomBytes(16).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (input.ttlMs ?? INVITE_TTL_MS));
  const invite: TeamInviteData = {
    v: 1,
    protocolVersion: 1,
    address: input.address,
    port: input.port,
    spkiSha256: input.spkiSha256,
    certPem: input.certPem,
    teamId,
    secret,
    expiresAt: expiresAt.toISOString(),
  };
  // Textform: eine Zeile Präfix + base64url(JSON) — kopierbar, nie eine URL (ADR-0118 §7.1).
  const text = `avteam1.${Buffer.from(JSON.stringify(invite)).toString("base64url")}`;
  return { invite, secretSha256: teamInviteHash(teamId, secret), text };
}

/** Gespeicherter Hash: SHA-256 über teamId + NUL + Geheimnis (K7: nie das Geheimnis selbst). */
export function teamInviteHash(teamId: string, secret: string): string {
  return createHash("sha256").update(`${teamId}\0${secret}`).digest("hex");
}

/** Einladungstext lesen (Gegenstück zu createTeamInvite): Präfix + base64url(JSON). */
export function parseTeamInviteText(text: string): TeamInviteData | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("avteam1.")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(trimmed.slice("avteam1.".length), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = TeamInviteData.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Achtstellige Codes aus dem TLS-Exporter-Material (beide Seiten leiten sie
 *  unabhängig aus derselben Verbindung ab; ADR-0118 §7.4). */
export function pairingCodes(exporterA: Uint8Array, exporterB: Uint8Array): { codeA: string; codeB: string } {
  return { codeA: code8(exporterA), codeB: code8(exporterB) };
}

function code8(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(0) % 100_000_000;
  return n.toString().padStart(8, "0");
}

/** Kontext für den Exporter: teamId + beide SPKI-Hashes (ADR-0118 §7.4). */
export function pairingExporterContext(teamId: string, spkiA: string, spkiB: string): Buffer {
  return Buffer.from(`${teamId}\0${spkiA}\0${spkiB}`, "utf8");
}

/** Regelwerk des Kopplungsfensters — rein, Grundlage für Server (A) und Dialer (B). */
export interface PairingWindow {
  teamId: string;
  secretSha256: string;
  expiresAt: Date;
  usedAt: Date | null;
  failedAttempts: number;
  /** Peer-Profil nach erfolgreichem Beitritt; Codes bleiben geheim bis Bestätigung. */
  joined: { instanceId: string; spkiSha256: string; certPem: string; label: string } | null;
  aTypedOk: boolean;
  bTypedOk: boolean;
  codeAttemptsA: number;
  codeAttemptsB: number;
}

export function newPairingWindow(teamId: string, secretSha256: string, expiresAt: Date): PairingWindow {
  return { teamId, secretSha256, expiresAt, usedAt: null, failedAttempts: 0, joined: null, aTypedOk: false, bTypedOk: false, codeAttemptsA: 0, codeAttemptsB: 0 };
}

/** Schritt 1: B tritt bei (Geheimnis prüfen, Ablauf, einmalige Nutzung; ADR-0118 §7.1/7.3). */
export function acceptJoin(window: PairingWindow, msg: TeamJoinMessage, now: Date): TeamPairingError | null {
  if (window.failedAttempts >= MAX_FAILED_ATTEMPTS) return "attempts_exhausted";
  if (window.usedAt !== null || window.joined !== null) return "used";
  if (now.getTime() > window.expiresAt.getTime()) return "expired";
  if (msg.teamId !== window.teamId || teamInviteHash(msg.teamId, msg.secret) !== window.secretSha256) {
    window.failedAttempts++;
    return window.failedAttempts >= MAX_FAILED_ATTEMPTS ? "attempts_exhausted" : "bad_invite";
  }
  if (msg.profile.protocolVersion !== 1) return "version";
  window.joined = {
    instanceId: msg.profile.instanceId,
    spkiSha256: msg.profile.spkiSha256,
    certPem: msg.profile.certPem,
    label: msg.profile.label,
  };
  return null;
}

/** Schritt 2: Code-Prüfung (je drei Versuche; A tippt Code B, B tippt Code A). */
export function checkCode(window: PairingWindow, side: "a" | "b", typed: string, expected: string): TeamPairingError | null {
  if (window.joined === null) return "not_confirmed";
  if (side === "a" ? window.aTypedOk : window.bTypedOk) return null;
  const attempts = side === "a" ? window.codeAttemptsA : window.codeAttemptsB;
  if (attempts >= MAX_CODE_ATTEMPTS) return "attempts_exhausted";
  if (typed.replace(/\s/g, "") !== expected) {
    if (side === "a") window.codeAttemptsA = attempts + 1;
    else window.codeAttemptsB = attempts + 1;
    return "wrong_code";
  }
  if (side === "a") window.aTypedOk = true;
  else window.bTypedOk = true;
  return null;
}

/** Schritt 3: erst nach BEIDEN Bestätigungen gilt die Kopplung (ADR-0118 §7.6). */
export function pairingComplete(window: PairingWindow): boolean {
  return window.joined !== null && window.aTypedOk && window.bTypedOk;
}

/** Fenster verwerfen (Abbruch/Neustart/Zeitablauf; ADR-0118 §7.6). */
export function invalidate(window: PairingWindow): void {
  window.joined = null;
  window.usedAt = new Date();
}

/**
 * EPIC-P42 (ADR-0067): gemeinsame Geräte-Basis — ohne sie wäre device-setup ↔ device-service
 * ein Zirkularimport (dependency-cruiser-Gate `check:arch`). Öffentlich weiterhin über
 * modules/devices/index.ts.
 */

/** Fehlercode des Geräte-Dienstes; HTTP-Mappt in den Hub-Routen. */
export type DeviceErrorCode = "unavailable" | "not_found" | "quota" | "busy" | "conflict" | "blocked" | "failed";

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  constructor(code: DeviceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Ausführungsnähte: echter Prozess in Produktion, Fake in Tests. stdin für Rückfragen (Lizenzen, AVD-Profil). */
export interface DeviceExec {
  run(argv: string[], opts: { timeoutMs: number; env?: Record<string, string>; stdin?: string }): Promise<{ code: number; stdout: Buffer; stderr: string }>;
  spawnDetached(argv: string[], opts: { env: Record<string, string>; logFile: string }): { pid: number };
  ownedAlive(pid: number, marker: string): Promise<boolean>;
  kill(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  exited(pid: number): Promise<boolean>;
}

/** Sichtbare Log-Maskierung: Träger-Tokens und Passwort-Felder, ohne Logs unleserlich zu machen. */
export function maskDeviceLog(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1<redacted>")
    .replace(/((?:password|token|secret)=)[^\s&]+/gi, "$1<redacted>");
}

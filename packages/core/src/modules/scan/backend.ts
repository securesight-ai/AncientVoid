import { ScanBackendResponse, type ScanProfile } from "@ancientvoid/contracts";

/**
 * EPIC-P80 (ADR-0118): der Anbindungs-Transport. Übergangs-Adapter auf die
 * HTTP-API des SiLenT-Decks (Basic-Auth, Secrets nur als Dateireferenz —
 * ADR-0011); Ziel ist die MCP-Fassade auf SiLenT-Seite (D2/D4). Der Adapter
 * validiert Gegenrichten hart gegen die Contracts — Unbekanntes wird als
 * Protocol-Fehler sichtbar, nie durchgereicht (Fail loud, PRD §8.5).
 */

export class ScanBackendError extends Error {
  readonly state: ScanBackendErrorState;
  constructor(state: ScanBackendErrorState, message: string) {
    super(message);
    this.state = state;
  }
}
export type ScanBackendErrorState = "unreachable" | "unauthorized" | "protocol" | "config";

export interface ScanBackend {
  /** GET /api/health (K9: Ausfall sichtbar < 60 s). wirft bei jedem Fehler. */
  probe(signal?: AbortSignal): Promise<void>;
  /** POST /api/scan — Antwort exakt contractförmig oder Fehler, nie geraten. */
  scan(target: string, profile: ScanProfile, signal?: AbortSignal): Promise<ScanBackendResponse>;
}

export interface ScanBackendDeps {
  /** Datei mit `user:pass` (ADR-0011: Secret nur als Dateireferenz). */
  readFile(path: string): Promise<string | null>;
  fetch?(url: string, init?: RequestInit): Promise<Response>;
}

export function createScanHttpBackend(
  opts: { url: string; timeoutMs: number; credentialsFile?: string },
  deps: ScanBackendDeps,
): ScanBackend {
  const doFetch = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));

  async function authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!opts.credentialsFile) return headers;
    const secret = (await deps.readFile(opts.credentialsFile))?.trim();
    if (!secret) throw new ScanBackendError("config", `Credential-Datei leer oder nicht lesbar: ${opts.credentialsFile}`);
    headers.authorization = `Basic ${Buffer.from(secret, "utf8").toString("base64")}`;
    return headers;
  }

  async function call(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<unknown> {
    const headers = await authHeaders();
    let res: Response;
    try {
      res = await doFetch(`${opts.url}${path}`, { ...init, headers, ...(signal ? { signal } : {}) });
    } catch (err) {
      throw new ScanBackendError("unreachable", `Backend nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 || res.status === 403) throw new ScanBackendError("unauthorized", `Backend verweigert den Zugang (HTTP ${res.status})`);
    if (!res.ok) throw new ScanBackendError("unreachable", `Backend antwortete mit HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ScanBackendError("protocol", "Antwort ist kein JSON");
    }
    return body;
  }

  return {
    async probe(signal) {
      await call("/api/health", { method: "GET" }, signal);
    },
    async scan(target, profile, signal) {
      const body = await call("/api/scan", { method: "POST", body: JSON.stringify({ target, profile }) }, signal);
      const parsed = ScanBackendResponse.safeParse(body);
      if (!parsed.success) {
        throw new ScanBackendError("protocol", `Antwortform unbekannt: ${parsed.error.issues[0]?.path.join(".") ?? "?"} — ${parsed.error.issues[0]?.message ?? "ungültig"}`);
      }
      return parsed.data;
    },
  };
}

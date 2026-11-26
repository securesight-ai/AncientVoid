import { z } from "zod";

/**
 * EPIC-P80 (ADR-0118): Pentest-Scan — die `scan`-Domäne. D1 entscheidet: pro
 * Domäne ein eigener Contract, nicht ein generischer ToolBackend-Contract.
 * Der Hub ist Auftraggeber und Anzeiger; Ausführungswerk bleibt beim Backend
 * (Übergang: HTTP-API des SiLenT-Decks, Ziel: MCP-Fassade). Der Hub parst
 * deterministisch und füttert keinen eigenen LLM-Loop — Backend-Text ist Daten,
 * nie Anweisung (PRD §8.5, D3).
 *
 * Hausregeln: K5 — Events und Antworten sind gekappt, der Rest lebt als Blob;
 * K7 — Jobs sind aus Journal+Snapshot rekonstruierbar; ADR-0011 — Secrets
 * erscheinen nirgends im Contract; `null` heißt „nicht gemeldet“ (ADR-0023).
 */

/** Profile 1:1 wie das Backend sie kennt (quick/services/full). */
export const SCAN_PROFILES = ["quick", "services", "full"] as const;
export const ScanProfile = z.enum(SCAN_PROFILES);
export type ScanProfile = z.infer<typeof ScanProfile>;

/** Von der Anbindung deklarierbare Tools (D4); das Standard-Tool läuft ohne Gate. */
export const SCAN_TOOLS = ["nmap", "hydra", "sqlmap", "nuclei"] as const;
export const ScanTool = z.enum(SCAN_TOOLS);
export type ScanTool = z.infer<typeof ScanTool>;
/** Riskante Tools gehen vor dem Aufruf durch den Approval-Weg (D4, K1). */
export const SCAN_RISKY_TOOLS: readonly ScanTool[] = ["hydra", "sqlmap", "nuclei"];

/** Tool-Deklaration in der Anbindung (config): `risky` Tools brauchen Freigabe (D4). */
export const ScanToolDecl = z.object({
  tool: ScanTool,
  risky: z.boolean().default(false),
});
export type ScanToolDecl = z.infer<typeof ScanToolDecl>;

/** Zielzeichensatz (D5): Hostname, IP/IPv6, CIDR, URL-Pfad-Stück — wie das Backend-Regex. */
export const SCAN_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,254}$/;

// ——— K5-Kappen (gemessen, nicht behaupten — ADR-0118) ———

/** Journal-/Event-Zeilengrenze: alles darüber wird zum Blob. */
export const SCAN_EVENT_MAX_BYTES = 4_096;
export const SCAN_HOSTS_MAX = 256;
export const SCAN_PORTS_PER_HOST_MAX = 200;
/** Output-Fenster im Contract; der volle Text (Backend-Kappe 8000 Z.) geht als Blob. */
export const SCAN_OUTPUT_MAX_CHARS = 8_000;
export const SCAN_JOBS_PAGE_MAX = 200;

/** Eine Ziel-Allowlisten-Zeile der Anbindung (D5: Inventar-Porträt oder frei gelistet). */
export const ScanTargetEntry = z.object({
  label: z.string().min(1).max(80),
  target: z.string().regex(SCAN_TARGET_PATTERN),
  /** `frei` = von Hand gelistet, `inventar` = aus dem Inventar-Porträt übernommen. */
  kind: z.enum(["frei", "inventar"]).default("frei"),
});
export type ScanTargetEntry = z.infer<typeof ScanTargetEntry>;

/** POST /api/scan — Antwort des Backends, exakt die gemessene Form (tolerante Lesart). */
export const ScanBackendHost = z.object({
  ip: z.string().nullable(),
  hostname: z.string().nullable(),
  /** Der Backend-Parser liefert die Statuszeile als Freitext — auch Parser-Artefakte
   * wie „Status:“/„Ports:“ (gemessen 25.11.2026); Anzeige zeigt ihn unverändert. */
  status: z.string().nullable(),
  ports: z.array(z.string().max(64)).max(SCAN_PORTS_PER_HOST_MAX),
});
export type ScanBackendHost = z.infer<typeof ScanBackendHost>;

export const ScanBackendResponse = z.object({
  code: z.number().int(),
  parsed: z.object({ hosts: z.array(ScanBackendHost).max(SCAN_HOSTS_MAX) }),
  output: z.string().max(SCAN_OUTPUT_MAX_CHARS).nullable(),
});
export type ScanBackendResponse = z.infer<typeof ScanBackendResponse>;

/** GET /api/health — Backend-Probe (K9: Ausfall sichtbar < 60 s). */
export const ScanBackendHealth = z.object({
  ok: z.boolean(),
  llm: z.string().nullable().optional(),
  host: z.string().nullable().optional(),
});
export type ScanBackendHealth = z.infer<typeof ScanBackendHealth>;

// ——— Die Hub-seitige Betrachtung (Jobs, Status) ———

export const PentestJobState = z.enum(["queued", "running", "done", "failed", "timeout", "cancelled"]);
export type PentestJobState = z.infer<typeof PentestJobState>;

/** K5: die Journal-Zeile trägt Zusammenfassung + Blob-Referenz, nie den Volltext. */
export const PentestJobSummary = z.object({
  hosts: z.number().int().nonnegative(),
  hostsUp: z.number().int().nonnegative(),
  portsOpen: z.number().int().nonnegative(),
  /** Output gekappt, weil über die Contract-Kappe (der volle Text liegt im Blob). */
  truncated: z.boolean(),
});
export type PentestJobSummary = z.infer<typeof PentestJobSummary>;

/** Die Journal-Zeile des Hubs (K7) — der Hub-Weg des Ereignisses; der Deck-Bestand bleibt der seine. */
export const PentestScanJob = z.object({
  id: z.string().uuid(),
  target: z.string(),
  profile: ScanProfile,
  tool: ScanTool,
  state: PentestJobState,
  /** Kennung des Backends, wenn es eine meldet; sonst `null` (ADR-0023). */
  sourceRef: z.string().nullable(),
  approvalId: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Ursache für failed/timeout — sichtbar, nie ein stiller Abbruch (K9). */
  error: z.string().nullable(),
  summary: PentestJobSummary.nullable(),
  /** Blob-Referenz auf den Volltext (K5); `null` = passte in die Zeile. */
  blob: z.object({ hash: z.string(), bytes: z.number().int() }).nullable(),
});
export type PentestScanJob = z.infer<typeof PentestScanJob>;

/** Was GET /api/pentest/status liefert (K9/K10: Grund zeigen, wenn das Backend nicht kann). */
export const PentestStatus = z.object({
  configured: z.boolean(),
  state: z.enum(["ok", "unreachable", "unauthorized", "protocol", "config", "unknown"]),
  detail: z.string().nullable(),
  /** Zeitpunkt der letzten Prüfung (ISO-8601 UTC); `null` = nie. */
  checkedAt: z.string().nullable(),
  /** Prüfzyklus in ms (K9: muss unter 60 s bleiben). */
  probeIntervalMs: z.number().int(),
});
export type PentestStatus = z.infer<typeof PentestStatus>;

/** Volldetail für GET /api/pentest/jobs/:id — Job plus das, was der Hub deterministisch geparst hat.
 * Der Output ist hier das Contract-Fenster (≤ Kappe); der volle Text liegt im Blob (K5). */
export const PentestJobDetail = z.object({
  job: PentestScanJob,
  parsed: ScanBackendResponse.nullable(),
  output: z.string().max(SCAN_OUTPUT_MAX_CHARS).nullable(),
  truncated: z.boolean(),
});
export type PentestJobDetail = z.infer<typeof PentestJobDetail>;

/** POST /api/pentest/scan — request von PWA und hubctl auf derselben Route (D6). */
export const PentestScanRequest = z.object({
  target: z.string().regex(SCAN_TARGET_PATTERN),
  profile: ScanProfile.default("quick"),
  tool: ScanTool.default("nmap"),
});
export type PentestScanRequest = z.infer<typeof PentestScanRequest>;

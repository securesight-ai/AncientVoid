import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  PentestJobDetail,
  PentestScanJob,
  PentestStatus} from "@ancientvoid/contracts";
import {
  PentestScanRequest,
  ScanBackendResponse as ScanBackendResponseSchema,
  SCAN_EVENT_MAX_BYTES,
  SCAN_OUTPUT_MAX_CHARS,
  SCAN_RISKY_TOOLS,
  type PentestJobSummary,
  type ScanTargetEntry,
  type ScanTool,
  type ScanToolDecl,
} from "@ancientvoid/contracts";
import type { ApprovalService, OperationStore } from "../approvals/index.ts";
import { createScanHttpBackend, ScanBackendError, type ScanBackend } from "./backend.ts";
import { createScanJournal, type JournalDeps, type ScanJournal } from "./journal.ts";

/**
 * EPIC-P80 (ADR-0118): der Scan-Dienst. Auftraggeber und Anzeiger, nie
 * Ausführungswerk — der Adapter bringt die Ergebnisse, der Hub schreibt sie
 * ins Journal (K7) und lagert Volltexte als Blob (K5). Der Analysekopf bleibt
 * der unsrige: geparst wird deterministisch, Backend-Text ist Daten, nie
 * Anweisung (PRD §8.5, D3).
 */

export interface ScanServiceConfig {
  /** Backend-URL (Übergang: HTTP-API des Decks); `null` = nicht angebunden. */
  backendUrl: string | null;
  /** ADR-0011: Secrets nur als Dateireferenz. */
  credentialsFile: string | null;
  enabled: boolean;
  /** Prüfzyklus — muss unter 60 s bleiben (K9). */
  probeIntervalMs: number;
  /** Hub-Job-Timeout > Backend-Timeout (300 s), sonst hängt der Job sichtbar statt still (K9). */
  timeoutMs: number;
  windowHours: number;
  /** Ziel-Allowliste (D5): die Sicherheitsgrenze, nicht die UI. */
  targets: ScanTargetEntry[];
  /** Deklarierte Tools (D4): riskante laufen nur über den Approval-Weg. */
  tools: ScanToolDecl[];
}

export interface ScanServiceDeps extends JournalDeps {
  fetch?(url: string, init?: RequestInit): Promise<Response>;
  approvals?: ApprovalService;
  operations?: OperationStore;
  logger?: { info(m: string): void; warn(m: string): void; error(m: string): void };
}

type ScanToolName = ScanTool;

/** Pseudo-Session für Freigaben ohne Session-Kontext (Muster knowledge). */
const SCAN_SESSION = "pentest";

/** Persistierter Freigaben-Payload (ADR-0019): beim Ausführen neu geprüft, nie geglaubt. */
const ScanRunPayload = z.object({ request: PentestScanRequest, actor: z.string().nullable() });

export type ScanCall<T> = ({ ok: true } & T) | { ok: false; error: string };

export class ScanService {
  private readonly config: ScanServiceConfig;
  private readonly deps: ScanServiceDeps;
  private readonly journal: ScanJournal;
  private readonly backend: ScanBackend | null;
  private statusCache: PentestStatus;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ScanServiceConfig, deps: ScanServiceDeps, dir: string) {
    this.config = config;
    this.deps = deps;
    this.journal = createScanJournal(deps, dir, { windowHours: config.windowHours });
    this.backend =
      config.backendUrl && config.enabled
        ? createScanHttpBackend(
            { url: config.backendUrl, timeoutMs: config.timeoutMs, ...(config.credentialsFile ? { credentialsFile: config.credentialsFile } : {}) },
            { readFile: deps.readFile, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
          )
        : null;
    this.statusCache = this.backend
      ? { configured: true, state: "unknown", detail: "noch nicht geprüft", checkedAt: null, probeIntervalMs: config.probeIntervalMs }
      : {
          configured: false,
          state: "config",
          detail: this.config.enabled
            ? "Kein Backend angebunden — pentest.backendUrl fehlt (credentialsFile als Dateireferenz, ADR-0011)."
            : "pentest.enabled ist aus.",
          checkedAt: null,
          probeIntervalMs: config.probeIntervalMs,
        };
  }

  /** K7: Journal neu aufbauen; Läufe aus einem früheren Prozess sterben sichtbar. */
  async load(): Promise<void> {
    await this.journal.load();
    for (const job of this.journal.jobs()) {
      if (job.state !== "queued" && job.state !== "running") continue;
      await this.journal.append({ ...job, state: "failed", finishedAt: this.now(), error: "Hub neu gestartet — der Lauf endete nicht (K7-Aufarbeitung)", approvalId: job.approvalId });
    }
  }

  start(): void {
    void this.probe();
    this.timer = setInterval(() => void this.probe(), this.config.probeIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): PentestStatus {
    return this.statusCache;
  }

  targets(): ScanTargetEntry[] {
    return this.config.targets;
  }

  tools(): ScanToolDecl[] {
    return this.config.tools;
  }

  async probe(): Promise<PentestStatus> {
    if (!this.backend) return this.statusCache;
    try {
      await this.backend.probe();
      this.statusCache = { configured: true, state: "ok", detail: null, checkedAt: this.now(), probeIntervalMs: this.config.probeIntervalMs };
    } catch (err) {
      const state = err instanceof ScanBackendError ? err.state : "unreachable";
      this.statusCache = {
        configured: true,
        state,
        detail: err instanceof Error ? err.message : String(err),
        checkedAt: this.now(),
        probeIntervalMs: this.config.probeIntervalMs,
      };
    }
    return this.statusCache;
  }

  jobs(): PentestScanJob[] {
    return this.journal.jobs();
  }

  async detail(id: string): Promise<PentestJobDetail | null> {
    const job = this.journal.get(id);
    if (!job) return null;
    if (!job.blob) return { job, parsed: null, output: null, truncated: false };
    const raw = await this.journal.blobGet(job.blob.hash);
    if (!raw) return { job, parsed: null, output: null, truncated: job.summary?.truncated ?? false };
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return { job, parsed: null, output: null, truncated: true };
    }
    const parsed = ScanBackendResponseSchema.safeParse(stored);
    if (!parsed.success) return { job, parsed: null, output: null, truncated: true };
    return {
      job,
      parsed: parsed.data,
      output: typeof parsed.data.output === "string" ? parsed.data.output.slice(0, SCAN_OUTPUT_MAX_CHARS) : null,
      truncated: job.summary?.truncated ?? false,
    };
  }

  /** Direkter Lauf (Policy `allow`). Riskante Tools bleiben am Approval-Weg (D4). */
  async scanNow(raw: unknown, actor: string | null): Promise<ScanCall<{ job: PentestScanJob }>> {
    const request = PentestScanRequest.safeParse(raw);
    if (!request.success) return { ok: false, error: `${request.error.issues[0]?.path.join(".") || "target"}: ${request.error.issues[0]?.message ?? "ungültig"}` };
    return this.run(request.data, null, actor);
  }

  /** Freigabe-Weg (Policy `approve`): einwerfen, entscheiden lassen, ausführen. */
  requestScan(raw: unknown, actor: string | null): { approvalId: string; summary: string } | { error: string } | null {
    const request = PentestScanRequest.safeParse(raw);
    if (!request.success) return { error: `${request.error.issues[0]?.path.join(".") || "target"}: ${request.error.issues[0]?.message ?? "ungültig"}` };
    if (!this.backend) return { error: this.statusCache.detail ?? "Kein Backend angebunden." };
    const refused = this.refuseOffList(request.data.target);
    if (refused) return { error: refused };
    if (!this.deps.approvals || !this.deps.operations) return { error: "Keine Freigabe-Warteschlange konfiguriert — hier ist nichts zu fragen." };
    const summary = `${actor ?? "Jemand"} möchte einen ${request.data.profile}-Scan auf „${request.data.target}" (${request.data.tool}).`;
    const req = this.deps.approvals.create(SCAN_SESSION, "write", "scan.run", summary);
    this.deps.operations.create(req.id, SCAN_SESSION, "scan.run", { request: request.data, actor }, 0, actor);
    return { approvalId: req.id, summary };
  }

  /** Führt eine freigegebene Anfrage genau einmal aus (ADR-0019), aufgerufen aus der Decide-Route. */
  async applyApprovedScan(approvalId: string): Promise<{ ok: boolean; detail?: string }> {
    const ops = this.deps.operations;
    if (!ops) return { ok: false, detail: "no operation store" };
    const op = ops.get(approvalId);
    if (!op || op.kind !== "scan.run") return { ok: false, detail: "no pending scan for this approval" };
    const payload = ScanRunPayload.safeParse(op.payload);
    if (!payload.success) return { ok: false, detail: "Payload der Freigabe hat die erwartete Form nicht mehr." };
    if (!ops.transition(op.id, ["pending"], "dispatching")) return { ok: false, detail: `operation already ${ops.get(op.id)?.state ?? "gone"}` };
    const res = await this.run(payload.data.request, approvalId, payload.data.actor);
    if (!res.ok) {
      ops.transition(op.id, ["dispatching"], "failed", res.error);
      return { ok: false, detail: res.error };
    }
    ops.transition(op.id, ["dispatching"], "done", `job ${res.job.id}`);
    return { ok: true, detail: res.job.id };
  }

  // ——— intern ———

  private isRisky(tool: ScanToolName): boolean {
    const decl = this.config.tools.find((t) => t.tool === tool);
    return decl ? decl.risky || (SCAN_RISKY_TOOLS as readonly string[]).includes(tool) : (SCAN_RISKY_TOOLS as readonly string[]).includes(tool);
  }

  /** D5: gescannt wird nur, was auf der Allowliste steht — sonst sichtbarer Abbruch. */
  private refuseOffList(target: string): string | null {
    if (this.config.targets.some((t) => t.target === target)) return null;
    return `Ziel „${target}" steht nicht auf der Allowliste (D5) — scannen tue ich nur, was dort steht.`;
  }

  private async run(request: PentestScanRequest, approvalId: string | null, _actor: string | null): Promise<ScanCall<{ job: PentestScanJob }>> {
    if (!this.backend) return { ok: false, error: this.statusCache.detail ?? "Kein Backend angebunden." };
    const refused = this.refuseOffList(request.target);
    if (refused) return { ok: false, error: refused };
    if (this.isRisky(request.tool) && !approvalId) return { ok: false, error: `Tool ${request.tool} ist als riskant deklariert — es läuft nur über die Freigabe (D4).` };

    const job: PentestScanJob = {
      id: randomUUID(),
      target: request.target,
      profile: request.profile,
      tool: request.tool,
      state: "queued",
      sourceRef: null,
      approvalId,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      summary: null,
      blob: null,
    };
    await this.journal.append(job);
    job.state = "running";
    job.startedAt = this.now();
    await this.journal.append(job);

    let response;
    try {
      response = await this.backend.scan(request.target, request.profile, AbortSignal.timeout(this.config.timeoutMs));
    } catch (err) {
      job.state = isTimeout(err) ? "timeout" : "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = this.now();
      await this.journal.append(job);
      return { ok: false, error: job.error };
    }

    const summary: PentestJobSummary = {
      hosts: response.parsed.hosts.length,
      hostsUp: response.parsed.hosts.filter((h) => h.status !== null && /up/i.test(h.status)).length,
      portsOpen: response.parsed.hosts.reduce((n, h) => n + h.ports.filter((p) => p.endsWith(":open")).length, 0),
      truncated: (response.output?.length ?? 0) >= SCAN_OUTPUT_MAX_CHARS,
    };
    // K5: Volltext als Blob (die ganze Backend-Antwort), die Journal-Zeile bleibt unter der Grenze.
    const blob = await this.journal.blobPut(JSON.stringify(response));
    if (Buffer.byteLength(JSON.stringify({ ...job, summary, blob }), "utf8") > SCAN_EVENT_MAX_BYTES) {
      this.deps.logger?.warn("Journal-Zeile trotz Blob über der K5-Grenze — Felder kappen");
    }
    job.state = "done";
    job.finishedAt = this.now();
    job.summary = summary;
    job.blob = blob;
    await this.journal.append(job);
    return { ok: true, job };
  }

  private now(): string {
    return new Date().toISOString();
  }
}

function isTimeout(err: unknown): boolean {
  return (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) || (err instanceof ScanBackendError && err.state === "unreachable" && /timeout|abort/i.test(err.message));
}

import { existsSync } from "node:fs";
import { mkdirSync, readFileSync, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopOnboardResult, LoopStartSpec, SessionHandle } from "@ancientvoid/contracts";

/** Ziel-Schlüssel (Epic oder Bug), z. B. „EPIC-P78“ oder „BUG-0170“. Gleiche Form wie die Hermes-Epic-Option des securesight-Connectors. */
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Endzustände des Goal-Gate-Protokolls: „wartend“ heißt Gate grün, wartet auf Jans Abnahme (Mensch-Gate). */
const END_STATES = new Set(["wartend", "stopped", "blocked"]);

const s = (x: unknown, max = 200): string | undefined => (typeof x === "string" ? (x.length > max ? `${x.slice(0, max - 1)}…` : x) : undefined);
const n = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const obj = (x: unknown): Record<string, unknown> => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const count = (x: unknown): number | undefined => (Array.isArray(x) ? x.length : n(x));
const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

interface RalphState {
  status: string;
  paused?: boolean;
  tasks_done?: unknown;
  tasks_total?: unknown;
  current_task?: unknown;
  gate_fails?: unknown;
  report_pending?: unknown;
  notes?: unknown;
  user_gates?: unknown;
  [k: string]: unknown;
}

interface Run {
  target: string;
  stateFile: string;
  io: LoopIo;
  health: HealthReport;
  paused: boolean;
  closed: boolean;
  last: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * Ralph-Loop (ADR-0038): beobachtet EIN Ziel (Epic oder Bug) im Ralph-State-Dir (`~/.hermes/ralph`
 * per Default, Konfiguration `stateDir`). Der Goal-Gate-Runner arbeitet autonom weiter, bis jede
 * Akzeptanz-Kriterium deterministisch verifiziert ist — der Connector startet KEINE Prozesse
 * (Rollentrennung: Runner und Watchdog betreibt die Person lokal), er legt höchstens das
 * State-File an, wenn das Ziel noch keins hat, und macht Fortschritt, Gates und Endzustände
 * als loop.*-Ereignisse sichtbar. `wartend` ist der einzige Zustand, der Abnahme braucht: Jan.
 */
export function createLoopConnector(config: Readonly<Record<string, unknown>> = {}): LoopConnector {
  const runs = new Map<string, Run>();
  const stateDir = typeof config.stateDir === "string" && config.stateDir ? config.stateDir : join(homedir(), ".hermes", "ralph");
  const pollMs = typeof config.pollMs === "number" && config.pollMs >= 20 ? Math.min(config.pollMs, 30_000) : 5_000;

  const CAPABILITIES: LoopCapabilities = {
    agents: "external",
    intake: ["backlog"],
    modes: ["goal-gate"],
    riskyModes: [],
    orchestrators: ["hermes"],
    controls: ["pause", "resume"],
    gates: ["verify"],
    asks: "permission",
    options: [
      { key: "target", label: "Ziel (Epic oder Bug)", kind: "text", required: true, placeholder: "z. B. EPIC-P78 oder BUG-0170" },
    ],
  };

  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary: summary.slice(0, 200), payload: { loop: "ralph", kind, ...payload } });

  const save = (run: Run) => run.io.saveCursor({ target: run.target, paused: run.paused, last: Object.fromEntries([...run.last].slice(-40)) });
  const changed = (run: Run, key: string, value: unknown): boolean => {
    const next = JSON.stringify(value);
    if (run.last.get(key) === next) return false;
    run.last.delete(key);
    run.last.set(key, next);
    save(run);
    return true;
  };

  const readState = (file: string): { ok: true; value: RalphState } | { ok: false; reason: string } => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return { ok: true, value: parsed as RalphState };
      return { ok: false, reason: "State-File ist kein JSON-Objekt" };
    } catch (err) {
      const missing = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
      return { ok: false, reason: missing ? "missing" : `State-File unlesbar (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` };
    }
  };

  /** Legt das State-File an, falls das Ziel noch keins hat — der Runner verlangt State VOR Start (Deploy-Regel). */
  const ensureState = (target: string, file: string): void => {
    if (existsSync(file)) return;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ epic: target, status: "running", started_at: new Date().toISOString(), last_progress_at: new Date().toISOString(), tasks_done: [], tasks_total: [], notes: [] }, null, 2)}\n`);
  };

  const broken = (run: Run, ctx: AdapterContext, reason: string) => {
    run.health = { state: "broken", detail: reason };
    if (changed(run, "broken", reason)) note(ctx, "loop.broken", `ralph: ${reason}`, { reason });
  };
  const recovered = (run: Run, ctx: AdapterContext) => {
    const reason = run.last.get("broken");
    if (reason === undefined) return;
    run.last.delete("broken");
    save(run);
    note(ctx, "loop.recovered", "ralph: State wieder lesbar", { reason: JSON.parse(reason) as string });
  };

  function poll(run: Run, ctx: AdapterContext): void {
    if (run.closed) return;
    const doc = readState(run.stateFile);
    if (!doc.ok) {
      broken(run, ctx, doc.reason === "missing" ? `State für „${run.target}“ nicht gefunden` : doc.reason);
      return;
    }
    recovered(run, ctx);
    const v = doc.value;
    const status = typeof v.status === "string" ? v.status : "?";
    const done = count(v.tasks_done);
    const total = count(v.tasks_total);
    const gates = obj(v.user_gates);
    const userGates = Object.fromEntries(Object.entries(gates).flatMap(([k, val]) => (typeof val === "boolean" ? [[k.slice(0, 40), val]] : [])).slice(0, 8));
    const payload = compact({
      done,
      total,
      status: s(status, 40),
      step: s(v.current_task, 100),
      gateFails: n(v.gate_fails),
      paused: run.paused || undefined,
      reportPending: v.report_pending === true || undefined,
      userGates: Object.keys(userGates).length > 0 ? userGates : undefined,
    });
    if (changed(run, "progress", payload)) {
      note(ctx, "loop.progress", `Ralph ${status}: ${done ?? 0} von ${total ?? 0}${run.paused ? " (pausiert)" : ""}`, { source: "ralph", epic: run.target, ...payload });
    }
    if (END_STATES.has(status)) {
      const detail =
        status === "wartend"
          ? `Gate grün — wartet auf Jans Abnahme${v.report_pending === true ? " (Report liegt bereit)" : ""}`
          : status === "blocked"
            ? `Ziel blockiert (Gate ${n(v.gate_fails) ?? "?"}× rot oder Jan-Gate)`
            : "Ziel manuell gestoppt";
      if (changed(run, "end", status)) {
        run.health = { state: "degraded", detail };
        note(ctx, "loop.notify", `ralph: ${detail}`, { source: "ralph", epic: run.target, status: s(status, 40), level: status === "wartend" ? "1" : "2", reason: detail });
      }
      return;
    }
    run.health = run.paused ? { state: "degraded", detail: "pausiert" } : { state: "healthy" };
    run.last.delete("end");
    save(run);
  }

  const closeRun = (run: Run): void => {
    run.closed = true;
    if (run.timer) clearInterval(run.timer);
    unwatchFile(run.stateFile);
  };

  return {
    id: "ralph",
    version: "0.1.0",
    capabilities: () => CAPABILITIES,
    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      const target = spec.options.target?.trim() ?? "";
      if (!TARGET_PATTERN.test(target)) throw new Error(`Option „target“ fehlt oder ist ungültig: „${target}“ (z. B. EPIC-P78 oder BUG-0170)`);
      const stateFile = join(stateDir, `${target}-state.json`);
      ensureState(target, stateFile);
      const resumed = io.resume as { paused?: boolean; last?: Record<string, string> } | null;
      const run: Run = {
        target,
        stateFile,
        io,
        health: { state: "degraded", detail: "noch nicht gelesen" },
        paused: resumed?.paused === true,
        closed: false,
        last: new Map(Object.entries(resumed?.last ?? {})),
        timer: null,
      };
      runs.set(ctx.sessionId, run);
      poll(run, ctx);
      run.timer = setInterval(() => poll(run, ctx), pollMs);
      run.timer.unref();
      // K7-Freundliche Ergänzung zum Interval: Datei-Änderungen wecken den Poll sofort.
      watchFile(stateFile, { interval: Math.max(pollMs, 1_000) }, () => poll(run, ctx));
      ctx.signal.addEventListener("abort", () => closeRun(run), { once: true });
      return { sessionId: ctx.sessionId, meta: { target, ...(run.paused ? { paused: true } : {}) } };
    },
    async control(handle: SessionHandle, input: LoopControlInput): Promise<Ack> {
      if (input.kind !== "pause" && input.kind !== "resume") {
        return { ok: false, detail: `Befehl „${input.kind}“ gibt es nicht: ralph kennt nur pause/resume (Arbeitsteilung übernimmt der lokale Runner)` };
      }
      // Nach SessionId, nicht „irgendein offener Lauf“: mehrere Ziele laufen nebeneinander.
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return { ok: false, detail: "kein aktiver Lauf" };
      const doc = readState(run.stateFile);
      if (!doc.ok) return { ok: false, detail: `State unlesbar: ${doc.reason}` };
      run.paused = input.kind === "pause";
      const next: RalphState = { ...doc.value, paused: run.paused };
      try {
        writeFileSync(run.stateFile, `${JSON.stringify(next, null, 2)}\n`);
      } catch (err) {
        return { ok: false, detail: `konnte paused nicht speichern: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
      }
      save(run);
      return { ok: true, detail: run.paused ? "pausiert (Runner sieht paused:true im State-File)" : "fortgesetzt" };
    },
    async status(handle: SessionHandle): Promise<HealthReport> {
      const run = runs.get(handle.sessionId);
      return !run || run.closed ? { state: "down", detail: "getrennt" } : run.health;
    },
    async onboard(): Promise<LoopOnboardResult> {
      // Kein Onboarding pro Repo nötig; bewusst kein capabilities().onboarding.
      return { ok: false, detail: "ralph braucht keine Einrichtung pro Repo" };
    },
    async stop(handle: SessionHandle): Promise<void> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return;
      closeRun(run);
    },
  };
}

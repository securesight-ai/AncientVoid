import { randomUUID } from "node:crypto";
import type { AutomationDefinition, AutomationSkipReason, AutomationOutcome } from "@ancientvoid/contracts";
import type { AutomationStore, ClaimState } from "./store.ts";
import { nextOccurrences, previousOccurrence } from "./schedule.ts";

export type DispatchResult =
  | { ok: true; sessionId?: string; swarmId?: string }
  | { ok: false; reason: AutomationSkipReason; uncertain?: boolean; detail?: string };
export type PrecheckResult = "ok" | null | AutomationSkipReason;
export type ExecutionStatus =
  | { state: "running" }
  | { state: "settled"; outcome: AutomationOutcome }
  | { state: "unknown"; detail: string };

export interface AutomationsDeps {
  store: AutomationStore;
  hostId: string;
  now: () => number;
  precheck(definition: AutomationDefinition, deadlineMs: number): Promise<PrecheckResult>;
  dispatch(definition: AutomationDefinition, claimKey: string, occurrenceUtc: string, kind: "due" | "run_now" | "catchup"): Promise<DispatchResult>;
  inspect?(claim: ClaimState): Promise<ExecutionStatus>;
  log?: (line: string) => void;
}

/** ADR-0065: Kalendercursor und Claims vor dem Start fsyncen; Ausführung bleibt beim Eigentümer. */
export class AutomationsScheduler {
  private readonly deps: AutomationsDeps;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(deps: AutomationsDeps, intervalMs = 60_000) {
    this.deps = deps;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const poll = () => void this.tick().catch((err: unknown) => this.deps.log?.(`scheduler failed: ${String(err)}`));
    this.timer = setInterval(poll, Math.min(this.intervalMs, 1000));
    poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): Promise<void> { return this.processTick(); }

  private async processTick(): Promise<void> {
    if (this.stopped) return;
    await this.reconcile();
    const now = this.deps.now();
    await Promise.all(this.deps.store.listDefinitions().filter(d => d.enabled && d.hostId === this.deps.hostId).map(async def => {
      try { await this.processDefinition(def, now); }
      catch (err) { this.deps.log?.(`automation ${def.id} failed: ${String(err)}`); }
    }));
    this.deps.store.saveSnapshot();
  }

  async reconcile(): Promise<void> {
    if (!this.deps.inspect) return;
    for (const def of this.deps.store.listDefinitions()) {
      if (def.hostId !== this.deps.hostId) continue;
      for (const claim of this.deps.store.claimsFor(def.id)) {
        if (claim.state !== "dispatched" && !(claim.state === "unknown" && (claim.sessionId || claim.swarmId))) continue;
        try {
          const status = await this.deps.inspect(claim);
          if (status.state === "running") continue;
          this.deps.store.updateClaim(claim.claimKey, status.state === "settled"
            ? { state: "settled", outcome: status.outcome }
            : { state: "unknown", detail: status.detail.slice(0, 500) }, new Date(this.deps.now()).toISOString());
        } catch (err) { this.deps.log?.(`result probe ${claim.claimKey}: ${String(err)}`); }
      }
    }
  }

  async runNow(definitionId: string): Promise<ClaimState | null> {
    const def = this.deps.store.definition(definitionId);
    if (!def) return null;
    await this.reconcile();
    return this.handleOccurrence(def, new Date(this.deps.now()).toISOString(), "run_now");
  }

  requestRunNow(definitionId: string): ClaimState | null {
    const def = this.deps.store.definition(definitionId);
    if (!def) return null;
    const occurrence = new Date(this.deps.now()).toISOString();
    const revision = this.deps.store.revision(def.id);
    const claim = this.deps.store.claim(def.id, def.generation, occurrence, occurrence, { kind: "run_now", operationId: randomUUID() });
    if (!claim) return null;
    // Der Claim ist dauerhaft; K1 wartet nicht auf einen langsamen Precheck.
    void this.reconcile().then(() => this.processClaim(def, claim, revision, "run_now")).catch(err => this.deps.log?.(`run-now ${claim.claimKey}: ${String(err)}`));
    return structuredClone(claim);
  }

  settle(claimKey: string, outcome: AutomationOutcome): ClaimState | null {
    return this.deps.store.updateClaim(claimKey, { state: "settled", outcome }, new Date(this.deps.now()).toISOString());
  }

  private async processDefinition(def: AutomationDefinition, nowMs: number): Promise<void> {
    const nowIso = new Date(nowMs).toISOString();
    const previousClaims = this.deps.store.claimsFor(def.id).filter(c => c.generation === def.generation && c.kind !== "run_now");
    const previous = previousClaims.reduce((max, c) => c.occurrenceUtc > max ? c.occurrenceUtc : max, def.createdAtUtc);
    const storedCursor = this.deps.store.cursorFor(def.id, def.generation);
    const cursor = storedCursor && storedCursor > previous ? storedCursor : previous;
    const first = nextOccurrences(def.schedule, cursor, 1)[0]?.utc;
    if (!first || first > nowIso) return;
    const latest = previousOccurrence(def.schedule, nowIso);
    if (!latest || latest < first) return;
    const lateness = nowMs - Date.parse(latest);
    const runnable = lateness <= this.intervalMs || lateness <= def.grant.missedGraceMs;
    const missedThrough = runnable ? previousOccurrence(def.schedule, new Date(Date.parse(latest) - 1).toISOString()) : latest;
    if (missedThrough && missedThrough >= first) {
      const missed = this.deps.store.claim(def.id, def.generation, first, nowIso, { kind: "catchup" });
      if (missed) this.deps.store.updateClaim(missed.claimKey, { state: "skipped", reason: "missed", missedThroughUtc: missedThrough }, nowIso);
    }
    // Auch ein Crash vor dem Dispatch wiederholt keinen bereits beanspruchten Termin.
    if (runnable) await this.handleOccurrence(def, latest, lateness <= this.intervalMs ? "due" : "catchup", nowIso);
    this.deps.store.advanceCursor(def.id, def.generation, latest, nowIso);
  }

  private async handleOccurrence(def: AutomationDefinition, occurrenceUtc: string, kind: "due" | "run_now" | "catchup", at?: string): Promise<ClaimState | null> {
    const now = () => new Date(this.deps.now()).toISOString();
    const store = this.deps.store;
    const revision = store.revision(def.id);
    const claim = store.claim(def.id, def.generation, occurrenceUtc, at ?? now(), { kind, ...(kind === "run_now" ? { operationId: randomUUID() } : {}) });
    if (!claim) return null;
    return this.processClaim(def, claim, revision, kind);
  }

  private async processClaim(def: AutomationDefinition, claim: ClaimState, revision: number, kind: "due" | "run_now" | "catchup"): Promise<ClaimState | null> {
    const now = () => new Date(this.deps.now()).toISOString();
    const store = this.deps.store;
    const occurrenceUtc = claim.occurrenceUtc;
    const skip = (reason: AutomationSkipReason, detail?: string) => store.updateClaim(claim.claimKey, { state: "skipped", reason, ...(detail ? { detail: detail.slice(0, 500) } : {}) }, now());
    if (this.stopped || (kind !== "run_now" && !def.enabled)) return skip("disabled");
    if (def.hostId !== this.deps.hostId) return skip("host_down");
    if (store.inFlight(def.id) > def.grant.maxParallel) return skip("overlap");
    if (def.precheckActionId) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const verdict = await Promise.race([
          this.deps.precheck(def, def.precheckDeadlineMs),
          new Promise<PrecheckResult>(resolve => { timer = setTimeout(() => resolve("precheck_timeout"), def.precheckDeadlineMs); }),
        ]);
        if (verdict !== null && verdict !== "ok") return skip(verdict);
      } catch (err) { return skip("precheck", String(err)); }
      finally { if (timer) clearTimeout(timer); }
    }
    const current = store.definition(def.id);
    if (this.stopped || !current || (kind !== "run_now" && !current.enabled)) return skip("disabled");
    if (current.generation !== def.generation || store.revision(def.id) !== revision) return skip("changed");
    try {
      const result = await this.deps.dispatch(def, claim.claimKey, occurrenceUtc, kind);
      if (result.ok) return store.updateClaim(claim.claimKey, { state: "dispatched", ...(result.sessionId ? { sessionId: result.sessionId } : {}), ...(result.swarmId ? { swarmId: result.swarmId } : {}) }, now());
      if (result.uncertain) return store.updateClaim(claim.claimKey, { state: "unknown", detail: result.detail?.slice(0, 500) ?? "Startauftrag ohne eindeutige Bestätigung" }, now());
      return skip(result.reason, result.detail);
    } catch (err) {
      // Der Eigentümer könnte bereits gestartet haben. Ohne Referenz niemals blind wiederholen.
      return store.updateClaim(claim.claimKey, { state: "unknown", detail: String(err).slice(0, 500) }, now());
    }
  }
}

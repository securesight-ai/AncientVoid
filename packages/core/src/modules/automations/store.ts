import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, truncateSync } from "node:fs";
import { resolve } from "node:path";
import type { AutomationDefinition, AutomationClaimState, AutomationSkipReason, AutomationOutcome, AutomationHistoryEntry } from "@ancientvoid/contracts";
import { MAX_EVENT_PAYLOAD_BYTES, AutomationDefinition as AutomationDefinitionSchema, automationClaimKey } from "@ancientvoid/contracts";

type DefinitionInput = Parameters<typeof AutomationDefinitionSchema.parse>[0];

/**
 * EPIC-P41 T41.3 (ADR-0064): Journal + Snapshot für Definitionen und Claims
 * (Forge-Store-Muster, K7). Der Claim-Schlüssel ist deterministisch; ein
 * Claim pro Schlüssel. Nach einem Crash wird NIE blind replays — ein Claim in
 * `claimed` ohne Dispatch bleibt unklar, und das ist ein dokumentierter Zustand.
 */

export type JournalEvent =
  | { seq: number; type: "definition"; at: string; definition: AutomationDefinition }
  | { seq: number; type: "cursor"; at: string; automationId: string; generation: number; throughUtc: string }
  | { seq: number; type: "claim"; at: string; claimKey: string; automationId: string; generation: number; occurrenceUtc: string; kind?: ClaimState["kind"]; operationId?: string }
  | {
      seq: number;
      type: "claim_update";
      at: string;
      claimKey: string;
      state: AutomationClaimState;
      reason?: AutomationSkipReason;
      outcome?: AutomationOutcome;
      missedThroughUtc?: string;
      detail?: string;
      swarmId?: string;
      sessionId?: string;
      /** ADR-0077/ADR-0123: Alte Journalzeilen tragen `runId` (bis P60) oder `teamId` (bis P83) — tolerant übernehmen. */
      runId?: string;
      teamId?: string;
    };

export type ClaimState = AutomationHistoryEntry;

interface Snapshot {
  cursors?: [string, string][];
  appliedSeq: number;
  definitions: AutomationDefinition[];
  claims: ClaimState[];
}

/**
 * Abgeschlossene (settled/skipped) Claims, die je Automation im Zustand bleiben.
 * Ältere fallen beim Snapshot heraus — sonst wächst jeder Tick mit der Laufzeit
 * (K8). Offene Claims (claimed/dispatched/unknown) bleiben immer.
 */
export const CLAIM_HISTORY_KEEP = 200;

/** Omit über eine Union muss verteilen, sonst kollabiert es auf die Gemeinsamkeiten. */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

export class AutomationStore {
  private readonly root: string;
  private readonly definitions = new Map<string, AutomationDefinition>();
  private readonly claims = new Map<string, ClaimState>();
  private readonly byAutomation = new Map<string, Map<string, ClaimState>>();
  private readonly cursors = new Map<string, string>();
  private readonly revisions = new Map<string, number>();
  private seq = 0;
  private snapshotSeq = 0;

  constructor(root: string) {
    this.root = root;
    this.replay();
  }

  /** K7: Zustand ausschließlich aus Snapshot + Journal. */
  private replay(): void {
    let snapshot: Snapshot = { appliedSeq: 0, definitions: [], claims: [] };
    if (existsSync(resolve(this.root, "snapshot.json"))) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(this.root, "snapshot.json"), "utf8")) as Snapshot;
        if (typeof parsed.appliedSeq === "number") snapshot = parsed;
      } catch {
        snapshot = { appliedSeq: 0, definitions: [], claims: [] };
      }
    }
    for (const d of snapshot.definitions ?? []) { this.definitions.set(d.id, d); this.revisions.set(d.id, snapshot.appliedSeq); }
    for (const [key, value] of snapshot.cursors ?? []) this.cursors.set(key, value);
    for (const c of snapshot.claims ?? []) this.index(c);
    this.seq = snapshot.appliedSeq;
    this.snapshotSeq = snapshot.appliedSeq;
    const journalPath = resolve(this.root, "journal.jsonl");
    if (existsSync(journalPath)) {
      const contents = readFileSync(journalPath, "utf8");
      const lines = contents.split("\n");
      let validBytes = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.trim()) continue;
        let event: JournalEvent;
        try {
          event = JSON.parse(line) as JournalEvent;
        } catch {
          if (i === lines.length - 1 && !contents.endsWith("\n")) {
            truncateSync(journalPath, validBytes);
            console.warn("automations: unvollständigen Journal-Tail verworfen; vorhandene Claims werden nicht wiederholt");
            break;
          }
          throw new Error(`Automations-Journal beschädigt, Zeile ${i + 1}`);
        }
        validBytes += Buffer.byteLength(line + "\n");
        if (typeof event.seq !== "number" || !["definition", "claim", "claim_update", "cursor"].includes(event.type)) throw new Error("Unbekanntes Automations-Journalformat");
        if (event.seq <= snapshot.appliedSeq) continue;
        this.apply(event);
        this.seq = Math.max(this.seq, event.seq);
      }
    }
  }

  private apply(event: JournalEvent): void {
    if (event.type === "definition") {
      this.definitions.set(event.definition.id, event.definition);
      this.revisions.set(event.definition.id, event.seq);
      return;
    }
    if (event.type === "cursor") {
      this.cursors.set(`${event.automationId}:${event.generation}`, event.throughUtc);
      return;
    }
    if (event.type === "claim") {
      if (this.claims.has(event.claimKey)) return; // Dedupe: der erste Claim gewinnt (K7-Replay inklusive).
      this.index({
        claimKey: event.claimKey,
        automationId: event.automationId,
        generation: event.generation,
        occurrenceUtc: event.occurrenceUtc,
        state: "claimed",
        ...(event.kind ? { kind: event.kind } : {}),
        ...(event.operationId ? { operationId: event.operationId } : {}),
        at: event.at,
      });
      return;
    }
    const claim = this.claims.get(event.claimKey);
    if (!claim) return;
    claim.state = event.state;
    if (event.missedThroughUtc !== undefined) claim.missedThroughUtc = event.missedThroughUtc;
    if (event.detail !== undefined) claim.detail = event.detail;
    if (event.reason !== undefined) claim.reason = event.reason;
    if (event.outcome !== undefined) claim.outcome = event.outcome;
    if (event.swarmId !== undefined) claim.swarmId = event.swarmId;
    else if (event.teamId !== undefined) claim.swarmId = event.teamId;
    else if (event.runId !== undefined) claim.swarmId = event.runId;
    if (event.sessionId !== undefined) claim.sessionId = event.sessionId;
    claim.at = event.at;
  }

  private index(claim: ClaimState): void {
    this.claims.set(claim.claimKey, claim);
    let own = this.byAutomation.get(claim.automationId);
    if (!own) this.byAutomation.set(claim.automationId, own = new Map());
    own.set(claim.claimKey, claim);
  }

  private append(event: WithoutSeq<JournalEvent>): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const full = { ...event, seq: this.seq + 1 } as JournalEvent;
    const line = `${JSON.stringify(full)}\n`;
    if (Buffer.byteLength(line) > MAX_EVENT_PAYLOAD_BYTES) throw new Error("Automations-Journalpayload überschreitet K5 (4 KiB); große Inhalte als Blob speichern");
    appendFileSync(resolve(this.root, "journal.jsonl"), line, { mode: 0o600, flush: true });
    this.seq = full.seq;
    this.apply(full); // der Laufzeit-Spiegel des Journals — sonst lebt der Zustand nur auf der Platte
  }

  /** Neue Definition (Generation 1, deaktiviert); jede wesentliche Änderung erhöht die Generation. */
  upsertDefinition(definition: DefinitionInput, nowIso: string): AutomationDefinition {
    const parsed = AutomationDefinitionSchema.parse(definition) as AutomationDefinition;
    const previous = this.definitions.get(parsed.id);
    const material = previous !== undefined && JSON.stringify({ ...previous, enabled: parsed.enabled, generation: 1 }) !== JSON.stringify({ ...parsed, generation: 1 });
    const stored: AutomationDefinition = {
      ...parsed,
      generation: previous === undefined ? 1 : material ? previous.generation + 1 : previous.generation,
    };
    this.append({ type: "definition", at: nowIso, definition: stored });
    this.definitions.set(stored.id, stored);
    return stored;
  }

  claim(automationId: string, generation: number, occurrenceUtc: string, nowIso: string, metadata: { kind?: ClaimState["kind"]; operationId?: string } = {}): ClaimState | null {
    const key = automationClaimKey(automationId, generation, occurrenceUtc) + (metadata.operationId ? `:${metadata.operationId}` : "");
    if (this.claims.has(key)) return null;
    this.append({ type: "claim", at: nowIso, claimKey: key, automationId, generation, occurrenceUtc, ...metadata });
    return this.claims.get(key) ?? null;
  }

  updateClaim(claimKey: string, patch: { state: AutomationClaimState; reason?: AutomationSkipReason; outcome?: AutomationOutcome; swarmId?: string; sessionId?: string; detail?: string; missedThroughUtc?: string }, nowIso: string): ClaimState | null {
    const claim = this.claims.get(claimKey);
    if (!claim) return null;
    this.append({ type: "claim_update", at: nowIso, claimKey, ...patch });
    return this.claims.get(claimKey) ?? null;
  }

  definition(id: string): AutomationDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(): AutomationDefinition[] {
    return [...this.definitions.values()];
  }

  claimsFor(automationId: string): ClaimState[] {
    return [...(this.byAutomation.get(automationId)?.values() ?? [])];
  }

  hasClaim(key: string): boolean {
    return this.claims.has(key);
  }

  /** Offene (nicht abgerechnete) Claims einer Definition — Basis der Überlappungsprüfung. */
  inFlight(automationId: string): number {
    return this.claimsFor(automationId).filter((c) => c.state === "claimed" || c.state === "dispatched" || c.state === "unknown").length;
  }

  revision(id: string): number { return this.revisions.get(id) ?? 0; }

  cursorFor(id: string, generation: number): string | undefined { return this.cursors.get(`${id}:${generation}`); }

  advanceCursor(id: string, generation: number, throughUtc: string, at: string): void {
    const previous = this.cursorFor(id, generation);
    if (previous && previous >= throughUtc) return;
    this.append({ type: "cursor", automationId: id, generation, throughUtc, at });
  }

  /** Nur bei Änderung; danach trägt der Snapshot alles und das Journal beginnt leer (K7, K8). */
  saveSnapshot(): void {
    if (this.seq === this.snapshotSeq) return;
    this.pruneHistory();
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const snapshot: Snapshot = { cursors: [...this.cursors], appliedSeq: this.seq, definitions: [...this.definitions.values()], claims: [...this.claims.values()] };
    const path = resolve(this.root, "snapshot.json");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600, flush: true });
    renameSync(tmp, path);
    // Ein Absturz vor dem Kürzen ist harmlos: das Replay überspringt seq ≤ appliedSeq.
    const journalPath = resolve(this.root, "journal.jsonl");
    if (existsSync(journalPath)) truncateSync(journalPath, 0);
    this.snapshotSeq = this.seq;
  }

  private pruneHistory(): void {
    for (const own of this.byAutomation.values()) {
      const done = [...own.values()].filter((c) => c.state === "settled" || c.state === "skipped");
      if (done.length <= CLAIM_HISTORY_KEEP) continue;
      done.sort((a, b) => a.at.localeCompare(b.at));
      for (const c of done.slice(0, done.length - CLAIM_HISTORY_KEEP)) {
        own.delete(c.claimKey);
        this.claims.delete(c.claimKey);
      }
    }
  }
}

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AutomationDefinition as DefinitionSchema,
  type AutomationDefinition,
  type AutomationInfo,
  type AutomationOutcome,
  type AutomationTarget,
  SwarmStart,
  AUTOMATION_LIMITS,
} from "@ancientvoid/contracts";
import { AutomationStore, type ClaimState } from "./store.ts";
import { AutomationsScheduler, type DispatchResult, type PrecheckResult, type ExecutionStatus } from "./scheduler.ts";
import { nextOccurrences } from "./schedule.ts";

/**
 * EPIC-P41 T41.4: Dienst über Store und Scheduler. Launcher und Prechecker sind
 * injectable — die Kernschicht kennt weder SessionManager noch Prozessstart.
 * Neue Definitionen beginnen deaktiviert; jede wesentliche Änderung invalidiert
 * die alte Freigabe (Generation++ und deaktiviert, ADR-0064).
 */

type DefinitionInput = Parameters<typeof DefinitionSchema.parse>[0];
// zod4: parse nimmt unknown — die Routen reichen bereits validierte Definitionen durch.

export interface AutomationLauncher {
  /** Start beim Ausführungseigentümer. `dispatched` heißt Startauftrag, nie Erfolg. */
  template?(id: string): Promise<SwarmStart | null>;
  inspect?(claim: ClaimState): Promise<ExecutionStatus>;
  launch(definition: AutomationDefinition, promptText: string | null, claimKey: string, kind: "due" | "run_now" | "catchup"): Promise<DispatchResult>;
}

export interface AutomationPrechecker {
  /** null = erfüllt; sonst der getrennte Grund (precheck_exit/precheck_timeout/auth/quota/lease/host_down). */
  stop?(): void;
  run(actionId: string, definition: AutomationDefinition, deadlineMs: number, templateText?: string): Promise<PrecheckResult>;
}

export interface AutomationServiceDeps {
  root: string;
  hostId: string;
  launcher: AutomationLauncher;
  prechecker: AutomationPrechecker;
  now?: () => number;
  log?: (line: string) => void;
}

export class AutomationService {
  private readonly store: AutomationStore;
  private readonly hostId: string;
  private readonly scheduler: AutomationsScheduler;
  private readonly blobRoot: string;
  private readonly launcher: AutomationLauncher;
  private readonly prechecker: AutomationPrechecker;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(deps: AutomationServiceDeps) {
    this.hostId = deps.hostId;
    this.blobRoot = resolve(deps.root, "blobs");
    this.launcher = deps.launcher;
    this.prechecker = deps.prechecker;
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => undefined);
    this.store = new AutomationStore(deps.root);
    for (const definition of this.store.listDefinitions()) for (const claim of this.store.claimsFor(definition.id)) {
      if (claim.state === "claimed") this.store.updateClaim(claim.claimKey, { state: "unknown", detail: "Neustart nach Claim ohne bestätigte Dispatch-Referenz; kein Replay" }, new Date(this.now()).toISOString());
    }
    this.scheduler = new AutomationsScheduler({
      store: this.store,
      hostId: deps.hostId,
      now: this.now,
      log: this.log,
      ...(this.launcher.inspect ? { inspect: (claim: ClaimState) => this.launcher.inspect!(claim) } : {}),
      precheck: (definition, deadlineMs) => this.prechecker.run(definition.precheckActionId!, definition, deadlineMs, definition.target.kind === "swarm" ? this.blobText(definition.target.templateBlobSha256!)! : undefined),
      dispatch: (definition, claimKey, occurrenceUtc, kind) => this.launcher.launch(definition, this.targetBlobText(definition.target), claimKey, kind),
    });
  }

  /** Der HTTP-Aufrufer friert vorhandene P40-Aufträge vor der menschlichen Aktivierung ein. */
  async prepare(input: DefinitionInput): Promise<AutomationDefinition> {
    const definition = DefinitionSchema.parse(input);
    if (definition.hostId !== this.hostId) throw new Error("Automation gehört zu einem anderen Host");
    if (definition.target.kind === "swarm") {
      const template = await this.launcher.template?.(definition.target.templateId);
      if (!template) throw new Error("Swarm-Vorlage unbekannt oder noch ohne vollständigen Plan");
      const text = JSON.stringify(SwarmStart.parse(template));
      definition.target.templateBlobSha256 = this.writeBlob(text);
    }
    return definition;
  }

  async tick(): Promise<void> { await this.scheduler.tick(); }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
    this.prechecker.stop?.();
  }

  list(): AutomationInfo[] {
    const nowIso = new Date(this.now()).toISOString();
    return this.store.listDefinitions().map((definition) => {
      const claims = this.store.claimsFor(definition.id);
      const last = claims.reduce<ClaimState | null>((max, c) => (max === null || c.at > max.at ? c : max), null);
      return {
        definition,
        nextOccurrences: nextOccurrences(definition.schedule, nowIso, 5).map((o) => ({ utc: o.utc, local: o.local })),
        lastOccurrence: last === null ? null : { utc: last.occurrenceUtc, state: last.state, ...(last.reason ? { reason: last.reason } : {}), ...(last.outcome ? { outcome: last.outcome } : {}), ...(last.swarmId ? { swarmId: last.swarmId } : {}), ...(last.sessionId ? { sessionId: last.sessionId } : {}) },
      };
    });
  }

  template(id: string): SwarmStart | null {
    const definition = this.store.definition(id);
    if (definition?.target.kind !== "swarm" || !definition.target.templateBlobSha256) return null;
    return SwarmStart.parse(JSON.parse(this.blobText(definition.target.templateBlobSha256)!));
  }

  history(id: string): ClaimState[] {
    return this.store.claimsFor(id).sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Neue Definition: immer deaktiviert — die Aktivierung ist die menschliche Freigabe. */
  create(input: DefinitionInput, promptText?: string): AutomationDefinition {
    const definition = DefinitionSchema.parse(input);
    if (this.store.listDefinitions().length >= AUTOMATION_LIMITS.definitions) throw new Error("Automations-Kontingent ausgeschöpft");
    if (this.store.definition(definition.id)) throw new Error("Automation-ID bereits vorhanden");
    if (definition.hostId !== this.hostId) throw new Error("Automation gehört zu einem anderen Host");
    definition.enabled = false;
    definition.createdAtUtc = new Date(this.now()).toISOString();
    this.storeDefinition(definition, promptText, true);
    this.store.advanceCursor(definition.id, 1, definition.createdAtUtc, definition.createdAtUtc);
    return this.store.definition(definition.id)!;
  }

  /** Wesentliche Änderung = neue Generation = alte Freigabe invalidiert (ADR-0064). */
  update(id: string, input: DefinitionInput, promptText?: string): AutomationDefinition | null {
    const previous = this.store.definition(id);
    if (!previous) return null;
    const next = DefinitionSchema.parse({ ...(input as object), id: previous.id }) as AutomationDefinition;
    if (next.hostId !== this.hostId) throw new Error("Automation gehört zu einem anderen Host");
    if (next.generation !== previous.generation) throw new Error("Generation veraltet; Definition neu laden");
    next.createdAtUtc = previous.createdAtUtc;
    this.validatePrompt(next, promptText, false);
    const material = JSON.stringify({ ...previous, enabled: next.enabled, generation: previous.generation }) !== JSON.stringify({ ...next, generation: previous.generation });
    const stored = this.store.upsertDefinition(material ? { ...next, enabled: false } : { ...next, enabled: previous.enabled }, new Date(this.now()).toISOString());
    if (material) this.store.advanceCursor(id, stored.generation, new Date(this.now()).toISOString(), new Date(this.now()).toISOString());
    return stored;
  }

  /** Die Freigabe selbst: sie invalidiert sich nicht selbst (kein Generation++ bei reinem Enable). */
  setEnabled(id: string, enabled: boolean, generation?: number): AutomationDefinition | null {
    const previous = this.store.definition(id);
    if (!previous) return null;
    if (enabled && generation !== undefined && generation !== previous.generation) throw new Error("Generation veraltet; Definition neu laden");
    const now = new Date(this.now()).toISOString();
    const stored = this.store.upsertDefinition({ ...previous, enabled }, now);
    if (enabled && !previous.enabled) this.store.advanceCursor(id, stored.generation, now, now);
    return stored;
  }

  requestRunNow(id: string, generation: number): ClaimState | null {
    if (this.store.definition(id)?.generation !== generation) throw new Error("Generation veraltet; Definition neu laden");
    return this.scheduler.requestRunNow(id);
  }

  async runNow(id: string, generation?: number): Promise<ClaimState | null> {
    if (generation !== undefined && this.store.definition(id)?.generation !== generation) throw new Error("Generation veraltet; Definition neu laden");
    return this.scheduler.runNow(id);
  }

  /**
   * ADR-0072: ein unklarer Start ohne Referenz wird vom Menschen aufgegeben. Gibt
   * das Überlappungsbudget frei; kein Replay, kein erfundenes Ergebnis.
   * null = kein solcher Claim bei dieser Automation.
   */
  resolveUnknown(id: string, claimKey: string, note: string): ClaimState | null {
    const claim = this.store.claimsFor(id).find((c) => c.claimKey === claimKey);
    if (!claim) return null;
    if (claim.state !== "unknown") throw new Error(`Nur ein unklarer Start lässt sich aufgeben (Zustand: ${claim.state})`);
    if (claim.sessionId || claim.swarmId) throw new Error("Der Start hat eine Referenz; sein Ergebnis kommt aus dem Abgleich");
    this.log(`unknown aufgegeben ${claimKey}: ${note}`);
    return this.store.updateClaim(claimKey, { state: "settled", outcome: "abandoned", detail: `manuell aufgegeben: ${note}`.slice(0, 500) }, new Date(this.now()).toISOString());
  }

  /** Der Mensch rechnet das Ergebnis des referenzierten Laufs ab (Spiegel, K7). */
  settle(claimKey: string, outcome: AutomationOutcome): ClaimState | null {
    return this.scheduler.settle(claimKey, outcome);
  }

  private storeDefinition(definition: AutomationDefinition, promptText: string | undefined, isNew: boolean): void {
    this.validatePrompt(definition, promptText, isNew);
    this.store.upsertDefinition(definition, new Date(this.now()).toISOString());
  }

  private validatePrompt(definition: AutomationDefinition, promptText: string | undefined, isNew: boolean): void {
    // ADR-0080: Skript-Ziele führen eine registrierte argv-Aktion aus — kein Blob-Abgleich nötig.
    if (definition.target.kind === "script") return;
    if (definition.target.kind === "swarm") {
      if (!definition.target.templateBlobSha256 || this.blobText(definition.target.templateBlobSha256) === null) throw new Error("Swarm-Vorlage muss vor Anlage vorbereitet werden");
      return;
    }
    if (definition.target.kind === "session") {
      if (isNew && promptText === undefined) throw new Error("Session-Ziel ohne Prompt-Text: der Blob-Abgleich ist nicht möglich.");
      if (promptText !== undefined) {
        const sha = createHash("sha256").update(promptText).digest("hex");
        if (sha !== definition.target.promptBlobSha256) throw new Error(`Prompt-Blob passt nicht zur Definition: ${sha} != ${definition.target.promptBlobSha256}`);
        this.writeBlob(promptText);
      } else if (this.blobText(definition.target.promptBlobSha256) === null) {
        throw new Error("Prompt-Blob fehlt: Update braucht den passenden Prompt-Text.");
      }
    }
  }

  private writeBlob(text: string): string {
    const sha = createHash("sha256").update(text).digest("hex");
    mkdirSync(this.blobRoot, { recursive: true, mode: 0o700 });
    const path = resolve(this.blobRoot, `${sha}.txt`);
    if (!existsSync(path)) writeFileSync(path, text, { mode: 0o600, flush: true });
    return sha;
  }

  private blobText(sha: string): string | null {
    const path = resolve(this.blobRoot, `${sha}.txt`);
    if (!existsSync(path)) throw new Error(`Prompt-/Vorlagen-Blob ${sha} fehlt`);
    const text = readFileSync(path, "utf8");
    if (createHash("sha256").update(text).digest("hex") !== sha) throw new Error(`Prompt-Blob ${sha} ist verstümmelt — Fail loud, nicht raten.`);
    return text;
  }
  /** Prompt-/Vorlagentext des Ziels; Skripte haben keinen Blob (ADR-0080), fehlende Blobs failen laut. */
  private targetBlobText(target: AutomationTarget): string | null {
    if (target.kind === "script") return null;
    if (target.kind === "session") return this.blobText(target.promptBlobSha256);
    return this.blobText(target.templateBlobSha256!);
  }
}

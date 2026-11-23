import type { BlobRef, EmittedEvent } from "../sessions/event.ts";
import type { EmittedStreamFrame } from "../sessions/stream.ts"; // ADR-0083
import type { NativeDiscovery, NativeResume } from "./inventory.ts";
import type { SessionSpec, SessionInterruptionReason } from "../sessions/session.ts";
import type { ActivityReport } from "../sessions/activity.ts";
import type { ToolPermissionAnswer, ToolPermissionRequest } from "../approvals/tool-permission.ts";
import type { PromptAttachment } from "../attachments/attachment.ts";

/** ADR-0018: how a harness's tool calls are released. Ordered from the
 * strongest to the weakest guarantee; only `native` asks per call. */
export const TOOL_GATES = ["native", "sandbox", "allowlist", "bypass", "none"] as const;
export type ToolGate = (typeof TOOL_GATES)[number];

/**
 * ADR-0018: what a session of this adapter really accepts, per function —
 * replaces reading everything off `steer`. Computed from the adapter's
 * configuration (e.g. claude with --dangerously-skip-permissions is
 * `toolGate: "bypass"`). The server refuses what is `false` here.
 */
export interface HarnessFeatures {
  /** A new prompt after a turn. */
  followUp: boolean;
  /** Stop the running turn, keep the session continuable (`park`). */
  interrupt: boolean;
  toolGate: ToolGate;
  /** The provider asks typed questions the phone can answer. */
  questions: boolean;
  /** Model choosable when starting. */
  modelChoice: "start" | "none";
  /** ADR-0033: model changeable after the start (`configure`). */
  modelSwitch: boolean;
  /** ADR-0033: permission modes the session can run in, provider-specific
   * names (claude: auto, manual, plan …). Empty: no selectable mode. */
  permissionModes: readonly string[];
  skills: boolean;
  agents: boolean;
  /** Attachments to a prompt (T7.5). */
  images: boolean;
  files: boolean;
  /** Continue as a branch with the context so far. */
  contextFork: boolean;
}

/** ADR-0018: a harness that accepts follow-ups and can be stopped, and
 * nothing else — the starting point for adapters and test doubles. */
export function basicFeatures(overrides: Partial<HarnessFeatures> = {}): HarnessFeatures {
  return {
    followUp: true,
    interrupt: true,
    toolGate: "none",
    questions: false,
    modelChoice: "none",
    modelSwitch: false,
    permissionModes: [],
    skills: false,
    agents: false,
    images: false,
    files: false,
    contextFork: false,
    ...overrides,
  };
}

/** ADR-0018: one entry of an adapter's model catalog. */
export interface ModelOption {
  id: string;
  label?: string;
}

/**
 * ADR-0036 (EPIC-P17 T17.2): how a human continues this session OUTSIDE the
 * hub — the adapter's own CLI resume invocation, as a template. Display-only:
 * the hub substitutes `{sessionId}` when it knows the provider id, never
 * spawns the command itself.
 */
export interface AdapterResume {
  /** Argv template with `{sessionId}`/`{token}` placeholders. */
  argv: string[];
  /** "native" = the provider session id the adapter surfaced (PcState,
   * discovery); "token" = the adapter-internal resume handle (shown as a
   * placeholder — the hub never interprets `SessionHandle.internal`). */
  ref: "native" | "token";
  /** ADR-0044: start({ args: { resumeSessionId } }) without a new prompt
   * resumes the recorded native session through this adapter's protocol.
   * The adapter owns argv and stream parsing; argv above stays display-only.
   * Requires ref=native. Absent = display-only (ADR-0036 unchanged). */
  hub?: true;
  /** ADR-0044: auto-resume after an interrupt is allowed for this adapter.
   * Requires `hub`; absent = manual resume only. Declared only with
   * evidence that the CLI continues the session identically. */
  auto?: true;
}

/**
 * ADR-0042: a slash command the harness provably executes when driven
 * by the hub — declared only with evidence (documented for the driven mode
 * or live-verified); picker-only commands are never declared.
 */
export interface SlashCommand {
  /** With leading "/", lowercase `[a-z0-9-]`. */
  name: string;
  description: string;
  /** "start": only as the session's first prompt (aider `--message`, no
   * follow-up); "steer": only as a follow-up; "both": everywhere. */
  scope: "start" | "steer" | "both";
}

/**
 * What an adapter can do. Surfaced in dashboards, README matrix and the
 * MCP gateway catalog. Be honest — capabilities are promises (aSPARK lesson).
 */
export interface AdapterCapabilities {
  /** ADR-0076: adapters without native live steering use the durable hub queue. */
  promptDelivery?: "live" | "next-turn";
  /**
   * ADR-0085: der Adapter kann eine Meldung **mitten im laufenden Zug** annehmen, ohne
   * eine zweite native Session zu oeffnen (Pi: jeder Lenk-Aufruf ist ein eigener Lauf).
   * Das ist nicht dasselbe wie `steer` — Claude lenkt, aber nur im naechsten Zug, und ein
   * zweiter Prozess auf dieselbe native Session verbietet ADR-0074. Deshalb bleibt die
   * Ablehnung von "jetzt senden" fuer alle Adapter ohne diese Zusicherung erhalten.
   */
  midTurnInput?: boolean;

  /** ADR-0098: a start without prompt opens no turn — the session starts
   * idle instead of "working" (which nothing could ever settle). Only
   * adapters whose promptless start truly leaves no running work set this. */
  promptlessStartIdle?: boolean;
  /** Adapter emits reasoning/thinking events. */
  reasoning: boolean;
  /** Adapter performs tool calls (tool_use/tool_result events). */
  tools: boolean;
  /** Adapter reports real cost (native) — else the hub estimates or shows "unknown". */
  cost: boolean;
  /** Adapter accepts steering input mid-session. */
  steer: boolean;
  /** Adapter can in principle report an account-level usage/quota snapshot
   * (ADR-0004) — "can", not "every session sees one" (same honesty
   * standard as `reasoning`/`cost`). codex: false, verified absent from
   * its stream and CLI, not merely unimplemented. */
  usage: boolean;
  /** ADR-0032: the context window of the models this instance runs, in
   * tokens — configured, not provider-measured (nobody reports it in
   * band). Absent = unknown; the PWA shows no percentage then. */
  contextWindowTokens?: number;
  /** Sessions this process did not start. `read-only` only if the adapter scans without writing. */
  nativeDiscovery: NativeDiscovery;
  /** `native` only if steer/start reuses a provider session id. */
  nativeResume: NativeResume;
  /** ADR-0100 (EPIC-P72): the CLI reads `.claude/skills` itself and expands
   * `/<skill>` on its own — the hub never injects the chain block for such
   * an adapter (single load, K5). Absent/false = the hub injects as before. */
  nativeSkills?: boolean;
  /** ADR-0036: declared ONLY with a verified live hand-run against the
   * installed CLI (R9.7: no invented flags). Absent = no known external
   * continuation path — an honest state, not an error. */
  resume?: AdapterResume;
  /** ADR-0018: the per-function matrix. `steer` stays as the short form
   * (`followUp || interrupt`). */
  features: HarnessFeatures;
  /** ADR-0042: slash commands the CLI executes in the driven mode, sent
   * as normal prompt text over start/steer. Absent/empty = none proven —
   * the PWA says so instead of silently passing a slash as chat text. */
  commands?: readonly SlashCommand[];
}

export type HealthState = "healthy" | "degraded" | "down" | "broken";

export interface HealthReport {
  state: HealthState;
  /** Human-readable detail, e.g. unknown event types seen (degraded), CLI missing (down). */
  detail?: string;
  /** ISO timestamp of last successful adapter interaction. */
  lastSeen?: string;
}

export type SteerKind = "prompt" | "stop" | "park" | "resume" | "configure";

export const SteerInput = {
  prompt: (text: string) => ({ kind: "prompt", text }) as const,
  configure: (change: { model?: string; permissionMode?: string }) => ({ kind: "configure", ...change }) as const,
  stop: () => ({ kind: "stop" }) as const,
  park: () => ({ kind: "park" }) as const,
  resume: () => ({ kind: "resume" }) as const,
} as const;

export type SteerInput =
  | { kind: "prompt"; text: string; attachments?: PromptAttachment[] }
  | { kind: "stop" }
  | { kind: "park" }
  | { kind: "resume" }
  /** ADR-0033: change model and/or permission mode; applied at the latest on the next turn. */
  | { kind: "configure"; model?: string; permissionMode?: string };

export interface Ack {
  ok: boolean;
  detail?: string;
}

/** Handle returned by adapter.start(); opaque outside the adapter. */
export interface SessionHandle {
  readonly sessionId: string;
  /** OS pid of the underlying process, if any (tmux pane process, HTTP worker…). */
  readonly pid?: number;
  /** Adapter-internal bookkeeping (resume tokens etc.) — never interpreted by the hub. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Process abstraction the hub hands to adapters. Implemented on top of the
 * configured WorkerRunner (tmux by default, plain child_process as fallback).
 * Adapters never spawn OS processes directly — this keeps workers attachable,
 * reapable and swappable (ADR-P0-3).
 */
export interface WorkerProcess {
  readonly pid?: number;
  /** The worker's input channel, when known, including after adoption (ADR-0098). */
  readonly stdinMode?: "tty" | "pipe";
  /** tmux attach command for emergency debugging, if the runner supports it. */
  readonly attachCmd?: string;
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  /** Write to the process stdin (steering). */
  write(data: string): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  /** Resolve once the process exited. */
  exited(): Promise<{ code: number | null }>;
}

export interface SpawnOptions {
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Name hint for the worker (defaults to session id). */
  name?: string;
  /** T7.2: a real stdin stream (JSON-RPC over stdio, e.g. ACP). */
  stdin?: "tty" | "pipe";
  /** ADR-0013 Nachtrag: a long-lived agent process that serves many turns.
   * It does not count as a turn; the adapter reports turns with ctx.turn(). */
  persistent?: boolean;
}

/**
 * Everything an adapter may use from the hub. This is the adapter SDK
 * surface — keep it small, stable and testable.
 */
export interface AdapterContext {
  /** Hub setting for AncientVoid-managed compaction on adapter-owned requests. */
  readonly automaticCompaction?: boolean;
  /** The hub-assigned session id — use for handle.sessionId and logging. */
  readonly sessionId: string;
  /** Emit a normalized event; hub assigns seq/ts/sessionId and enforces K5. */
  emit(event: EmittedEvent): void;
  /**
   * ADR-0083: transiente Live-Frames (echtes Streaming) — kein Ereignis, kein
   * EventStore, kein Snapshot. Fehlt die Methode (älterer Hub, Testkit), sendet der
   * Adapter keine Frames; die Ausgabe erscheint dann blockweise, ohne dass
   * Streaming vorgetäuscht wird. Kohärieren: ≤ 1 Frame je 150 ms oder ab 1 KB.
   */
  stream?(frame: EmittedStreamFrame): void;
  /** Offload large content to the blob store, get a hash reference back. */
  blob(data: string | Uint8Array): Promise<BlobRef>;
  /** Spawn a managed worker process (tmux-backed by default). */
  spawnWorker(cmd: string[], opts?: SpawnOptions): Promise<WorkerProcess>;
  /** Structured adapter logging (goes to hub log, never to the event stream). */
  log(level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void;
  /** Aborted when the session is stopped/parked — adapters must shut down. */
  signal: AbortSignal;
  /** Absolute working directory for this session (worktree path from P2). */
  workdir: string;
  /** ADR-0014, only inside `recover()`: the worker that survived the hub
   * restart for this session, or null. Its output continues after the last
   * line the previous hub delivered. */
  adoptWorker?(opts?: { persistent?: boolean }): Promise<WorkerProcess | null>;
  /** ADR-0014: the provider's own session id as the hub last recorded it
   * (null when none was captured yet) — what `recover()` resumes with. */
  readonly nativeSessionId?: string | null;
  /** ADR-0061: the session's model as the hub last recorded it (`session.configured`; null = none chosen).
   * Lets an adapter that restarts its agent (wake, recover) keep the session's model instead of its default. */
  readonly model?: string | null;
  /** ADR-0018 §3 / T7.2: an MCP config that starts the hub's permission
   * bridge for this session, and the tool name to pass as
   * `--permission-prompt-tool`. Absent when the hub offers no bridge. */
  permissionBridge?(): Promise<{ mcpConfigPath: string; toolName: string }>;
  /** T7.2: an in-process adapter asks before a tool runs (ACP
   * request_permission). Resolves once the phone decided or the request
   * timed out — "deny" means: do not run it. Absent: no hub gate. */
  requestToolPermission?(req: ToolPermissionRequest): Promise<ToolPermissionAnswer>;
  /** ADR-0013 Nachtrag: turn start/end for adapters with a persistent
   * worker (they don't end a process per turn). */
  turn?(state: "working" | "idle"): void;
  /** ADR-0076: whether recovery is adopting an unfinished main turn. */
  readonly turnActive?: boolean;
  /** ADR-0076: work that may outlive the main turn; stable provider IDs. */
  activity?(activity: ActivityReport): void;
  /** Unplanned loss, distinct from a normal turn end and explicit stop. */
  interrupt?(reason: SessionInterruptionReason, detail?: string): void;
}

/**
 * THE adapter contract (PRD §4.2). Every provider integration — cloud CLI,
 * HTTP endpoint, local llama.cpp server, proprietary harness — implements
 * exactly this. If it can't be expressed here, extend the contract via an ADR,
 * don't special-case the hub.
 */
export interface Adapter {
  /** Stable adapter id, e.g. "claude", "codex", "local-llm", "dummy". */
  readonly id: string;
  /** Semver of the adapter itself. */
  readonly version: string;
  capabilities(): AdapterCapabilities;
  /** ADR-0018, optional: models a session can start with. */
  models?(): Promise<ModelOption[]>;
  start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle>;
  steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack>;
  status(handle: SessionHandle): Promise<HealthReport>;
  stop(handle: SessionHandle, ctx: AdapterContext): Promise<void>;
  /**
   * Optional: recover after a hub crash (K7). Receives the last emitted seq.
   * Re-attach to still-running workers or restart generation; return a fresh
   * handle. Returning null marks the session unrecoverable (status error).
   */
  recover?(sessionId: string, lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null>;
}

/**
 * Adapters are factories: `createAdapter(config?) => Adapter`.
 * This shape enables loading from npm packages and local paths alike.
 */
export type AdapterFactory = (config?: Readonly<Record<string, unknown>>) => Adapter;

/** Minimal shape check a loaded module must satisfy to be accepted by the registry. */
export function isValidAdapterFactory(mod: unknown): mod is { createAdapter: AdapterFactory } {
  if (typeof mod !== "object" || mod === null) return false;
  const fn = (mod as { createAdapter?: unknown }).createAdapter;
  return typeof fn === "function";
}

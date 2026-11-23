import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";
import { contentFromAnswers, fieldsFromSchema } from "./elicitation.ts";
import {
  basicFeatures,
  promptWithAttachments,
  providerErrorEvent,
  type Ack,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type HealthReport,
  type ModelOption,
  type PromptAttachment,
  type SessionHandle,
  type SessionSpec,
  type SlashCommand,
  type SteerInput,
  type WorkerProcess,
} from "@ancientvoid/contracts";
import { spawnArgv } from "@ancientvoid/contracts";
import { JsonRpcConnection as AcpConnection, RpcError } from "@ancientvoid/adapter-jsonrpc";
import { resolveContextWindow } from "@ancientvoid/models";
import { UpdateMapper, resolveRawInput, type SessionUpdate } from "./normalize.ts";
import { probeModelCatalog } from "./catalog.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * ACP adapter (T7.2, ADR-0018 §3): one Agent Client Protocol harness per
 * session, as a persistent worker (tmux pipe mode, ADR-0013 Nachtrag).
 * Tool permissions come back as `session/request_permission` and are
 * decided on the phone (`ctx.requestToolPermission`).
 *
 * Config (hub.config.json → adapters[].config):
 *   preset:  "copilot" | "opencode" | "dsh" | "maki" | "omp" — known command lines (below),
 *   command: the agent command line (overrides the preset),
 *   env:     extra environment for the agent,
 *   label:   name in summaries and errors (default: preset or "acp"),
 *   permissions: "hub" (default) — ask the phone; "reject" — deny all,
 *   model:   model when the session names none (see `pickModel`),
 *   stuckTurnMs: BUG-0032 — a busy turn with no agent message for this
 *             long is cancelled (`session/cancel`) and, if that stays
 *             unanswered too, force-ended. 0 disables. A pending
 *             permission request disarms it (waiting for the phone is
 *             not being stuck). Default 30 min.
 */

/** ACP ToolKind → the tool name shown on the approval card. */
const KIND_LABEL: Record<string, string> = {
  execute: "Shell",
  edit: "Bearbeiten",
  read: "Lesen",
  delete: "Löschen",
  move: "Verschieben",
  search: "Suchen",
  fetch: "Web-Abruf",
  think: "Denken",
  switch_mode: "Modus wechseln",
};

/** Known ACP harnesses. The opencode preset makes it ask for edits and
 * shell commands — by default it would run them unasked (ADR-0018). dsh
 * runs its tools in an OS sandbox; in `read-only` every write or command
 * that needs more asks for escalation — on the phone (T7.5, live verified). */
export const ACP_PRESETS = {
  // copilot 1.0.88 offers no model option over ACP (checked live 2026-09-24).
  copilot: { command: ["copilot", "--acp"], env: {}, models: false },
  opencode: {
    command: ["opencode", "acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "ask", bash: "ask", webfetch: "ask" } }) },
  },
  // dsh 0.2.1 answers initialize with promptCapabilities.image=false: images reach it as
  // the OCR text of the attachment (live checked 2026-10-21), not as image blocks.
  dsh: { command: ["dsh", "--profile", "acp"], env: { DSH_PERMISSION_MODE: "read-only" }, images: false },
  // maki 0.6.5 (maki.sh): `maki acp` fragt Rechte im Client ab, `question` wird zum ACP-Formular.
  // Provider/Thinking kommen aus ~/.config/maki (providers.toml, init.lua); Key per envFiles.
  maki: { command: ["maki", "acp"], env: {} },
  // oh-my-pi (omp 18.13.3, a pi fork): `omp acp` answers initialize with loadSession and session fork/resume/list
  // (live 2026-10-28). Credentials come from ~/.omp or the provider's env var (ZHIPU_API_KEY via envFiles).
  omp: { command: ["omp", "acp"], env: {} },
} as const satisfies Record<string, { command: string[]; env: Record<string, string>; models?: boolean; images?: boolean }>;

/** ADR-0042 (EPIC-P25 T25.2): slash commands each ACP harness provably
 * dispatches when the driver sends them as ordinary prompt text. Declared
 * only where the harness documents it — copilot's ACP server executes
 * built-in slash commands from a text block (docs.github.com …/acp-server,
 * picker commands excluded), omp dispatches its built-in registry in ACP
 * mode too (slash-command-internals.md). opencode: live verified
 * 17.11.2026 against 2.1.4 (BUG-0192) — "/compact" as prompt text ran as a
 * command (session_info_update _meta.opencode/compaction "started"→
 * "completed", reason "manual"; no model turn about the word), and the
 * agent advertises /init, /review, /compact via available_commands_update;
 * the ACP spec defines command invocation as command text inside a regular
 * prompt (agentclientprotocol.com/protocol/v1/slash-commands). "/new" is
 * opencode's own client-side command, no agent command — never declarable.
 * dsh/maki: no driven-mode evidence yet → nothing declared, the PWA says
 * so (fail loud, T25.6). */
const ACP_PRESET_COMMANDS: Record<string, readonly SlashCommand[]> = {
  copilot: [
    { name: "/compact", description: "Verlauf komprimieren", scope: "both" },
    { name: "/usage", description: "Gemessene Nutzung anzeigen", scope: "both" },
  ],
  omp: [
    // OMP 19.1.1 advertises and dispatches /fresh in ACP mode.
    { name: "/fresh", description: "Frischen Provider-Kontext starten", scope: "both" },
    { name: "/compact", description: "Kontext komprimieren, optional mit Anleitung", scope: "both" },
  ],
  opencode: [
    { name: "/init", description: "Geführtes AGENTS.md-Setup starten", scope: "both" },
    { name: "/review", description: "Änderungen reviewen (commit|branch|pr, sonst uncommitted)", scope: "both" },
    { name: "/compact", description: "Session komprimieren", scope: "both" },
  ],
};

/** maki über den ACP-Pfad (ADR-0042/P25): /new öffnet eine frische ACP-
 * Session — live belegt 2026-10-30 gegen maki 0.6.5 (BUG-0079). Die frühere
 * init.lua-Brücke ist für ACP tot: maki feuert agent.user_message dort nie
 * und run_command braucht eine UI. /compact und /rename sind nicht mehr
 * deklariert — ADR-0042 deklariert nur, was belegt ausgeführt wird. */
const MAKI_BRIDGE_COMMANDS: readonly SlashCommand[] = [
  { name: "/new", description: "Neue maki-Session mit frischem Kontext", scope: "both" },
];

const AcpConfig = z.object({
  preset: z.enum(["copilot", "opencode", "dsh", "maki", "omp"]).optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
  /** Umgebungsvariable → Datei mit dem Wert (`~/` aufgelöst); Schlüssel stehen so nie in der Config. */
  envFiles: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().min(1)).default({}),
  label: z.string().min(1).optional(),
  permissions: z.enum(["hub", "reject"]).default("hub"),
  model: z.string().min(1).optional(),
  /** How long initialize/session setup may take (npx may download first). */
  startupTimeoutMs: z.number().int().positive().default(120_000),
  /** BUG-0032: silence window within a busy turn before the hub cancels. */
  stuckTurnMs: z.number().int().min(0).default(1_800_000),
  /** ADR-0042/P25: maki dispatcht Commands im getriebenen Modus nur mit der
   *  init.lua-Brücke auf dem Host. Die Brücke ist Rechner-Config — erst
   *  dieses Flag deklariert Commands für diese Registration; ohne Flag
   *  bleibt die Liste leer (fail loud für Hosts ohne Brücke). */
  bridgeCommands: z.boolean().default(false),
  /** ADR-0032: context window of the models this instance runs — nobody
   * reports it in band; configured here, shown as a percentage then. */
  contextWindowTokens: z.number().int().positive().optional(),
  /** ADR-0032: per-model context windows — substring-matched over the
   * wanted model and the agent's raw value; wins over the built-in table
   * (@ancientvoid/models, Quelle models.dev). */
  contextWindows: z.record(z.string().min(1), z.number().int().positive()).default({}),
  /** Model catalog for the start form: a command printing one
   * `provider/model` per line. Derived for opencode (`opencode models`). */
  modelsCommand: z.array(z.string().min(1)).min(1).optional(),
});

const PROTOCOL_VERSION = 1;
/** How long a wanted model may take to appear in the agent's list. */
const MODEL_WAIT_MS = 5_000;
/** BUG-0033: buffered chunks go to the tail live while the turn runs —
 * the phone sees the agent working instead of silence until turn end. */
const LIVE_FLUSH_MS = 1_500;

/** What `session/new` says about models: the config option (ACP) or the
 * older `models` block (unstable API, still used by some agents). */
export interface SessionModels {
  configOptions?: { id: string; category?: string | null; currentValue?: unknown; options?: ({ value: string; name?: string } | { group?: string; options?: { value: string; name?: string }[] })[] }[];
  models?: { currentModelId?: string; availableModels?: { modelId: string; name?: string }[] } | null;
}

/**
 * ADR-0018 modelChoice "start": the wanted model → how to set it. Matches
 * the offered value, its name, or `provider/model` against a value that is
 * a JSON pair (dsh: `["gpubox","qwen3-coder"]`). Nothing matches → null, and
 * the caller says so visibly instead of running on another model.
 */
export function pickModel(res: SessionModels, wanted: string): { method: string; params: Record<string, unknown>; value: string } | null {
  const same = (value: string, name?: string) => {
    if (value === wanted || name === wanted) return true;
    try {
      const pair = JSON.parse(value) as unknown;
      return Array.isArray(pair) && pair.length === 2 && `${pair[0]}/${pair[1]}` === wanted;
    } catch {
      return false;
    }
  };
  const option = res.configOptions?.find((o) => o.category === "model" || o.id === "model");
  if (option) {
    const flat = (option.options ?? []).flatMap((o) => ("value" in o ? [o] : (o.options ?? [])));
    const hit = flat.find((o) => same(o.value, o.name));
    if (hit) return { method: "session/set_config_option", params: { configId: option.id, value: hit.value }, value: hit.value };
  }
  const model = res.models?.availableModels?.find((m) => same(m.modelId, m.name));
  if (model) return { method: "session/set_model", params: { modelId: model.modelId }, value: model.modelId };
  return null;
}

/** T7.10: prompt blocks — images as image content if the agent takes them. */
async function promptBlocks(text: string, attachments: readonly PromptAttachment[] | undefined, images: boolean): Promise<Record<string, unknown>[]> {
  const native = images ? (attachments ?? []).filter((a) => a.kind === "image" && a.bytes <= 10 * 1024 * 1024) : [];
  const { readFile } = await import("node:fs/promises");
  const blocks: Record<string, unknown>[] = [{ type: "text", text: promptWithAttachments(text, attachments, new Set(native.map((a) => a.id))) }];
  for (const a of native) blocks.push({ type: "image", mimeType: a.mimeType, data: (await readFile(a.path)).toString("base64") });
  return blocks;
}

interface AgentSession {
  proc: WorkerProcess;
  conn: AcpConnection;
  acpSessionId: string | null;
  busy: boolean;
  mapper: UpdateMapper;
  healthy: boolean;
  /** Stop läuft (stop() tötet den Prozess): der Exit macht die Session dann
   * absichtlich zu — nicht weckbar (EPIC-P35, dormant-on-exit). */
  stopping?: boolean;
  /** From initialize: the agent takes image content blocks. */
  images: boolean;
  /** Tool calls seen in updates — some agents (dsh) ask with the id only. */
  calls: Map<string, ToolCallInfo>;
  activeTools: Set<string>;
  /** Latest `config_option_update` — can be newer than the session/new answer. */
  configOptions: SessionModels["configOptions"];
  /** ADR-0061: what session/new|load offered — the basis for a later model switch. */
  offered?: SessionModels;
  onConfig: (() => void) | null;
  /** BUG-0032: every runTurn bump; a stale turn's late answers are ignored. */
  turnSeq: number;
  /** BUG-0036: session/load re-notifies the whole history — map+emit stay
   * off until the load answered; the hub's tail already has it all. */
  replay: boolean;
  stuckTimer: ReturnType<typeof setTimeout> | null;
  /** Open permission requests — the agent waits for the phone, not stuck. */
  pendingPermissions: number;
  /** Prompts sent while a turn runs — delivered when it ends (FIFO). */
  queued: { text: string; attachments?: readonly PromptAttachment[] }[];
}

type ToolCallInfo = { toolCallId?: string; title?: string | null; name?: string | null; kind?: string | null; rawInput?: unknown };

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = AcpConfig.parse(config ?? {});
  const preset = cfg.preset ? ACP_PRESETS[cfg.preset] : undefined;
  const command = cfg.command ?? (preset ? [...preset.command] : undefined);
  if (!command) throw new Error("acp adapter: config needs `preset` or `command`");
  const env: Record<string, string> = { ...(preset?.env ?? {}), ...cfg.env };
  for (const [name, file] of Object.entries(cfg.envFiles)) env[name] = readFileSync(file.replace(/^~(?=\/)/, homedir()), "utf8").trim();
  const label = cfg.label ?? cfg.preset ?? "acp";
  /** ADR-0018/0061: a preset without a model option (copilot) offers neither a start choice nor a switch. */
  const modelChoice = (): "start" | "none" => (preset && "models" in preset && !preset.models ? "none" : "start");
  const sessions = new Map<string, AgentSession>();
  /** BUG-0060: sessions restored after a hub restart with no surviving agent. The agent (and its
   * history load) starts with the next prompt, not at recovery — 17 ACP sessions took 65 s. */
  const dormant = new Map<string, { native: string }>();
  const waking = new Map<string, Promise<AgentSession>>();

  function emitAll(ctx: AdapterContext, events: ReturnType<UpdateMapper["flush"]>): void {
    for (const e of events) ctx.emit(e);
  }

  /** BUG-0032: re-arm the stuck watchdog — every agent message is activity. */
  function armStuckWatch(state: AgentSession, ctx: AdapterContext): void {
    if (state.stuckTimer) clearTimeout(state.stuckTimer);
    state.stuckTimer = null;
    if (cfg.stuckTurnMs <= 0) return;
    state.stuckTimer = setTimeout(() => unstickTurn(state, ctx), cfg.stuckTurnMs);
  }

  /** BUG-0032: a busy turn gone silent is cancelled loudly; an agent that
   * ignores the cancel is force-ended so the session recovers (was: busy
   * forever, every further prompt refused — 26 h live, 2026-09-25). */
  function unstickTurn(state: AgentSession, ctx: AdapterContext): void {
    state.stuckTimer = null;
    if (!state.busy || !state.healthy) return;
    if (state.pendingPermissions > 0 || state.activeTools.size > 0) return armStuckWatch(state, ctx);
    const minutes = Math.max(1, Math.round(cfg.stuckTurnMs / 60_000));
    const detail = `${label}: der Zug ist seit ${minutes} min stumm — Verbindung wird wiederhergestellt`;
    if (ctx.interrupt) {
      ctx.interrupt("adapter_down", detail);
      return;
    }
    ctx.emit(providerErrorEvent(label, detail));
    if (state.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
    const seq = state.turnSeq;
    setTimeout(() => {
      if (!state.busy || state.turnSeq !== seq) return; // the cancel was honored — normal turn end took over
      state.turnSeq++; // the dangling prompt's late answer is not ours any more
      emitAll(ctx, state.mapper.flush());
      ctx.emit({ type: "system", summary: `${label}: Agent reagierte nicht auf session/cancel — Zug erzwungen beendet`, payload: { kind: "acp.turn_stuck" } });
      state.busy = false;
      ctx.turn?.("idle");
      drainQueue(state, ctx);
    }, Math.min(10_000, cfg.stuckTurnMs));
  }

  /** ACP permission request → the phone → the option the agent offered. */
  async function decidePermission(state: AgentSession, ctx: AdapterContext, params: unknown): Promise<unknown> {
    const p = params as { toolCall?: ToolCallInfo; options?: { optionId: string; kind: string }[] };
    const options = p.options ?? [];
    const pick = (kinds: string[]) => kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean);
    const deny = () => {
      const reject = pick(["reject_once", "reject_always"]);
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    };
    if (cfg.permissions !== "hub" || !ctx.requestToolPermission) return deny();
    const seen = p.toolCall?.toolCallId ? state.calls.get(p.toolCall.toolCallId) : undefined;
    const call: ToolCallInfo = { ...seen, ...Object.fromEntries(Object.entries(p.toolCall ?? {}).filter(([, v]) => v !== undefined && v !== null)) };
    // BUG-0247/0248: rawInput may be incomplete at ask-time; never invent from title (PRD §8.5).
    const input = resolveRawInput(call.rawInput) ?? {};
    const answer = await ctx.requestToolPermission({
      toolName: (call.name ?? (call.kind ? KIND_LABEL[call.kind] : undefined) ?? call.title ?? call.kind ?? "tool").slice(0, 200),
      input,
      ...(call.toolCallId ? { toolUseId: call.toolCallId.slice(0, 200) } : {}),
    });
    if (answer.behavior !== "allow") return deny();
    // Never "always": every call is its own decision (ADR-0018).
    const allow = pick(["allow_once"]) ?? pick(["allow_always"]);
    return allow ? { outcome: { outcome: "selected", optionId: allow.optionId } } : deny();
  }

  function connect(sessionId: string, proc: WorkerProcess, ctx: AdapterContext): AgentSession {
    const state: AgentSession = { proc, conn: null as unknown as AcpConnection, acpSessionId: null, busy: false, mapper: new UpdateMapper(label), healthy: true, images: false, calls: new Map(), activeTools: new Set(), configOptions: undefined, onConfig: null, turnSeq: 0, replay: false, stuckTimer: null, pendingPermissions: 0, queued: [] };
    state.conn = new AcpConnection((line) => proc.write(line), {
      onNotification: (method, params) => {
        if (method !== "session/update") return;
        armStuckWatch(state, ctx); // BUG-0032: an update is activity
        const update = (params as { update?: SessionUpdate }).update;
        if (!update) return;
        if (update.sessionUpdate === "config_option_update") {
          state.configOptions = (update as { configOptions?: SessionModels["configOptions"] }).configOptions;
          state.onConfig?.();
          return;
        }
        if ((update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") && typeof update.toolCallId === "string") {
          if (!state.replay) {
            const running = update.status === "pending" || update.status === "in_progress";
            const terminal = update.status === "completed" || update.status === "failed";
            if (running) state.activeTools.add(update.toolCallId);
            if (terminal) state.activeTools.delete(update.toolCallId);
            if (running || terminal) ctx.activity?.({ id: `tool:${update.toolCallId}`, kind: "tool", state: running ? "running" : update.status === "failed" ? "failed" : "completed", ...(update.title ? { label: update.title.slice(0, 160) } : {}) });
          }
          const known = state.calls.get(update.toolCallId) ?? {};
          const u = update as ToolCallInfo;
          state.calls.set(update.toolCallId, { ...known, ...(u.title ? { title: u.title } : {}), ...(u.kind ? { kind: u.kind } : {}), ...(u.rawInput !== undefined ? { rawInput: u.rawInput } : {}) });
          if (state.calls.size > 200) state.calls.delete(state.calls.keys().next().value!);
        }
        // BUG-0036: a re-loaded session arrives as update notifications —
        // they are history, not news; nothing to emit while replaying.
        if (!state.replay) emitAll(ctx, state.mapper.map(update));
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") {
          armStuckWatch(state, ctx); // BUG-0032: asking is activity, and the answer may take hours
          state.pendingPermissions++;
          try {
            return await decidePermission(state, ctx, params);
          } finally {
            state.pendingPermissions--;
          }
        }
        if (method === "elicitation/create") {
          armStuckWatch(state, ctx);
          state.pendingPermissions++;
          try {
            return await answerElicitation(ctx, params as { mode?: unknown; message?: unknown; requestedSchema?: unknown; toolCallId?: unknown });
          } finally {
            state.pendingPermissions--;
          }
        }
        throw new RpcError(-32601, `${method} wird vom Hub nicht angeboten`);
      },
      // A prompt sent by the hub before a restart ends here — the turn is over.
      onStrayResult: (result) => {
        if (result && typeof result === "object" && "stopReason" in result) {
          emitAll(ctx, state.mapper.flush());
          state.busy = false;
          ctx.turn?.("idle");
          drainQueue(state, ctx);
        }
      },
      onNoise: (line) => ctx.log("debug", `${label}: non-JSON output`, { line: line.slice(0, 300) }),
    });
    proc.onStdout((chunk) => state.conn.feed(chunk));
    proc.onExit((code) => {
      state.healthy = false;
      if (state.stuckTimer) clearTimeout(state.stuckTimer);
      state.conn.failAll(`${label}-Prozess beendet (Code ${code ?? "?"})`);
      emitAll(ctx, state.mapper.flush());
      if (code !== 0 && code !== null) ctx.emit({ type: "system", summary: `${label}: process exited with code ${code}`, payload: { code } });
      if (state.busy) {
        state.busy = false;
        // The worker monitor classifies this loss; a dead process is no turn completion.
      }
      if (state.queued.length) {
        ctx.emit({ type: "system", summary: `${label}: ${state.queued.length} wartende Nachricht(en) verworfen — Agent-Prozess beendet`, payload: { kind: "acp.queued_dropped", count: state.queued.length } });
        state.queued = [];
      }
      if (sessions.get(sessionId) === state) {
        sessions.delete(sessionId);
        // EPIC-P35: endet der Agent zwischen Zügen von selbst (opencode acp
        // tat das nach dem geladenen Zug, live 07.11.2026), bleibt die Session
        // weckbar (BUG-0060-Weg): der nächste Prompt startet den Agenten und
        // lädt die Konversation — statt „Session neu starten“.
        if (state.acpSessionId && !state.stopping) {
          dormant.set(sessionId, { native: state.acpSessionId });
          ctx.emit({ type: "system", summary: `${label}: Agent-Prozess beendet — startet mit dem nächsten Prompt erneut`, payload: { kind: "acp.dormant_exit", nativeSessionId: state.acpSessionId } });
        }
      }
    });
    sessions.set(sessionId, state);
    return state;
  }

  async function initialize(state: AgentSession): Promise<{ loadSession: boolean; resume: boolean }> {
    const init = (await state.conn.request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } }, clientInfo: { name: "ancientvoid-hub", version: "0.1.0" } },
      cfg.startupTimeoutMs,
    )) as { agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: unknown }; promptCapabilities?: { image?: boolean } } };
    state.images = init.agentCapabilities?.promptCapabilities?.image === true;
    return { loadSession: init.agentCapabilities?.loadSession === true, resume: Boolean(init.agentCapabilities?.sessionCapabilities?.resume) };
  }

  function announce(ctx: AdapterContext, acpSessionId: string): void {
    ctx.emit({ type: "system", summary: `${label} · Session ${acpSessionId}`, payload: { kind: "acp.native_session", nativeSessionId: acpSessionId } });
  }

  /** BUG-0036: load/resume a native session with the replay silenced —
   * the agent re-notifies the loaded conversation; the hub's tail already
   * has it. Returns "unsupported" when the agent cannot load at all.
   * BUG-0039: `emit` flips it for adoptions — an observed session's
   * history exists only in this replay, so it must reach the stream.
   * BUG-0126: "lost" — the agent no longer knows THIS id (maki live
   * 2026-11-11: „Resource not found: not found: <id>"); the event says so,
   * the caller continues with a fresh context instead of bricking. */
  async function resumeNative(state: AgentSession, ctx: AdapterContext, native: string, canLoad: boolean, emit = false, model?: string): Promise<"loaded" | "unsupported" | "lost"> {
    if (!canLoad) return "unsupported";
    if (!emit) state.replay = true;
    let loaded: SessionModels;
    try {
      loaded = ((await state.conn.request("session/load", { sessionId: native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs)) ?? {}) as SessionModels;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (!/not found/i.test(text)) throw err;
      ctx.emit({
        type: "system",
        summary: `${label}: Session ${native.slice(0, 8)}… beim Agenten nicht mehr vorhanden — neuer Kontext`,
        payload: { kind: "acp.context_lost", lostSessionId: native, cause: text },
      });
      return "lost";
    } finally {
      state.replay = false;
      const buffered = state.mapper.flush();
      if (emit) emitAll(ctx, buffered);
    }
    state.acpSessionId = native;
    announce(ctx, native);
    state.offered = loaded;
    // ADR-0041: a loaded session runs on whatever model it used last — maki fell back to one the account may not
    // use (403 on the first prompt, live 2026-10-28). The configured model is applied; if it is not on offer,
    // that is said and the session keeps its own (unlike a new session, nothing is refused here).
    if (model) await selectModel(state, ctx, native, loaded, model, false);
    return "loaded";
  }

  async function newSession(state: AgentSession, ctx: AdapterContext, model?: string): Promise<void> {
    const res = (await state.conn.request("session/new", { cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs)) as { sessionId: string } & SessionModels;
    state.acpSessionId = res.sessionId;
    announce(ctx, res.sessionId);
    state.offered = res;
    if (model) await selectModel(state, ctx, res.sessionId, res, model, true);
  }

  /** Put the agent on `model` (ADR-0018 modelChoice "start"). `strict`: a model that is not offered fails the start. */
  async function selectModel(state: AgentSession, ctx: AdapterContext, sessionId: string, offered: SessionModels, model: string, strict: boolean): Promise<boolean> {
    state.offered = offered;
    // dsh registers routes from its settings right after boot: the answer
    // may predate them, a config_option_update follows (seen live).
    const find = () => (state.configOptions ? pickModel({ configOptions: state.configOptions }, model) : null) ?? pickModel(offered, model);
    let set = find();
    for (const until = Date.now() + MODEL_WAIT_MS; !set && Date.now() < until; set = find()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        state.onConfig = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      state.onConfig = null;
    }
    if (!set) {
      if (strict) throw new Error(`${label}: Modell „${model}" wird nicht angeboten`);
      ctx.emit({ type: "system", summary: `${label}: Modell „${model}" wird nicht angeboten — die Session bleibt bei ihrem eigenen`, payload: { kind: "acp.model_unavailable", model } });
      return false;
    }
    await state.conn.request(set.method, { sessionId, ...set.params }, cfg.startupTimeoutMs);
    // ADR-0032: the window of THIS model — config table first, then the
    // curated one; rides the event so the PWA needs no adapter roundtrip.
    const window = resolveContextWindow(model, set.value, cfg.contextWindows);
    ctx.emit({
      type: "system",
      summary: `${label} · ${model}`,
      payload: { kind: "acp.model", model, value: set.value, ...(window !== null ? { contextWindowTokens: window } : {}) },
    });
    return true;
  }

  /** BUG-0079: deklarierte Commands führt der Adapter selbst aus — kein
   * Modellturn, sichtbares acp.command_executed. Rückgabe true = behandelt.
   * Undeklarierte Slashes durchreichen (sichtbar als Chat, nichts still). */
  function runBridgeCommand(state: AgentSession, ctx: AdapterContext, text: string): boolean {
    if (!cfg.bridgeCommands || !text.trimStart().startsWith("/")) return false;
    const cmd = text.trimStart().split(/\s/, 1)[0] ?? text.trim();
    if (cmd !== "/new") return false;
    // BUG-0080: newSession() statt Roh-Request — nur dort wählt selectModel()
    // das konfigurierte Modell; die Frischsession lief sonst auf makis
    // Default (live: glm-5-code → ZHIPU 403 → „Internal error").
    void newSession(state, ctx, cfg.model)
      .then(() => {
        const sid = state.acpSessionId;
        if (sid) ctx.emit({ type: "system", summary: `${label}: Command /new ausgeführt — frischer Kontext (Session ${sid.slice(0, 8)}…)`, payload: { kind: "acp.command_executed", command: "/new", stopReason: "ok" } });
      })
      .catch((err: unknown) => {
        ctx.emit(providerErrorEvent(label, `/new gescheitert: ${err instanceof Error ? err.message : String(err)}`));
      });
    return true;
  }

  function drainQueue(state: AgentSession, ctx: AdapterContext): void {
    if (state.busy || !state.healthy) return;
    const next = state.queued.shift();
    if (!next) return;
    if (runBridgeCommand(state, ctx, next.text)) {
      drainQueue(state, ctx);
      return;
    }
    ctx.emit({ type: "system", summary: `${label}: wartende Nachricht wird jetzt zugestellt`, payload: { kind: "acp.queued_delivered", remaining: state.queued.length } });
    runTurn(state, ctx, next.text, next.attachments);
  }

  function runTurn(state: AgentSession, ctx: AdapterContext, text: string, attachments?: readonly PromptAttachment[]): void {
    state.busy = true;
    const seq = ++state.turnSeq; // BUG-0032: a forced end invalidates this turn's late answers
    ctx.turn?.("working");
    armStuckWatch(state, ctx);
    // BUG-0033: interim flush of buffered message/thought text — a no-op
    // tick when nothing is pending, the tail's live feed otherwise.
    const liveFlush = setInterval(() => {
      if (state.turnSeq === seq && state.busy) emitAll(ctx, state.mapper.flush());
    }, LIVE_FLUSH_MS);
    void promptBlocks(text, attachments, state.images)
      .then((prompt) => state.conn.request("session/prompt", { sessionId: state.acpSessionId, prompt }))
      .then((res) => {
        if (state.turnSeq !== seq) return;
        const r = res as { stopReason?: string; usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } | null };
        emitAll(ctx, state.mapper.flush());
        // ADR-0032: input is the context fill; tokens fall back to
        // input+output when the agent names no total.
        const inTok = typeof r.usage?.inputTokens === "number" ? r.usage.inputTokens : undefined;
        const outTok = typeof r.usage?.outputTokens === "number" ? r.usage.outputTokens : undefined;
        const total = typeof r.usage?.totalTokens === "number" ? r.usage.totalTokens : inTok !== undefined && outTok !== undefined ? inTok + outTok : undefined;
        ctx.emit({
          type: "system",
          summary: `${label}: Zug beendet (${r.stopReason ?? "?"})`,
          payload: {
            kind: "acp.turn_end",
            stopReason: r.stopReason ?? null,
            ...(inTok !== undefined || outTok !== undefined ? { usage: { ...(inTok !== undefined ? { input: inTok } : {}), ...(outTok !== undefined ? { output: outTok } : {}) } } : {}),
          },
          ...(total !== undefined ? { tokensEst: total } : {}),
        });
        if (r.stopReason === "refusal") {
          // maki-Brücke: ein mit "/" beginnender Prompt wird dort per run_command
          // ausgeführt und der Zug verworfen — refusal ist dann Erfolg, kein
          // Fehler (Stub-Beweis 2026-10-29). Nur mit bridgeCommands-Flag ehrlich.
          if (cfg.bridgeCommands && text.trimStart().startsWith("/")) {
            const cmd = text.trimStart().split(/\s/, 1)[0] ?? text.trim();
            ctx.emit({
              type: "system",
              summary: `${label}: Command ${cmd} über die Brücke beendet (refusal = kein Modellturn)`,
              payload: { kind: "acp.command_executed", command: cmd, stopReason: "refusal" },
            });
          } else {
            ctx.emit(providerErrorEvent(label, "Der Agent hat die Anfrage abgelehnt (refusal)."));
          }
        }
      })
      .catch((err: unknown) => {
        if (state.turnSeq !== seq) return;
        emitAll(ctx, state.mapper.flush());
        const detail = err instanceof Error ? err.message : String(err);
        if (!state.healthy && !state.stopping && ctx.interrupt) ctx.interrupt("worker_exit", detail);
        else ctx.emit(providerErrorEvent(label, detail));
      })
      .finally(() => {
        clearInterval(liveFlush);
        if (state.stuckTimer) {
          clearTimeout(state.stuckTimer);
          state.stuckTimer = null;
        }
        if (state.turnSeq !== seq) return;
        state.busy = false;
        if (state.healthy) ctx.turn?.("idle");
        drainQueue(state, ctx);
        });
        }

  /** T21.4: an agent's form (`elicitation/create`) becomes the phone's question form. URL mode is not offered. */
  async function answerElicitation(ctx: AdapterContext, params: { mode?: unknown; message?: unknown; requestedSchema?: unknown; toolCallId?: unknown }): Promise<unknown> {
    if (params.mode !== undefined && params.mode !== "form") throw new RpcError(-32602, "elicitation: nur der Formular-Modus wird angeboten");
    if (!ctx.requestToolPermission) return { action: "decline" };
    const fields = fieldsFromSchema(typeof params.message === "string" ? params.message : "", (params.requestedSchema ?? {}) as Parameters<typeof fieldsFromSchema>[1]);
    if (fields.length === 0) return { action: "decline" };
    const answer = await ctx.requestToolPermission({
      toolName: "AskUserQuestion",
      input: { questions: fields.map((f) => f.question) },
      ...(typeof params.toolCallId === "string" ? { toolUseId: params.toolCallId } : {}),
    });
    if (answer.behavior !== "allow") return { action: "decline" };
    return { action: "accept", content: contentFromAnswers(fields, (answer.updatedInput.answers ?? {}) as Record<string, string>) };
  }

  async function spawnAgent(ctx: AdapterContext, extraEnv?: Record<string, string>): Promise<WorkerProcess> {
    return ctx.spawnWorker(command!, { stdin: "pipe", persistent: true, env: { ...env, ...extraEnv } });
  }

  /** Start the agent of a dormant session and load its conversation (the former eager recover). */
  async function wake(sessionId: string, ctx: AdapterContext): Promise<AgentSession> {
    const entry = dormant.get(sessionId);
    if (!entry) throw new Error(`${label}: keine schlafende Session`);
    const proc = await spawnAgent(ctx);
    const state = connect(sessionId, proc, ctx);
    try {
      const caps = await initialize(state);
      // BUG-0036: resumeNative silences the load replay; an agent without
      // load support starts a fresh context, visibly.
      // ADR-0061: the session's own model (hub record) before the registration's default.
      const model = ctx.model ?? cfg.model;
      const outcome = await resumeNative(state, ctx, entry.native, caps.loadSession, false, model);
      if (outcome === "unsupported" && caps.resume) {
        state.replay = true;
        try {
          await state.conn.request("session/resume", { sessionId: entry.native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs);
        } finally {
          state.replay = false;
          state.mapper.flush();
        }
        state.acpSessionId = entry.native;
        announce(ctx, entry.native);
      } else if (outcome !== "loaded") {
        // BUG-0126: "lost" said its own, precise event above — a fresh
        // native session follows; the next prompt is not bricked.
        if (outcome === "unsupported") {
          ctx.emit({ type: "system", summary: `${label}: Agent kann Sessions nicht laden — neuer Kontext`, payload: { kind: "acp.context_lost" } });
        }
        await newSession(state, ctx, model);
      }
    } catch (err) {
      await proc.kill("SIGTERM");
      sessions.delete(sessionId);
      throw err;
    }
    dormant.delete(sessionId);
    return state;
  }

  const adapter: Adapter = {
    id: "acp",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return {
        promptDelivery: "next-turn",
        reasoning: true,
        tools: true,
        cost: false,
        steer: true,
        usage: false,
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        ...(cfg.preset === "maki"
          ? cfg.bridgeCommands
            ? { commands: MAKI_BRIDGE_COMMANDS }
            : {}
          : cfg.preset && ACP_PRESET_COMMANDS[cfg.preset]
            ? { commands: ACP_PRESET_COMMANDS[cfg.preset] }
            : {}),
        nativeDiscovery: "none",
        nativeResume: "none",
        // BUG-0101/ADR-0044: maki and omp continue a recorded session through
        // this adapter's protocol — start({args:{resumeSessionId}}) without a
        // prompt loads the old conversation (session/load, ADR-0041 live
        // 2026-10-28: history imported, answered from the adopted context).
        // EPIC-P35 (07.11.2026): opencode meldet loadSession im Handshake und
        // lädt promptlos (live: Resume lud die Konversation, Kontext da). Der
        // Agent endet danach von selbst — seitdem macht dormant-on-exit die
        // Session weckbar: der nächste Prompt startet ihn und lädt erneut
        // (live zweimal belegt, Codewort aus dem Vorzug erinnert).
        // hub:true frees the PWA's „Weitermachen"; argv stays display-only
        // (ADR-0036) with the CLI's real --session flag. Presets without that
        // evidence (dsh, copilot, custom) stay undeclared — the honest state,
        // continuable via prompt.
        ...(cfg.preset === "maki" || cfg.preset === "omp" || cfg.preset === "opencode"
          ? { resume: { argv: [command?.[0] ?? cfg.preset, cfg.preset === "opencode" ? "--session" : "--resume", "{sessionId}"], ref: "native" as const, hub: true as const, auto: true as const } }
          : {}),
        // ADR-0018: tools are asked per call through request_permission —
        // as far as the agent asks (see the presets and docs/harness-matrix.md).
        // T7.10: images as content blocks when the agent says it takes them,
        // otherwise (and for other files) their text.
        features: basicFeatures({ toolGate: cfg.permissions === "hub" ? "native" : "allowlist", images: !(preset && "images" in preset && !preset.images), files: true, modelChoice: modelChoice(), modelSwitch: modelChoice() === "start" }),
      };
    },

    /** ADR-0018: the model catalog for the start form — one provider/model
     * per line from a listing command. Derived for `… acp` agents (opencode:
     * `opencode models`), explicit via `modelsCommand`. Same line shape as
     * adapter-opencode's parseModelList (kept local, 8 lines). */
    async models(): Promise<ModelOption[]> {
      // dsh ≥ 0.2 has no listing command; its ACP session offers every provider and model.
      // maki 0.6.5: `maki models` exits 0 with empty output; `maki acp` lists them (live 2026-10-28).
      if (!cfg.modelsCommand && (cfg.preset === "dsh" || cfg.preset === "maki" || cfg.preset === "omp") && command) return probeModelCatalog(command, env);
      const cmd = cfg.modelsCommand ?? (command?.at(-1) === "acp" ? [...command.slice(0, -1), "models"] : undefined);
      if (!cmd) return [];
      const start = spawnArgv(cmd[0]!, cmd.slice(1));
      const { stdout } = await run(start.file, start.args, { timeout: 20_000, maxBuffer: 1024 * 1024, ...(start.shell ? { shell: true } : {}) });
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[\w.-]+\/\S+$/.test(line))
        .map((id) => ({ id }));
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const proc = await spawnAgent(ctx, spec.env);
      const state = connect(ctx.sessionId, proc, ctx);
      const caps = await initialize(state);
      // continueStopped hands the native id as args.resumeSessionId — the
      // continued turn runs in the loaded conversation, not a fresh one.
      // BUG-0039: adoption sends importHistory along — the replay is then
      // the session's only history and goes to the stream.
      const startArgs = (spec.args ?? {}) as { resumeSessionId?: unknown; importHistory?: unknown };
      const resume = startArgs.resumeSessionId;
      try {
        const outcome = typeof resume === "string" && resume
          ? await resumeNative(state, ctx, resume, caps.loadSession, startArgs.importHistory === true, spec.model ?? cfg.model)
          : "unsupported";
        if (outcome === "loaded") {
          // loaded — the prompt (if any) continues the old conversation
        } else {
          // BUG-0126: "lost" (the agent no longer knows the id) said its
          // own event inside resumeNative; only "unsupported" needs the
          // generic note. Either way a fresh session carries the prompt.
          if (outcome === "unsupported" && typeof resume === "string" && resume) {
            ctx.emit({ type: "system", summary: `${label}: Agent kann Sessions nicht laden — neuer Kontext`, payload: { kind: "acp.context_lost" } });
          }
          await newSession(state, ctx, spec.model ?? cfg.model);
        }
      } catch (err) {
        await state.proc.kill("SIGTERM");
        if (sessions.get(ctx.sessionId) === state) sessions.delete(ctx.sessionId);
        throw err;
      }
      if (spec.prompt || spec.attachments?.length) runTurn(state, ctx, spec.prompt ?? "", spec.attachments);
      return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt": {
          if (!state && dormant.has(handle.sessionId)) {
            // BUG-0060: the agent of a restored session starts now, with the first prompt.
            let waker = waking.get(handle.sessionId);
            if (!waker) {
              waker = wake(handle.sessionId, ctx).finally(() => waking.delete(handle.sessionId));
              waking.set(handle.sessionId, waker);
            }
            try {
              const woken = await waker;
              if (woken.busy) {
                woken.queued.push({ text: input.text, ...(input.attachments?.length ? { attachments: input.attachments } : {}) });
                return { ok: true, detail: "in der Warteschlange — wird nach dem Zug gesendet" };
              }
              if (runBridgeCommand(woken, ctx, input.text)) return { ok: true, detail: "Command ausgeführt — kein Modellturn" };
              runTurn(woken, ctx, input.text, input.attachments);
              return { ok: true };
            } catch (err) {
              return { ok: false, detail: `${label}: Agent konnte nicht gestartet werden — ${err instanceof Error ? err.message : String(err)}` };
            }
          }
          if (!state || !state.healthy) return { ok: false, detail: `${label}: Agent läuft nicht mehr — Session neu starten` };
          if (state.busy) {
            // EPIC-P7 follow-up: a prompt while a turn runs is parked in the
            // FIFO queue and delivered when the turn ends — the phone never
            // has to wait for the agent to finish before typing.
            state.queued.push({ text: input.text, ...(input.attachments?.length ? { attachments: input.attachments } : {}) });
            ctx.emit({ type: "system", summary: `${label}: Nachricht wartet bis der Zug endet (${state.queued.length} in der Warteschlange)`, payload: { kind: "acp.queued", queued: state.queued.length } });
            return { ok: true, detail: "in der Warteschlange — wird nach dem Zug gesendet" };
          }
          if (runBridgeCommand(state, ctx, input.text)) return { ok: true, detail: "Command ausgeführt — kein Modellturn" };
          runTurn(state, ctx, input.text, input.attachments);
          return { ok: true };
        }
        case "park":
          if (state?.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
          if (state?.queued.length) {
            ctx.emit({ type: "system", summary: `${label}: ${state.queued.length} wartende Nachricht(en) verworfen — Session geparkt`, payload: { kind: "acp.queued_dropped", count: state.queued.length } });
            state.queued = [];
          }
          return { ok: true };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "configure": {
          // ADR-0061: Modellwechsel über dieselbe Auswahl wie beim Start; Modi kennt ACP hier nicht.
          if (input.permissionMode !== undefined) return { ok: false, detail: `${label}: Modus lässt sich in dieser Session nicht wechseln` };
          if (input.model === undefined) return { ok: true };
          if (modelChoice() !== "start") return { ok: false, detail: `${label}: Modell lässt sich nicht wechseln` };
          // Schlafende Session: der Hub trägt das Modell ein, `wake()` wendet es beim nächsten Prompt an.
          if (!state) return dormant.has(handle.sessionId) ? { ok: true, detail: "wird beim nächsten Prompt angewandt" } : { ok: false, detail: `${label}: keine laufende Session` };
          if (!state.acpSessionId) return { ok: false, detail: `${label}: Session startet noch` };
          if (state.busy) return { ok: false, detail: `${label}: Modellwechsel erst nach dem laufenden Zug` };
          try {
            if (await selectModel(state, ctx, state.acpSessionId, state.offered ?? {}, input.model, false)) return { ok: true };
          } catch (err) {
            return { ok: false, detail: `${label}: Modellwechsel fehlgeschlagen — ${err instanceof Error ? err.message : String(err)}` };
          }
          return { ok: false, detail: `${label}: Modell „${input.model}" wird nicht angeboten — die Session bleibt bei ihrem eigenen` };
        }
        case "resume":
          return { ok: false, detail: `${label}: weiter geht es mit einem neuen Prompt` };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = sessions.get(handle.sessionId);
      if (!state && dormant.has(handle.sessionId)) return { state: "healthy", detail: "Agent startet mit dem nächsten Prompt", lastSeen: new Date().toISOString() };
      if (!state) return { state: "down", detail: "no agent process" };
      return { state: state.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /**
     * ADR-0014 for a persistent agent: take over the process that survived
     * the restart. A turn that was waiting for a permission answer can't be
     * answered any more (the request was read by the previous hub) — it is
     * cancelled, visibly. Without a surviving process: a new agent, which
     * loads the session when the agent can.
     */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? null;
      const adopted = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      if (adopted) {
        const state = connect(sessionId, adopted, ctx);
        state.acpSessionId = native;
        state.busy = ctx.turnActive === true;
        if (state.busy) armStuckWatch(state, ctx);
        ctx.emit({ type: "system", summary: `${label}: laufenden Agenten nach Hub-Neustart übernommen`, payload: { kind: "acp.recovered", cancelled: false } });
        return { sessionId, ...(adopted.pid !== undefined ? { pid: adopted.pid } : {}) };
      }
      if (!native) return null;
      dormant.set(sessionId, { native });
      ctx.emit({ type: "system", summary: `${label}: Agent startet mit dem nächsten Prompt`, payload: { kind: "acp.dormant" } });
      return { sessionId };
    },

    async stop(handle: SessionHandle): Promise<void> {
      dormant.delete(handle.sessionId);
      const state = sessions.get(handle.sessionId);
      if (!state) return;
      state.stopping = true;
      if (state.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
      await state.proc.kill("SIGTERM");
      await state.proc.kill("SIGKILL");
      sessions.delete(handle.sessionId);
    },
  };
  return adapter;
}

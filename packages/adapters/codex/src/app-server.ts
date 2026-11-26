import { spawn } from "node:child_process";
import { isCompactionCommand, spawnArgv } from "@ancientvoid/contracts";
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
  type SteerInput,
  type WorkerProcess,
} from "@ancientvoid/contracts";
import { JsonRpcConnection, RpcError } from "@ancientvoid/adapter-jsonrpc";
import { itemCompleted, itemStarted, planEvent, quotaOf, toolOf, type CodexItem } from "./app-server-events.ts";
import { estimateCostUsd } from "./pricing.ts";

/**
 * codex in app-server mode (T7.2, ADR-0018 §3): one `codex app-server`
 * per session as a persistent worker (stdin pipe). Commands and file
 * changes ask the phone first (`approvalPolicy: "untrusted"`), questions
 * (`request_user_input`) are answered there, quota comes from
 * `account/rateLimits` — none of which `codex exec` offers.
 */
export interface AppServerConfig {
  command: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  extraArgs: string[];
  model?: string | undefined;
}

interface ServerSession {
  proc: WorkerProcess;
  conn: JsonRpcConnection;
  threadId: string | null;
  turnId: string | null;
  model: string | undefined;
  healthy: boolean;
  items: Map<string, CodexItem>;
  syncing?: Promise<void>;
  turnRevision: number;
  startingTurn?: boolean;
  compactPending?: boolean;
}

export function createAppServerAdapter(cfg: AppServerConfig): Adapter {
  const sessions = new Map<string, ServerSession>();
  const command = [cfg.command, "app-server", ...cfg.extraArgs];

  async function ask(ctx: AdapterContext, state: ServerSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const item = state.items.get(String(params.itemId)) ?? { type: method.includes("fileChange") ? "fileChange" : "commandExecution", command: params.command as string };
      const tool = toolOf({ ...item, ...(typeof params.command === "string" ? { command: params.command } : {}) }) ?? { name: "Werkzeug", input: {} };
      if (!ctx.requestToolPermission) return { decision: "decline" };
      const answer = await ctx.requestToolPermission({
        toolName: tool.name,
        input: { ...tool.input, ...(typeof params.reason === "string" ? { reason: params.reason } : {}) },
        toolUseId: String(params.approvalId ?? params.itemId),
      });
      // Never "acceptForSession": each call is its own decision (ADR-0018).
      return { decision: answer.behavior === "allow" ? "accept" : "decline" };
    }
    if (method === "item/tool/requestUserInput") {
      const questions = (params.questions as { id: string; header?: string; question: string; options?: { label: string; description?: string }[] }[]) ?? [];
      if (!ctx.requestToolPermission) return { answers: {} };
      const answer = await ctx.requestToolPermission({
        toolName: "AskUserQuestion",
        input: { questions: questions.map((q) => ({ question: q.question, header: q.header, options: q.options ?? [], multiSelect: false })) },
        toolUseId: String(params.itemId),
      });
      const given = answer.behavior === "allow" ? ((answer.updatedInput.answers ?? {}) as Record<string, string>) : {};
      return { answers: Object.fromEntries(questions.filter((q) => given[q.question]).map((q) => [q.id, { answers: [given[q.question]!] }])) };
    }
    throw new RpcError(-32601, `${method} wird vom Hub nicht angeboten`);
  }

  function connect(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, model: string | undefined): ServerSession {
    const state: ServerSession = { proc, conn: null as unknown as JsonRpcConnection, threadId: null, turnId: null, model, healthy: true, items: new Map(), turnRevision: 0 };
    state.conn = new JsonRpcConnection((line) => proc.write(line), {
      onNotification: (method, raw) => {
        const params = (raw ?? {}) as Record<string, unknown>;
        if (params.threadId && state.threadId && params.threadId !== state.threadId) return;
        switch (method) {
          case "item/started": {
            const item = params.item as CodexItem;
            if (item.id) state.items.set(item.id, item);
            for (const e of itemStarted(item)) ctx.emit(e);
            activityOf(item, ctx, true);
            break;
          }
          case "item/completed": {
            const item = params.item as CodexItem;
            for (const e of itemCompleted(item)) ctx.emit(e);
            activityOf(item, ctx, false);
            if (item.id) state.items.delete(item.id);
            break;
          }
          case "turn/started":
            state.turnRevision++;
            state.turnId = (params.turn as { id?: string })?.id ?? state.turnId;
            ctx.turn?.("working");
            break;
          case "turn/plan/updated":
            ctx.emit(planEvent((params.plan as { step: string; status: string }[]) ?? []));
            break;
          case "thread/tokenUsage/updated": {
            const tokenUsage = params.tokenUsage as { modelContextWindow?: number | null; last?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number } } | undefined;
            const last = tokenUsage?.last;
            if (last) {
              const cost = estimateCostUsd(state.model, last);
              // usage.input/output (ADR-0032): die Kontextfüllung der PWA —
              // ohne sie bleibt der Kontextbalken der Session „unbekannt“,
              // obwohl der app-server die Zahl längst gemeldet hat.
              ctx.emit({
                type: "system",
                summary: `codex: ${last.totalTokens ?? "?"} Tokens`,
                payload: {
                  kind: "codex.token_usage",
                  ...(typeof tokenUsage?.modelContextWindow === "number" && tokenUsage.modelContextWindow > 0 ? { contextWindowTokens: tokenUsage.modelContextWindow } : {}),
                  ...(typeof last.inputTokens === "number" || typeof last.outputTokens === "number"
                    ? { usage: { ...(typeof last.inputTokens === "number" ? { input: last.inputTokens } : {}), ...(typeof last.outputTokens === "number" ? { output: last.outputTokens } : {}) } }
                    : {}),
                  ...(typeof last.cachedInputTokens === "number" && last.cachedInputTokens > 0 ? { cacheInputTokens: last.cachedInputTokens, cacheIncluded: true } : {}),
                },
                ...(typeof last.totalTokens === "number" ? { tokensEst: last.totalTokens } : {}),
                ...(cost !== undefined ? { costUsd: cost, costSource: "estimated" as const } : {}),
              });
            }
            break;
          }
          case "account/rateLimits/updated": {
            const quota = quotaOf(params.rateLimits as Parameters<typeof quotaOf>[0]);
            if (quota) ctx.emit({ type: "system", summary: "codex: Kontingent aktualisiert", payload: { kind: "codex.rate_limits" }, usageQuota: quota });
            break;
          }
          case "error": {
            const err = params.error as { message?: string } | undefined;
            if (params.willRetry !== true && err?.message) ctx.emit(providerErrorEvent("codex", err.message));
            break;
          }
          case "turn/completed": {
            const turn = params.turn as { id?: string; status?: string; error?: { message?: string } | null };
            if (state.turnId && turn.id && state.turnId !== turn.id) break;
            state.turnRevision++;
            ctx.emit({ type: "system", summary: `codex: Zug beendet (${turn.status ?? "?"})`, payload: { kind: "codex.turn_end", status: turn.status ?? null } });
            if (turn.status === "failed" && turn.error?.message) ctx.emit(providerErrorEvent("codex", turn.error.message));
            state.turnId = null;
            state.compactPending = false;
            ctx.turn?.("idle");
            break;
          }
        }
      },
      onRequest: (method, params) => ask(ctx, state, method, (params ?? {}) as Record<string, unknown>),
      onNoise: (line) => ctx.log("debug", "codex app-server: non-JSON output", { line: line.slice(0, 300) }),
    });
    proc.onStdout((chunk) => state.conn.feed(chunk));
    proc.onExit((code) => {
      state.healthy = false;
      state.conn.failAll(`codex app-server beendet (Code ${code ?? "?"})`);
      if (code !== 0 && code !== null) ctx.emit({ type: "system", summary: `codex: process exited with code ${code}`, payload: { code } });
      state.turnId = null;
      if (sessions.get(sessionId) === state) sessions.delete(sessionId);
    });
    sessions.set(sessionId, state);
    return state;
  }

  async function initialize(state: ServerSession): Promise<void> {
    await state.conn.request("initialize", { clientInfo: { name: "ancientvoid-hub", version: "0.1.0" } }, 60_000);
    state.conn.notify("initialized", {});
    // ADR-0004: the account quota, once per session start.
    void state.conn.request("account/rateLimits/read", {}, 20_000).catch(() => undefined);
  }

  function threadParams(ctx: AdapterContext, model: string | undefined): Record<string, unknown> {
    return { cwd: ctx.workdir, approvalPolicy: cfg.approvalPolicy, sandbox: cfg.sandbox, ...(model ? { model } : {}) };
  }

  /** T7.10: images as `localImage` input, everything else as text. */
  function inputOf(text: string, attachments: readonly PromptAttachment[] | undefined): Record<string, unknown>[] {
    const images = (attachments ?? []).filter((a) => a.kind === "image");
    const native = new Set(images.map((a) => a.id));
    return [{ type: "text", text: promptWithAttachments(text, attachments, native) }, ...images.map((a) => ({ type: "localImage", path: a.path }))];
  }

  async function startTurn(state: ServerSession, ctx: AdapterContext, text: string, attachments?: readonly PromptAttachment[]): Promise<Ack> {
    state.startingTurn = true;
    ctx.turn?.("working");
    try {
      const revision = state.turnRevision;
      const res = (await state.conn.request("turn/start", { threadId: state.threadId, input: inputOf(text, attachments) })) as { turn?: { id?: string } };
      if (state.turnRevision === revision) state.turnId = res.turn?.id ?? null;
      return { ok: true };
    } catch (err) {
      const detail = rejectDetail("turn/start", err);
      ctx.emit(providerErrorEvent("codex", err instanceof Error ? err.message : String(err)));
      ctx.turn?.("idle");
      return { ok: false, detail };
    } finally {
      state.startingTurn = false;
    }
  }

  async function compact(state: ServerSession, ctx: AdapterContext): Promise<Ack> {
    state.compactPending = true;
    const revision = state.turnRevision;
    ctx.turn?.("working");
    try {
      await state.conn.request("thread/compact/start", { threadId: state.threadId }, 15_000);
      return { ok: true };
    } catch (err) {
      const detail = rejectDetail("thread/compact/start", err);
      ctx.emit(providerErrorEvent("codex", detail));
      // A lost response may still be followed by turn/completed.
      if (state.turnRevision === revision && !detail.includes("Ergebnis unbekannt")) {
        state.compactPending = false;
        ctx.turn?.("idle");
      }
      return { ok: false, detail };
    }
  }

  /** BUG-0158: nachweisliche Ablehnung ehrlich negativ acken; ein
   * Transport-Timeout bleibt ein unbekanntes Ergebnis (kein blindes Retry,
   * nicht als angenommen verbucht — STUMM/Wartesemantik T17.4 unberührt). */
  function rejectDetail(method: string, err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("keine Antwort nach")
      ? `codex: ${method} Ergebnis unbekannt (${msg}) — Eingabe nicht als angenommen verbucht`
      : `codex: ${method} abgelehnt — ${msg}`;
  }

  const adapter: Adapter = {
    id: "codex",
    version: "0.2.0",

    capabilities(): AdapterCapabilities {
      return {
        reasoning: true,
        tools: true,
        cost: true,
        steer: true,
        promptlessStartIdle: true,
        commands: [{ name: "/compact", description: "Codex-Kontext komprimieren", scope: "steer" }],
        usage: true,
        nativeDiscovery: "none",
        nativeResume: "native",
        resume: { argv: ["codex", "resume", "{sessionId}"], ref: "native", hub: true, auto: true },
        features: basicFeatures({
          toolGate: cfg.approvalPolicy === "never" ? (cfg.sandbox === "danger-full-access" ? "bypass" : "sandbox") : "native",
          questions: cfg.approvalPolicy !== "never",
          modelChoice: "start", modelSwitch: false, permissionModes: [],
          images: true,
          files: true,
        }),
      };
    },

    /** ADR-0018: `model/list` of a short-lived app-server (read-only listing). */
    async models(): Promise<ModelOption[]> {
      return listModels(cfg.command);
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      if (spec.prompt && isCompactionCommand(spec.prompt)) throw new Error("codex: /compact erfordert einen gestarteten Thread");
      const proc = await ctx.spawnWorker(command, { stdin: "pipe", persistent: true, ...(spec.env ? { env: spec.env } : {}) });
      const state = connect(ctx.sessionId, proc, ctx, spec.model ?? cfg.model);
      try {
        await initialize(state);
        const native = typeof spec.args?.resumeSessionId === "string" ? spec.args.resumeSessionId : null;
        const started = (await state.conn.request(native ? "thread/resume" : "thread/start", { ...threadParams(ctx, spec.model ?? cfg.model), ...(native ? { threadId: native } : {}) }, 60_000)) as { thread?: { id?: string }; model?: string };
        state.threadId = started.thread?.id ?? null;
        state.model = spec.model ?? cfg.model ?? started.model;
        if (state.threadId) ctx.emit({ type: "system", summary: `Codex · Thread ${state.threadId}`, payload: { kind: "codex.native_session", nativeSessionId: state.threadId, model: started.model ?? null } });
        if (spec.prompt || spec.attachments?.length) {
          const ack = await startTurn(state, ctx, spec.prompt ?? "", spec.attachments);
          if (!ack.ok) {
            throw new Error(ack.detail ?? "codex: turn/start abgelehnt");
          }
        }
        return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
      } catch (err) {
        await state.proc.kill("SIGTERM");
        await state.proc.kill("SIGKILL");
        if (sessions.get(ctx.sessionId) === state) sessions.delete(ctx.sessionId);
        throw err;
      }
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt":
          if (state?.syncing) await state.syncing;
          if (!state?.healthy || !state.threadId) return { ok: false, detail: "codex: app-server läuft nicht mehr — Session neu starten" };
          if (state.compactPending) return { ok: false, detail: "codex: Compaction läuft oder ihr Ergebnis steht noch aus" };
          if (isCompactionCommand(input.text)) {
            if (input.text.trim() !== "/compact" || input.attachments?.length) {
              return { ok: false, detail: "codex: /compact nimmt keine Argumente oder Anhänge an" };
            }
            if (state.turnId || state.startingTurn) return { ok: false, detail: "codex: /compact erfordert einen wartenden Thread" };
            return compact(state, ctx);
          }
          if (state.startingTurn && !state.turnId) return { ok: false, detail: "codex: Zug wird gerade gestartet" };
          if (state.turnId) {
            // A running turn takes the text as steering input.
            try {
              await state.conn.request("turn/steer", { threadId: state.threadId, turnId: state.turnId, input: inputOf(input.text, input.attachments) });
              return { ok: true };
            } catch (err) {
              const detail = rejectDetail("turn/steer", err);
              ctx.emit(providerErrorEvent("codex", err instanceof Error ? err.message : String(err)));
              return { ok: false, detail };
            }
          }
          return startTurn(state, ctx, input.text, input.attachments);
        case "park":
          if (state?.threadId && state.turnId) await state.conn.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }).catch(() => undefined);
          return { ok: true };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "configure":
          return { ok: false, detail: "codex: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "codex: weiter geht es mit einem neuen Prompt" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = sessions.get(handle.sessionId);
      if (!state) return { state: "down", detail: "no app-server process" };
      return { state: state.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0014: take over the surviving app-server; else start one and
     * resume the thread natively. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? null;
      const adopted = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      if (adopted) {
        const state = connect(sessionId, adopted, ctx, undefined);
        state.threadId = native;
        if (native) {
          const wasWorking = ctx.turnActive === true;
          state.syncing = state.conn.request("thread/read", { threadId: native, includeTurns: true }, 10_000).then(raw => {
            const thread = (raw as { thread?: { status?: { type?: string }; turns?: { id: string; status: string }[] } }).thread;
            const active = thread?.turns?.findLast(turn => turn.status === "inProgress");
            state.turnId = active?.id ?? null;
            if (active) ctx.turn?.("working");
            else if (thread?.status?.type === "idle" && wasWorking) ctx.turn?.("idle");
            else if (thread?.status?.type === "active") ctx.interrupt?.("adapter_down", "Aktiver Codex-Zug konnte nicht eindeutig zugeordnet werden.");
          }).catch(err => {
            state.healthy = false;
            ctx.interrupt?.("adapter_down", `Codex-Zug nach Neustart nicht prüfbar: ${String(err).slice(0, 300)}`);
          });
        }
        return { sessionId, ...(adopted.pid !== undefined ? { pid: adopted.pid } : {}) };
      }
      if (!native) return null;
      const proc = await ctx.spawnWorker(command, { stdin: "pipe", persistent: true });
      const state = connect(sessionId, proc, ctx, undefined);
      await initialize(state);
      await state.conn.request("thread/resume", { threadId: native, ...threadParams(ctx, undefined) }, 60_000);
      state.threadId = native;
      return { sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const state = sessions.get(handle.sessionId);
      if (!state) return;
      await state.proc.kill("SIGTERM");
      await state.proc.kill("SIGKILL");
      sessions.delete(handle.sessionId);
    },
  };
  return adapter;
}

/** Structured provider activity, including children that outlive their spawn tool. */
function activityOf(item: CodexItem, ctx: AdapterContext, started: boolean): void {
  if (item.type === "subAgentActivity" && item.agentThreadId) {
    ctx.activity?.({ id: `agent:${item.agentThreadId}`, kind: "agent", state: item.kind === "completed" ? "completed" : item.kind === "interrupted" ? "failed" : "running" });
    return;
  }
  if (item.type === "collabAgentToolCall") {
    for (const [id, raw] of Object.entries(item.agentsStates ?? {})) {
      const status = (raw as { status?: string })?.status;
      if (!status) continue;
      ctx.activity?.({ id: `agent:${id}`, kind: "agent", state: status === "running" || status === "pendingInit" ? "running" : status === "completed" || status === "shutdown" ? "completed" : "failed" });
    }
  }
  if (!item.id || !toolOf(item)) return;
  ctx.activity?.({ id: `tool:${item.id}`, kind: "tool", state: started ? "running" : item.status === "failed" || item.status === "interrupted" || item.status === "declined" ? "failed" : "completed", label: toolOf(item)!.name.slice(0, 160) });
}

/** `model/list` from a short-lived `codex app-server`, 20 s at most. */
export function listModels(commandName: string): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    const start = spawnArgv(commandName, ["app-server"]);
    const child = spawn(start.file, start.args, { stdio: ["pipe", "pipe", "ignore"], ...(start.shell ? { shell: true } : {}) });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("codex model/list: keine Antwort"));
    }, 20_000);
    const conn = new JsonRpcConnection((line) => child.stdin.write(line), { onNotification: () => undefined, onRequest: async () => null });
    child.stdout.setEncoding("utf8").on("data", (c: string) => conn.feed(c));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    void (async () => {
      await conn.request("initialize", { clientInfo: { name: "ancientvoid-hub", version: "0.1.0" } });
      conn.notify("initialized", {});
      const res = (await conn.request("model/list", {})) as { data?: { id: string; displayName?: string; hidden?: boolean }[] };
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve((res.data ?? []).filter((m) => !m.hidden).map((m) => ({ id: m.id, ...(m.displayName ? { label: m.displayName } : {}) })));
    })().catch((err: unknown) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

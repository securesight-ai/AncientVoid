import { z } from "zod";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  ModelOption,
  PromptAttachment,
  SessionHandle,
  SessionSpec,
  SteerInput,
  WorkerProcess,
} from "@ancientvoid/contracts";
import { promptWithAttachments, spawnArgv } from "@ancientvoid/contracts";
import { modelsFromCommand, resolveContextWindow } from "@ancientvoid/models";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeOpencodeLine } from "./normalize.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const run = promisify(execFile);

/** `opencode models` prints one `provider/model` per line. */
export function parseModelList(stdout: string): ModelOption[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[\w.-]+\/\S+$/.test(line))
    .map((id) => ({ id }));
}

/**
 * opencode adapter (P3, T3.12). Spawns the real, installed `opencode run`
 * CLI (verified live, 2026-09-18, opencode 1.18.29) via ctx.spawnWorker,
 * maps its `--format json` event stream through normalize.ts.
 *
 * Real find: this is also the verified, working path to "zai" access
 * (EPIC-P3 Vorbemerkung) — a `spec.model` of e.g. "zai-coding-plan/glm-5.3"
 * routes through opencode's already-configured provider, real cost/tokens
 * included on every step_finish. No separate zai adapter exists (T3.2).
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable to spawn (default "opencode").
 *   extraArgs: extra CLI args appended verbatim — e.g. ["--auto"] to
 *              non-interactively auto-approve permissions (opencode's own
 *              "dangerous!" flag, same shape as claude's
 *              --dangerously-skip-permissions; NOT hardcoded here, same
 *              reasoning as adapter-claude: what an adapter does by
 *              default vs. what an operator explicitly opts into via
 *              config are kept separate).
 */

const OpencodeConfig = z.object({
  command: z.string().min(1).default("opencode"),
  extraArgs: z.array(z.string()).default([]),
  /** Passed as `--model` when the session does not name one. The live
   * default observed 2026-09-22 was `zai-coding-plan/glm-5.3`. */
  model: z.string().min(1).optional(),
  /** Extra environment for every opencode process — model listing and turns.
   *  ADR-0054/0060 pattern (like ACP/pi): provider keys reach the harness
   *  without landing in the config, e.g. ZAI_API_KEY for GLM. */
  env: z.record(z.string(), z.string()).default({}),
  /** Umgebungsvariable → Datei mit dem Wert (`~/` aufgelöst); Schlüssel stehen so nie in der Config. */
  envFiles: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().min(1)).default({}),
  /** ADR-0054 (EPIC-P35 T35.7): listendes Kommando für den Modell-Katalog —
   * Überschreibung des abgeleiteten `<command> models`. */
  modelsCommand: z.array(z.string().min(1)).min(1).optional(),
  /** ADR-0054: Kontextfenster-Overrides — Konfiguration schlägt die kuratierte
   * Tabelle (ADR-0032). */
  contextWindows: z.record(z.string().min(1), z.number().int().positive()).default({}),
});
type OpencodeConfig = z.infer<typeof OpencodeConfig>;

/**
 * opencode has a real, verified `--agent <name>` flag (`opencode run
 * --help`) — directly analogous to claude's --agent. It has no equivalent
 * of claude's `/skill-name` prompt-prefix convention (no evidence found).
 * The hub resolves an `extends` chain and puts that text in the prompt
 * (`skillChain` is the names only). A bare `skill` without that chain is
 * visibly ignored (AGENTS.md Regel 6), never silently dropped.
 */
const OpencodeSessionArgs = z
  .object({
    agent: z.string().min(1).optional(),
    skill: z.string().min(1).optional(),
    skillChain: z.array(z.string().min(1)).max(16).optional(),
    resumeSessionId: z.string().min(1).optional(),
  })
  .optional();

interface SessionMeta {
  resumeSessionId?: string;
  healthy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: OpencodeConfig = OpencodeConfig.parse(config ?? {});
  /** Env für jeden opencode-Prozess (Listing wie Züge): Config `env` plus `envFiles`. */
  const env: Record<string, string> = { ...cfg.env };
  for (const [name, file] of Object.entries(cfg.envFiles)) env[name] = readFileSync(file.replace(/^~(?=\/)/, homedir()), "utf8").trim();
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  /** T7.10: images and PDFs as files (`-f`), everything else as text. */
  function withFiles(prompt: string, attachments: readonly PromptAttachment[] | undefined): { prompt: string; files: string[] } {
    const native = new Set((attachments ?? []).filter((a) => a.kind === "image" || a.kind === "pdf").map((a) => a.id));
    return { prompt: promptWithAttachments(prompt, attachments, native), files: (attachments ?? []).filter((a) => native.has(a.id)).map((a) => a.path) };
  }

  /** `agent`/`model` only on the initial (non-resume) spawn — same
   * reasoning as adapter-claude's buildArgs: whether either still applies
   * across a `--session`-continued run is unverified, so neither is
   * re-added on continuation. */
  function buildArgs(prompt: string, resumeSessionId?: string, agent?: string, model?: string, files: string[] = []): string[] {
    const args = [cfg.command, "run", prompt, "--format", "json", ...files.flatMap((f) => ["-f", f])];
    if (resumeSessionId) args.push("--session", resumeSessionId);
    if (agent && !resumeSessionId) args.push("--agent", agent);
    if (model && !resumeSessionId) args.push("--model", model);
    return [...args, ...cfg.extraArgs];
  }

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
    meta.healthy = true;
    procs.set(sessionId, proc);
    sessions.set(sessionId, meta);

    let buffer = "";
    proc.onStdout((chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          ctx.emit({
            type: "system",
            summary: "opencode: non-JSON stdout line",
            payload: { line: rawLine.slice(0, 500) },
          });
          continue;
        }
        if (parsed && typeof parsed === "object" && "sessionID" in parsed) {
          const sid = (parsed as { sessionID?: unknown }).sessionID;
          if (typeof sid === "string" && sid !== meta.resumeSessionId) {
            meta.resumeSessionId = sid;
            ctx.emit({
              type: "system",
              summary: `OpenCode · Session ${sid}`,
              payload: { kind: "opencode.native_session", nativeSessionId: sid },
            });
          }
        }
        for (const event of normalizeOpencodeLine(parsed)) ctx.emit(event);
      }
    });

    proc.onStderr((chunk) => {
      ctx.log("warn", "opencode stderr", { chunk: chunk.slice(0, 500) });
    });

    proc.onExit((code) => {
      // opencode run is one-shot per turn, same as claude -p — a clean
      // exit is the turn finishing normally, not the adapter going down.
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `opencode: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  const adapter: Adapter = {
    id: "opencode",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // cost/usage: true — every real step_finish carries a real
      // cost/tokens figure (possibly a genuine $0 on a subscription plan,
      // not "unreported"), verified against two live captures.
      // usage: false — no account-level rate-limit/quota signal observed
      // anywhere in the real capture (unlike claude's rate_limit_event);
      // R9.7, not guessed.
      return { reasoning: true, tools: true, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "native",
        // ADR-0036: `opencode --help`: "--session, -s string — Session ID to
        // continue"; buildArgs() passes the same flag on a resumed run.
        // EPIC-P35 T35.3: `hub: true` — `--session` continuation live belegt
        // (2026-09-23, Tetris-Handlauf), die promptlose Übernahme (start ohne
        // Prompt) ist der Idle-Pfad wie recover() ohne Worker.
        resume: { argv: ["opencode", "--session", "{sessionId}"], ref: "native", hub: true },
        features: { followUp: true, interrupt: true, toolGate: cfg.extraArgs.includes("--auto") ? "bypass" : "allowlist", questions: false, modelChoice: "start", modelSwitch: false, permissionModes: [], skills: true, agents: true, images: true, files: true, contextFork: false } };
    },

    /** ADR-0018: `opencode models` lists every model the configured
     * providers offer (read-only listing, not a worker). ADR-0054: ein
     * konfiguriertes `modelsCommand` geht durch den geteilten Parser
     * (Labels/bare Ids erlaubt), der native Pfad bleibt bei parseModelList. */
    async models(): Promise<ModelOption[]> {
      if (cfg.modelsCommand) return modelsFromCommand(cfg.modelsCommand, { env });
      const start = spawnArgv(cfg.command, ["models"]);
      const { stdout } = await run(start.file, start.args, { timeout: 20_000, maxBuffer: 1024 * 1024, ...(start.shell ? { shell: true } : {}), ...(Object.keys(env).length > 0 ? { env: { ...process.env, ...env } } : {}) });
      return parseModelList(stdout);
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = OpencodeSessionArgs.safeParse(spec.args);
      const agent = args.success ? args.data?.agent : undefined;
      const skill = args.success ? args.data?.skill : undefined;
      const chain = args.success ? (args.data?.skillChain ?? []) : [];
      const resumeSessionId = args.success ? args.data?.resumeSessionId : undefined;
      if (chain.length === 0 && skill) {
        ctx.emit({
          type: "system",
          summary: "opencode: skill selection ignored — no project-local skill mechanism verified for this adapter",
          payload: { kind: "opencode.skill_ignored", requested: skill },
        });
      }
      const meta: SessionMeta = { healthy: true, ...(resumeSessionId ? { resumeSessionId } : {}) };
      const model = spec.model ?? cfg.model;
      if (model) {
        // ADR-0032/0054: the curated window of this model rides the announce;
        // `contextWindows` aus der Konfiguration schlägt die Tabelle.
        const window = resolveContextWindow(model, undefined, cfg.contextWindows);
        ctx.emit({
          type: "system",
          summary: `OpenCode · ${model}`,
          payload: { kind: "opencode.model", model, ...(window !== null ? { contextWindowTokens: window } : {}) },
        });
      }
      const w = withFiles(spec.prompt ?? "", spec.attachments);
      if (resumeSessionId && !w.prompt.trim() && w.files.length === 0) {
        // EPIC-P35 T35.3 (ADR-0044): promptlose Übernahme nach „Weitermachen“ —
        // wie recover() ohne Worker: kein Prozess, der nächste Prompt setzt fort.
        sessions.set(ctx.sessionId, meta);
        ctx.emit({
          type: "system",
          summary: `opencode: Session ${resumeSessionId.slice(0, 12)} übernommen — der nächste Prompt setzt sie fort`,
          payload: { kind: "opencode.session_adopted", nativeSessionId: resumeSessionId },
        });
        return { sessionId: ctx.sessionId };
      }
      // Config-Env plus die Env des Session-Starts (SessionSpec.env gewinnt, wie ACP/pi).
      const spawnEnv = { ...env, ...spec.env };
      const proc = await ctx.spawnWorker(buildArgs(w.prompt, resumeSessionId, agent, model, w.files), Object.keys(spawnEnv).length > 0 ? { env: spawnEnv } : undefined);
      attach(ctx.sessionId, proc, ctx, meta);
      const handle: SessionHandle = {
        sessionId: ctx.sessionId,
        ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      };
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const meta = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt": {
          const w = withFiles(input.text, input.attachments);
          const proc = await ctx.spawnWorker(buildArgs(w.prompt, meta?.resumeSessionId, undefined, undefined, w.files), Object.keys(env).length > 0 ? { env } : undefined);
          attach(handle.sessionId, proc, ctx, meta ?? { healthy: true });
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "configure":
          return { ok: false, detail: "opencode: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "opencode: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0014: after a hub restart, take over the turn that is still
     * running, or continue natively with the next prompt. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? undefined;
      const proc = (await ctx.adoptWorker?.()) ?? null;
      if (!proc && !native) return null;
      const meta: SessionMeta = { healthy: true, ...(native ? { resumeSessionId: native } : {}) };
      if (proc) attach(sessionId, proc, ctx, meta);
      else sessions.set(sessionId, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },

    // No recover(): same reasoning as adapter-claude — a real CLI process,
    // not resumable in-place after a hub crash without re-attaching to a
    // live tmux pane.
  };

  return adapter;
}

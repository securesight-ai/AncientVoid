import { z } from "zod";
import {
  isCompactionCommand,
  providerErrorEvent,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type Ack,
  type HealthReport,
  type ModelOption,
  type SessionHandle,
  type SessionSpec,
  type SteerInput,
  type WorkerProcess,
} from "@ancientvoid/contracts";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contextWindowFor, modelsFromCommand, parseModelTable } from "@ancientvoid/models";
import { createPiStream } from "./normalize.ts";
import { createPiRpc } from "./rpc.ts";
import { createLivePump } from "@ancientvoid/contracts"; // ADR-0083
import { findSessionFile, isSessionId, readTranscript } from "./transcript.ts";

/**
 * pi adapter (pi coding agent, badlogic/pi). Spawns `pi -p --mode json --continue`
 * per turn — pi keeps its own session state in ~/.pi/agent/sessions keyed
 * by cwd, so consecutive turns in the same project continue the thread.
 *
 * Verified behaviour (gpubox + agent-host, 2026-10-25):
 * - headless ONLY without a pty; the hub's tmux worker provides one, but
 *   pi -p exits fine when stdin is not a terminal — it never blocks.
 * - model choice via `--model provider/id`; custom providers from
 *   ~/.pi/agent/models.json (providers-OBJECT, apiKey directly).
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable (default "pi").
 *   extraArgs: extra CLI args appended verbatim.
 */
const PiConfig = z.object({
  command: z.string().min(1).default("pi"),
  extraArgs: z.array(z.string()).default([]),
  /** Registered default `--model provider/id` (e.g. the gpubox qwen). A
   * session's own model choice (SessionSpec.model) always wins — without
   * either, pi runs its own default and the hub says so honestly. */
  model: z.string().min(1).optional(),
  /** ADR-0032: the model's context window in tokens, from pi's own
   * models.json (`contextWindow`) — pi does not report it in the stream.
   * ADR-0054: `contextWindows` löst pro Modell auf (Konfiguration schlägt
   * die kuratierte Tabelle) und gewinnt über den einzelnen Wert. */
  contextWindowTokens: z.number().int().positive().optional(),
  contextWindows: z.record(z.string().min(1), z.number().int().positive()).default({}),
  /** ADR-0054 (EPIC-P35 T35.7): listendes Kommando für den Modell-Katalog —
   * ohne Config bleibt die Modellwahl freie Eingabe. */
  modelsCommand: z.array(z.string().min(1)).min(1).optional(),
  /** ADR-0041: where pi keeps its session files (adoption looks sessions up here). Default: pi's own. */
  sessionsDir: z.string().min(1).optional(),
  /** Zug um Zug (`pi -p`) oder ein langlebiger Steuerprozess (`pi --mode rpc`).
   * RPC ist der Weg, der Lenken mitten im Zug erlaubt, ohne je einen
   * Zweitprozess auf dieselbe native Session zu öffnen (BUG-0261). Voreinstellung
   * bleibt `oneshot`, bis der Live-Nachweis auf einem echten Hub erbracht ist —
   * so ist der Rückfall eine Zeile in hub.config.json, kein Rückbau. */
  mode: z.enum(["oneshot", "rpc"]).default("oneshot"),
});

/** ADR-0041: start arguments of an adoption (set by the hub, never by the person). */
const PiSessionArgs = z
  .object({
    resumeSessionId: z.string().min(1).optional(),
    /** Continue as a copy (`--fork`): the original stays untouched. First turn only. */
    forkSession: z.boolean().optional(),
    importHistory: z.boolean().optional(),
  })
  .optional();

/** Keep the imported window short: the phone needs "where do I stand", not three weeks of tool output. */
const IMPORT_LIMIT = 200;
type PiConfig = z.infer<typeof PiConfig>;

interface SessionMeta {
  healthy: boolean;
  busy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: PiConfig = PiConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();
  const sessionModels = new Map<string, string | undefined>();
  const sessionsDir = cfg.sessionsDir ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
  /** ADR-0041: an adopted session is addressed by its file (`pi --session <path>` also finds other projects'
   * sessions, an id does not); a fork uses `--fork` for its first turn only. */
  const resumes = new Map<string, { file: string; fork: boolean }>();

  /**
   * BUG-0261 (Nachweis 2026-11-23): Lenken war bei Pi ein **zweiter**
   * `pi -p --session <dieselbe Datei>` — drei solcher Prozesse schrieben
   * gleichzeitig ins Arbeitsverzeichnis. pi bietet für genau diesen Fall einen
   * Steuerkanal: `pi --mode rpc` (docs/rpc.md) nimmt `prompt`, `steer`,
   * `follow_up` und `abort` als JSONL auf stdin. Ein Prozess pro Session, viele
   * Züge, Lenkung wirkt nach dem laufenden Tool-Aufruf vor dem nächsten
   * Modell-Aufruf (im pi-Eigentest gemessen: `queue_update` mitten im
   * `tool_execution_update`, Antwort `disposition: "queued"`).
   */
  interface PiWorker {
    proc: WorkerProcess;
    rpc: ReturnType<typeof createPiRpc>;
    running: boolean;
  }
  const arbeiter = new Map<string, PiWorker>();

  function rpcArgs(model: string | undefined, resume?: { file: string; fork: boolean }): string[] {
    const args = [cfg.command, "--mode", "rpc"];
    if (resume) args.push(resume.fork ? "--fork" : "--session", resume.file);
    if (model) args.push("--model", model);
    return [...args, ...cfg.extraArgs];
  }

  /** Ein Steuerprozess für eine Session: starten, Protokoll an den Hub hänken,
   * die native Session-Datei festhalten (für /compact, Übernahme, Fortsetzen). */
  async function startWorker(sessionId: string, ctx: AdapterContext, meta: SessionMeta, model: string | undefined): Promise<PiWorker> {
    const proc = await ctx.spawnWorker(rpcArgs(model, resumes.get(sessionId)), { stdin: "pipe", persistent: true });
    const live = ctx.stream ? createLivePump((f) => ctx.stream?.(f)) : undefined;
    const strom = createPiStream(live);
    const worker: PiWorker = { proc, running: false, rpc: undefined as unknown as ReturnType<typeof createPiRpc> };
    const rpc = createPiRpc(proc, (record) => {
      // Zugrahmen: ein persistenter Prozess endet nicht pro Zug, also meldet der
      // Adapter sie selbst (contracts: ctx.turn für persistente Worker). pi sagt
      // `agent_start` und `agent_settled` — letzteres heißt: pi macht von allein
      // weiter mit nichts (docs/rpc.md), genau die Zuggrenze.
      if (record.type === "agent_start") {
        worker.running = true;
        ctx.turn?.("working");
      }
      if (record.type === "agent_settled") {
        worker.running = false;
        ctx.turn?.("idle");
      }
      for (const event of strom.push(`${JSON.stringify(record)}\n`)) ctx.emit(event);
    });
    worker.rpc = rpc;
    let fehlerText = "";
    proc.onStderr((chunk: string) => {
      fehlerText = (fehlerText + chunk).slice(-2000);
      ctx.log("warn", "pi stderr", { chunk: chunk.slice(0, 500) });
    });
    proc.onExit((code: number | null) => {
      meta.busy = false;
      for (const event of strom.end()) ctx.emit(event);
      live?.close();
      if (code !== 0 && code !== null && fehlerText.trim()) ctx.emit(providerErrorEvent("pi", fehlerText.trim()));
      ctx.emit({ type: "system", summary: "pi: Steuerprozess beendet", payload: { kind: "pi.worker_end", code: code ?? 0 } });
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
      if (arbeiter.get(sessionId) === worker) arbeiter.delete(sessionId);
    });
    arbeiter.set(sessionId, worker);
    procs.set(sessionId, proc);
    meta.healthy = true;
    settleFork(sessionId);
    const zustand = await rpc.request("get_state", undefined, 8_000);
    if (zustand.success && zustand.data && typeof zustand.data === "object") {
      const d = zustand.data as { sessionId?: unknown; sessionFile?: unknown; isStreaming?: unknown };
      worker.running = d.isStreaming === true;
      if (typeof d.sessionId === "string" && d.sessionId) {
        ctx.emit({
          type: "system",
          summary: "pi: Session gestartet",
          payload: {
            kind: "pi.session",
            piSessionId: d.sessionId,
            nativeSessionId: d.sessionId,
            ...(typeof d.sessionFile === "string" ? { sessionFile: d.sessionFile } : {}),
          },
        });
        if (!resumes.get(sessionId) && typeof d.sessionFile === "string") resumes.set(sessionId, { file: d.sessionFile, fork: false });
      }
    }
    return worker;
  }

  function buildArgs(prompt: string, model: string | undefined, first: boolean, resume?: { file: string; fork: boolean }): string[] {
    // pi -p hangs when stdin is a TTY (hub workers run under tmux) — route
    // through sh with stdin redirected from /dev/null, stdout stays piped.
    // BUG-0066: pi 1.4.0 has no `exec` subcommand — positionals are messages,
    // so `exec` became its own turn. `-p` is the headless mode; `--` keeps a
    // prompt starting with "-" from being read as a flag.
    const piArgs = [cfg.command, "-p", "--mode", "json"];
    if (resume) piArgs.push(resume.fork ? "--fork" : "--session", resume.file);
    else if (!first) piArgs.push("--continue");
    if (model) piArgs.push("--model", model);
    piArgs.push(...cfg.extraArgs, "--", prompt);
    const cmdline = piArgs.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'")).join(" ");
    return ["sh", "-c", cmdline + " </dev/null"];
  }

  function attach(ctx: AdapterContext, proc: WorkerProcess, meta: SessionMeta) {
    // Reset per new process: a stale `healthy=false` from a *previous*
    // one-shot turn's abnormal exit must not stick once a fresh process
    // (this steer()'s continuation) actually ran and exited cleanly —
    // same BUG-0008/BUG-0076 lesson as adapter-claude: pi is one-shot per
    // turn, the session between turns is idle, not down.
    meta.healthy = true;
    // BUG-0065: `--mode json` streams thinking, tool calls and results;
    // each finished block is emitted live instead of one text at exit.
    // ADR-0083: hat der Hub `ctx.stream`, gehen die Deltas zusätzlich als
    // transiente Frames raus — echtes Streaming statt clientseitigem Nachtippen.
    const live = ctx.stream ? createLivePump((f) => ctx.stream?.(f)) : undefined;
    const stream = createPiStream(live);
    let stderr = "";
    procs.set(ctx.sessionId, proc);
    proc.onStdout((chunk: string) => {
      for (const event of stream.push(chunk)) ctx.emit(event);
    });
    proc.onStderr((chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
      ctx.log("warn", "pi stderr", { chunk: chunk.slice(0, 500) });
    });
    proc.onExit((code: number | null) => {
      meta.busy = false;
      for (const event of stream.end()) ctx.emit(event);
      live?.close(); // offene Timer weg; ein unvollendeter Block hat keine Frames mehr
      // JSON mode keeps stdout for records only — a failing pi says why on
      // stderr, which must not stay in the log alone (fail loud).
      if (code !== 0 && code !== null && stderr.trim()) ctx.emit(providerErrorEvent("pi", stderr.trim()));
      ctx.emit({ type: "system", summary: "pi: turn finished", payload: { kind: "pi.turn_end", code: code ?? 0 } });
      if (code !== 0 && code !== null) meta.healthy = false;
      if (procs.get(ctx.sessionId) === proc) procs.delete(ctx.sessionId);
    });
  }

  /** After the first turn of a fork the copy is the session pi continues in this project (`--continue`). */
  function settleFork(sessionId: string): void {
    if (resumes.get(sessionId)?.fork) resumes.delete(sessionId);
  }

  const adapter: Adapter = {
    id: "pi",
    version: "0.1.0",

    /** ADR-0054/0060: Katalog aus `modelsCommand` oder, ohne Konfiguration, aus `pi --list-models`
     * (geprüft 2026-11-09, pi 1.4.0). */
    async models(): Promise<ModelOption[]> {
      // `pi --list-models` zeigt nur Provider mit nutzbarer Anmeldung (pi docs/models.md); ein eigener
      // `modelsCommand` liefert Zeilen `provider/model`.
      return cfg.modelsCommand ? modelsFromCommand(cfg.modelsCommand) : modelsFromCommand([cfg.command, "--list-models"], { parse: parseModelTable });
    },

    capabilities(): AdapterCapabilities {
      const steuern = cfg.mode === "rpc";
      return {
        promptDelivery: steuern ? "live" : "next-turn",
        // BUG-0261: Pi sicherte `midTurnInput: true` zu (ADR-0085) mit der Begruendung
        // „jeder Lenk-Aufruf ist ein eigener Lauf“. Genau dieser eigene Lauf ist ein
        // **zweiter Prozess auf dieselbe native Session** — gemessen 2026-11-23: drei
        // `pi -p --session <dieselbe Datei>` gleichzeitig, die sich im Arbeitsverzeichnis
        // gegenseitig überschrieben. Was ADR-0074 für Claude & Co. verbietet, galt bei
        // Pi nur wegen einer falschen Zusicherung. Im RPC-Modus entfällt der Grund:
        // ein Prozess, die Meldung kommt auf dem Steuerkanal an (`steer`/`prompt`).
        midTurnInput: steuern,
        commands: [{ name: "/compact", description: "Pi-Kontext der aktuellen Session komprimieren", scope: "steer" }],
        reasoning: true,
        tools: true,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "read-only",
        nativeResume: "native",
        // EPIC-P35 T35.3 (ADR-0036/0041/0044): `pi --session <id|file>` setzt
        // fort; die promptlose Übernahme (start ohne Prompt bleibt idle,
        // ADR-0041-Pfad in start()) macht „Weitermachen“ hub-fähig.
        resume: { argv: ["pi", "--session", "{sessionId}"], ref: "native", hub: true, auto: true },
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        features: {
          followUp: true,
          interrupt: true,
          toolGate: "bypass",
          questions: false,
          modelChoice: "start",
          modelSwitch: false,
          permissionModes: [],
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        },
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      if (spec.prompt && isCompactionCommand(spec.prompt)) throw new Error("pi: /compact erfordert eine gestartete Session");
      const args = PiSessionArgs.safeParse(spec.args);
      const resumeId = args.success ? args.data?.resumeSessionId : undefined;
      if (resumeId) {
        if (!isSessionId(resumeId)) throw new Error(`pi kann „${resumeId}" nicht fortsetzen — keine Session-ID (UUID).`);
        const file = findSessionFile(sessionsDir, resumeId);
        if (!file) throw new Error(`pi: Session ${resumeId.slice(0, 8)} nicht gefunden unter ${sessionsDir}`);
        resumes.set(ctx.sessionId, { file, fork: args.success && args.data?.forkSession === true });
        const events = readTranscript(file);
        const shown = events.length > IMPORT_LIMIT ? events.slice(-IMPORT_LIMIT) : events;
        ctx.emit({
          type: "system",
          summary: `pi: Verlauf aus der Session übernommen (${shown.length} von ${events.length} Events, ${resumeId.slice(0, 8)})`,
          payload: { kind: "pi.transcript_imported", session: resumeId, imported: shown.length, total: events.length },
        });
        for (const event of shown) ctx.emit(event);
        if (!spec.prompt?.trim()) {
          // ADR-0041: an adoption without a first prompt has no turn — like recover(), the next prompt resumes.
          sessions.set(ctx.sessionId, { healthy: true, busy: false });
          const model = spec.model ?? cfg.model;
          if (model) sessionModels.set(ctx.sessionId, model);
          return { sessionId: ctx.sessionId };
        }
      }
      const meta: SessionMeta = { healthy: true, busy: true };
      sessions.set(ctx.sessionId, meta);
      // T17-adjacent honesty (2026-10-26): the effective model must be
      // visible, not just configured — record it per session AND emit it
      // as an event, so the UI shows what actually runs even when the
      // default came from this registration's config.
      const model = spec.model ?? cfg.model;
      sessionModels.set(ctx.sessionId, model);
      if (model) {
        // ADR-0054: Fenster pro Modell auflösen — `contextWindows`-Map schlägt
        // den einzelnen Wert, der schlägt die kuratierte Tabelle (ADR-0032).
        const overrideHit = Object.entries(cfg.contextWindows).find(([needle]) => model.toLowerCase().includes(needle.toLowerCase()));
        const window = overrideHit?.[1] ?? cfg.contextWindowTokens ?? contextWindowFor(model) ?? undefined;
        ctx.emit({
          type: "system",
          summary: `pi: Modell ${model}`,
          payload: { kind: "pi.model", model, ...(window !== undefined ? { contextWindowTokens: window } : {}) },
        });
      }
      if (cfg.mode === "rpc") {
        // Ohne Prompt kein Prozess: ein Steuerprozess ohne erste Meldung würde nur
        // auf Eingabe warten und die Session auf `working` halten (e2e-Fund bei
        // Claude, 2026-11-20). Der nächste Lenk-Aufruf spawnt.
        if (!spec.prompt?.trim()) {
          const modelOhneZug = spec.model ?? cfg.model;
          if (modelOhneZug) sessionModels.set(ctx.sessionId, modelOhneZug);
          return { sessionId: ctx.sessionId };
        }
        const arbeiterNeu = await startWorker(ctx.sessionId, ctx, meta, model);
        arbeiterNeu.running = true;
        arbeiterNeu.rpc.send({ type: "prompt", message: spec.prompt });
        return {
          sessionId: ctx.sessionId,
          ...(arbeiterNeu.proc.pid !== undefined ? { pid: arbeiterNeu.proc.pid } : {}),
        };
      }
      const proc = await ctx.spawnWorker(
        buildArgs(spec.prompt ?? "(Session startet — bitte bestätigen mit OK)", model, true, resumes.get(ctx.sessionId)),
        spec.env ? { env: spec.env } : undefined,
      );
      settleFork(ctx.sessionId);
      attach(ctx, proc, meta);
      return {
        sessionId: ctx.sessionId,
        ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      switch (input.kind) {
        case "prompt": {
          const meta = sessions.get(handle.sessionId);
          if (!meta) return { ok: false, detail: "pi: unbekannte Session" };
          if (cfg.mode === "rpc") {
            const arbeiterBestehend = arbeiter.get(handle.sessionId);
            const ziel = arbeiterBestehend ?? (await startWorker(handle.sessionId, ctx, meta, sessionModels.get(handle.sessionId)));
            if (isCompactionCommand(input.text)) {
              if (input.text.trim() !== "/compact" || input.attachments?.length) {
                return { ok: false, detail: "pi: /compact nimmt keine Argumente oder Anhänge an" };
              }
              const kompakt = await ziel.rpc.request("compact", undefined, 120_000);
              return kompakt.success ? { ok: true } : { ok: false, detail: `pi: /compact — ${kompakt.error ?? "abgelehnt"}` };
            }
            if (input.attachments?.length) {
              return { ok: false, detail: "pi: Anhänge im Steuerprozess noch nicht möglich — bitte Pfad oder URL im Text nennen" };
            }
            // Läuft ein Zug, ist die Meldung eine **Lenkung**: pi stellt sie nach dem
            // laufenden Tool-Aufruf vor den nächsten Modell-Aufruf (pi docs/rpc.md).
            // Zwischendrin ist es ein normaler Prompt im selben Prozess.
            ziel.rpc.send(ziel.running ? { type: "steer", message: input.text } : { type: "prompt", message: input.text });
            meta.busy = true;
            return { ok: true };
          }
          // BUG-0261: reserve the session before awaiting a process spawn.
          if (meta.busy) {
            ctx.log("warn", "pi: Prompt abgelehnt — ein Lauf läuft bereits", { sessionId: handle.sessionId });
            return { ok: false, detail: "ein pi-Lauf läuft bereits — Meldung bitte vormerken" };
          }
          const model = sessionModels.get(handle.sessionId);
          const resume = resumes.get(handle.sessionId);
          const compact = isCompactionCommand(input.text);
          let args: string[];
          let file: string | null = null;
          if (compact) {
            if (input.text.trim() !== "/compact" || input.attachments?.length) {
              return { ok: false, detail: "pi: /compact nimmt keine Argumente oder Anhänge an" };
            }
            if (resume?.fork) return { ok: false, detail: "pi: vor /compact erst die Session-Kopie mit einem Prompt anlegen" };
            file = resume?.file ?? (ctx.nativeSessionId ? findSessionFile(sessionsDir, ctx.nativeSessionId) : null);
            if (!file) return { ok: false, detail: "pi: native Session-Datei für /compact fehlt" };
            args = [process.execPath, fileURLToPath(new URL("./compact-worker.ts", import.meta.url)), cfg.command, file, ...cfg.extraArgs];
            if (model) args.push("--model", model);
          } else {
            args = buildArgs(input.text, model, false, resume);
          }
          meta.busy = true;
          try {
            const proc = await ctx.spawnWorker(args);
            if (file) resumes.set(handle.sessionId, { file, fork: false });
            settleFork(handle.sessionId);
            attach(ctx, proc, meta);
          } catch (err) {
            meta.busy = false;
            throw err;
          }
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await arbeiter.get(handle.sessionId)?.proc.kill("SIGTERM");
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "configure":
          return { ok: false, detail: "pi: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "pi: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0041: after a hub restart the session is still addressable by the id it announced. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId;
      if (!native) return null;
      const file = findSessionFile(sessionsDir, native);
      if (!file) return null;
      resumes.set(sessionId, { file, fork: false });
      // BUG-0209: pi läuft one-shot je Zug. Der Hub muss wissen, ob der Worker des offenen
      // Zugs den Neustart überlebt hat — sonst stand die Session ewig auf `working`, obwohl
      // niemand mehr lief (kein Adoptions-Ergebnis → adopted=false → Zug wird unterbrochen).
      const proc = (await ctx.adoptWorker?.(cfg.mode === "rpc" ? { persistent: true } : undefined)) ?? null;
      const meta: SessionMeta = { healthy: true, busy: proc !== null };
      sessions.set(sessionId, meta);
      if (proc) attach(ctx, proc, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle, ctx: AdapterContext): Promise<void> {
      const steuernd = arbeiter.get(handle.sessionId);
      if (steuernd) {
        // pi docs/rpc.md: `abort` bricht ab **und wartet**, bis die Sitzung leerläuft.
        const abbruch = await steuernd.rpc.request("abort", undefined, 20_000);
        if (!abbruch.success) ctx.log("warn", "pi: abort fehlgeschlagen", { detail: abbruch.error ?? "" });
        await steuernd.proc.kill("SIGTERM");
        arbeiter.delete(handle.sessionId);
      }
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
      resumes.delete(handle.sessionId);
    },
  };

  return adapter;
}

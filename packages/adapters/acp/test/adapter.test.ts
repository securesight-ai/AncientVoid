import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import type { AdapterContext, EmittedEvent, ToolPermissionRequest, WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { ProcessRunner } from "@ancientvoid/workers";
import { ACP_PRESETS, createAdapter, pickModel } from "../src/index.ts";
import { JsonRpcConnection as AcpConnection } from "@ancientvoid/adapter-jsonrpc";
import { UpdateMapper } from "../src/normalize.ts";
import { standIn } from "../../../../e2e/support/stand-in.ts";

const agent = standIn("acp-agent");
chmodSync(agent, 0o755);

/** A context with a real child process worker and the given hub answers. */
function context(opts: { answer?: "allow" | "deny"; asked?: ToolPermissionRequest[]; turns?: string[] } = {}) {
  const runner = new ProcessRunner();
  const ctx = makeRecordingContext({
    workdir: process.cwd(),
    spawnWorker: (cmd, o) => runner.spawn({ name: "acp-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    ...(opts.answer
      ? {
          requestToolPermission: async (req: ToolPermissionRequest) => {
            opts.asked?.push(req);
            return opts.answer === "allow" ? { behavior: "allow" as const, updatedInput: req.input } : { behavior: "deny" as const, message: "nein" };
          },
        }
      : {}),
    turn: (state: "working" | "idle") => opts.turns?.push(state),
  } as Partial<AdapterContext>);
  return ctx;
}

const texts = (events: EmittedEvent[], type: string) => events.filter((e) => e.type === type).map((e) => (e.payload as { text?: string }).text);

describe("acp adapter (T7.2)", () => {
  it("presets: the opencode preset makes opencode ask (ADR-0018)", () => {
    expect(ACP_PRESETS.copilot.command).toEqual(["copilot", "--acp"]);
    expect(JSON.parse(ACP_PRESETS.opencode.env.OPENCODE_CONFIG_CONTENT).permission).toEqual({ edit: "ask", bash: "ask", webfetch: "ask" });
    expect(ACP_PRESETS.dsh.env.DSH_PERMISSION_MODE).toBe("read-only");
    expect(ACP_PRESETS.maki.command).toEqual(["maki", "acp"]);
    expect(createAdapter({ preset: "maki" }).capabilities().features).toMatchObject({ toolGate: "native", modelChoice: "start" });
    expect(ACP_PRESETS.omp.command).toEqual(["omp", "acp"]);
    expect(createAdapter({ preset: "omp" }).capabilities().features).toMatchObject({ toolGate: "native", modelChoice: "start" });
    expect(createAdapter({ preset: "copilot" }).capabilities().features.modelChoice).toBe("none");
    expect(createAdapter({ preset: "dsh" }).capabilities().features).toMatchObject({ toolGate: "native", followUp: true, interrupt: true, modelChoice: "start" });
    expect(createAdapter({ command: ["x"], permissions: "reject" }).capabilities().features.toolGate).toBe("allowlist");
    expect(() => createAdapter({})).toThrow("preset");
  });

  it("BUG-0101/EPIC-P35: maki/omp/opencode deklarieren natives Hub-Resume (ADR-0041-Beleg, ADR-0044-Opt-in)", () => {
    // start({args:{resumeSessionId}}) ohne Prompt lädt die alte Konversation
    // (session/load) — der belegte Pfad darf „Weitermachen" freischalten.
    expect(createAdapter({ preset: "maki" }).capabilities().resume).toEqual({ argv: ["maki", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true });
    expect(createAdapter({ preset: "omp" }).capabilities().resume).toEqual({ argv: ["omp", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true });
    // EPIC-P35 (07.11.2026): opencode meldet loadSession im Handshake und lädt
    // promptlos — live belegt (Worker-Kill → Weitermachen → Kontext da).
    expect(createAdapter({ preset: "opencode" }).capabilities().resume).toEqual({ argv: ["opencode", "--session", "{sessionId}"], ref: "native", hub: true, auto: true });
    // ein eigener Aufruf zeigt die echte Binary im Anzeige-Template
    expect(createAdapter({ preset: "maki", command: ["maki-nightly", "acp"] }).capabilities().resume).toEqual({ argv: ["maki-nightly", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true });
    // ohne Beleg keine Deklaration — das ist der ehrliche Zustand (ADR-0036)
    expect(createAdapter({ preset: "dsh" }).capabilities().resume).toBeUndefined();
    expect(createAdapter({ preset: "copilot" }).capabilities().resume).toBeUndefined();
    expect(createAdapter({ command: [agent] }).capabilities().resume).toBeUndefined();
  });

  it("a turn: whole messages (not token events), thinking, native id, turn signals, tokens", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant")).toEqual(["Antwort auf: Hallo · ACP"]);
    expect(texts(ctx.events, "thinking")).toEqual(["Ich überlege kurz."]);
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session");
    expect((native?.payload as { nativeSessionId?: string }).nativeSessionId).toMatch(/^acp_/);
    const turnEnd = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end");
    expect(turnEnd?.tokensEst).toBe(42);
    // ADR-0032: the input part is the context fill — it travels on the event.
    expect((turnEnd?.payload as { usage?: { input?: number; output?: number } }).usage).toMatchObject({ input: 30, output: 12 });
    expect(createAdapter({ command: [agent], contextWindowTokens: 200_000 }).capabilities().contextWindowTokens).toBe(200_000);
    expect(turns).toEqual(["working", "idle"]);
    // follow-up in the same agent process
    expect(await adapter.steer(handle, { kind: "prompt", text: "Nochmal" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 2);
    await adapter.stop(handle, ctx);
  });

  it("EPIC-P35: endet der Agent zwischen Zügen von selbst, startet der nächste Prompt ihn mit geladener Konversation (dormant, BUG-0060-Weg)", async () => {
    const procs: WorkerProcess[] = [];
    const runner = new ProcessRunner();
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      spawnWorker: async (cmd: string[], o: { env?: Record<string, string> }) => {
        const proc = await runner.spawn({ name: "acp-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) });
        procs.push(proc);
        return proc;
      },
    } as Partial<AdapterContext>);
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Erste Frage" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(procs).toHaveLength(1);

    // Der Agent-Prozess endet von selbst zwischen Zügen (live beobachtet bei
    // opencode acp nach dem geladenen Zug, 07.11.2026): die Session bleibt
    // weckbar, das steht als Ereignis im Tail — fail loud, kein stiller Tod.
    await procs[0]!.kill("SIGKILL");
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "acp.dormant_exit"));

    const ack = await adapter.steer(handle, { kind: "prompt", text: "Zweite Frage" }, ctx);
    expect(ack.ok).toBe(true);
    await waitFor(() => texts(ctx.events, "assistant").length === 2);
    // Ein neuer Agent wurde gestartet und die native Konversation geladen.
    expect(procs).toHaveLength(2);
    expect(texts(ctx.events, "assistant")[1]).toContain("Zweite Frage");
    await adapter.stop(handle, ctx);
  });

  it("request_permission goes to the phone; allow picks allow_once — never allow_always", async () => {
    const asked: ToolPermissionRequest[] = [];
    const turns: string[] = [];
    const ctx = context({ answer: "allow", asked, turns });
    const adapter = createAdapter({ command: [agent] });
    await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(asked[0]).toMatchObject({ toolName: "Shell", input: { command: "echo hallo-acp" } });
    expect(asked[0]!.toolUseId).toMatch(/^call_/);
    expect(texts(ctx.events, "assistant")[0]).toContain("Ausgabe hallo-acp (allow-once)");
    const result = ctx.events.find((e) => e.type === "tool_result");
    expect(result?.payload).toMatchObject({ isError: false, content: "hallo-acp" });
  });

  it("elicitation/create wird zum Fragen-Formular des Handys und die Antwort passt zum Schema (T21.4)", async () => {
    const asked: ToolPermissionRequest[] = [];
    const turns: string[] = [];
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      spawnWorker: (cmd, o) => new ProcessRunner().spawn({ name: "acp-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
      requestToolPermission: async (req: ToolPermissionRequest) => {
        asked.push(req);
        return { behavior: "allow" as const, updatedInput: { ...req.input, answers: { "Wie soll es weitergehen?: Strategie": "x", Strategie: "Gründlich", Teile: "API-Teil, ui, doku", "Sicher?": "Ja", Anzahl: "3,0" } } };
      },
      turn: (state: "working" | "idle") => turns.push(state),
    } as Partial<AdapterContext>);
    await createAdapter({ command: [agent] }).start({ adapter: "acp", project: process.cwd(), prompt: "Bitte FRAGE" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const questions = (asked[0]!.input as { questions: { question: string; options: { label: string }[]; multiSelect: boolean; header?: string }[] }).questions;
    expect(asked[0]!.toolName).toBe("AskUserQuestion");
    expect(questions.map((q) => q.question)).toEqual(["Strategie", "Teile", "Sicher?", "Anzahl"]);
    expect(questions[0]).toMatchObject({ header: "Wie soll es weitergehen?", multiSelect: false });
    expect(questions[0]!.options.map((o) => o.label)).toEqual(["Schnell", "Gründlich"]);
    expect(questions[1]).toMatchObject({ multiSelect: true });
    expect(questions[2]!.options.map((o) => o.label)).toEqual(["Ja", "Nein"]);
    // Anzeige-Namen gehen zurück auf Schema-Werte; ganze Zahl; Mehrfachwahl als Liste
    const reply = texts(ctx.events, "assistant").join("");
    expect(reply).toContain('"action":"accept"');
    expect(reply).toContain('"content":{"strategie":"gruendlich","teile":["ui","doku"],"sicher":true,"anzahl":3}');
  });

  it("elicitation/create ohne Hub-Antwortweg wird abgelehnt statt zu hängen", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent] }).start({ adapter: "acp", project: process.cwd(), prompt: "Bitte FRAGE" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant").join("")).toContain('"action":"decline"');
  });

  it("a permission request with only the call id shows the tool from the earlier update (dsh)", async () => {
    const asked: ToolPermissionRequest[] = [];
    const turns: string[] = [];
    const ctx = context({ answer: "allow", asked, turns });
    await createAdapter({ command: [agent] }).start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG KNAPP" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(asked[0]).toMatchObject({ toolName: "Shell", input: { command: "echo hallo-acp" } });
  });

  it("model choice at start: set through the model config option; `provider/model` matches a pair value", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "Hallo", model: "lokal/klein" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant")[0]).toContain('Modell ["lokal","klein"]');
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.summary).toBe("fake · lokal/klein");
    // ADR-0032: models without a known window carry none — never a guess.
    expect((ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload as { contextWindowTokens?: number }).contextWindowTokens).toBeUndefined();
    // …and a known model carries its curated window on the announce.
    const turns2: string[] = [];
    const ctx2 = context({ turns: turns2 });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "Hallo", model: "lokal/glm-5.3" }, ctx2);
    await waitFor(() => turns2.includes("idle"));
    expect(ctx2.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload).toMatchObject({ contextWindowTokens: 1_000_000 });
    // config override wins over the curated table
    const turns3: string[] = [];
    const ctx3 = context({ turns: turns3 });
    await createAdapter({ command: [agent], label: "fake", contextWindows: { glm: 123_456 } }).start({ adapter: "acp", project: process.cwd(), prompt: "Hallo", model: "lokal/glm-5.3" }, ctx3);
    await waitFor(() => turns3.includes("idle"));
    expect(ctx3.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload).toMatchObject({ contextWindowTokens: 123_456 });
    // by name, and from the adapter config
    const byName = context({ turns: [] });
    const named = createAdapter({ command: [agent], model: "Groß" });
    const h = await named.start({ adapter: "acp", project: process.cwd() }, byName);
    expect(byName.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload).toMatchObject({ value: '["cloud","gross"]' });
    await named.stop(h, byName);
  });

  it("an unknown model fails the start visibly — never another model silently", async () => {
    const ctx = context();
    await expect(createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "x", model: "gibts/nicht" }, ctx)).rejects.toThrow("gibts/nicht");
  });

  it("pickModel also knows the older `models` block", () => {
    expect(pickModel({ models: { availableModels: [{ modelId: "a/b", name: "AB" }] } }, "AB")).toEqual({ method: "session/set_model", params: { modelId: "a/b" }, value: "a/b" });
    expect(pickModel({}, "x")).toBeNull();
  });

  it("deny, and no hub gate at all, both reject — the tool does not run", async () => {
    for (const ctx of [context({ answer: "deny" }), context()]) {
      const turns: string[] = [];
      (ctx as unknown as { turn: (s: string) => void }).turn = (s) => turns.push(s);
      const adapter = createAdapter({ command: [agent] });
      await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
      await waitFor(() => turns.includes("idle"));
      expect(texts(ctx.events, "assistant")[0]).toContain("nicht ausgeführt");
      expect(ctx.events.find((e) => e.type === "tool_result")?.payload).toMatchObject({ isError: true });
    }
  });

  it("park cancels the running turn; a queued prompt survives until then, a new one after park starts fresh", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent] });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await waitFor(() => turns.includes("working"));
    // A prompt while busy is queued, not refused — the phone never waits.
    expect(await adapter.steer(handle, { kind: "prompt", text: "dazwischen" }, ctx)).toMatchObject({ ok: true, detail: expect.stringContaining("Warteschlange") });
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.queued")).toBeTruthy();
    // Park discards the queued message, visibly.
    await adapter.steer(handle, { kind: "park" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end")?.payload).toMatchObject({ stopReason: "cancelled" });
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.queued_dropped")).toBeTruthy();
    // After park the session is idle — a prompt runs as a normal turn.
    expect(await adapter.steer(handle, { kind: "prompt", text: "Hallo" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 1, 8000);
    expect(texts(ctx.events, "assistant").join("")).toContain("Hallo");
    await adapter.stop(handle, ctx);
  });

  it("a prompt sent while busy is delivered right after the turn ends (FIFO)", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent] });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "STREAM" }, ctx);
    await waitFor(() => turns.includes("working"));
    expect(await adapter.steer(handle, { kind: "prompt", text: "Zweite" }, ctx)).toMatchObject({ ok: true });
    expect(await adapter.steer(handle, { kind: "prompt", text: "Dritte" }, ctx)).toMatchObject({ ok: true });
    // The first turn ends; both queued prompts run in order, each as its own turn.
    await waitFor(() => turns.filter((t) => t === "working").length === 3, 15_000);
    await waitFor(() => turns.filter((t) => t === "idle").length === 3, 15_000);
    const replies = texts(ctx.events, "assistant").join("");
    expect(replies).toContain("Antwort auf: STREAM");
    expect(replies).toContain("Zweite");
    expect(replies).toContain("Dritte");
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.queued_delivered")).toBeTruthy();
    await adapter.stop(handle, ctx);
  });

  it("BUG-0032: a silent turn is cancelled after stuckTurnMs and the session recovers", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake", stuckTurnMs: 400 });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await waitFor(() => turns.includes("idle"), 8000);
    const error = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "provider.error");
    expect(error?.payload).toMatchObject({ provider: "fake" });
    expect((error?.payload as { detail?: string }).detail).toContain("stumm");
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end")?.payload).toMatchObject({ stopReason: "cancelled" });
    expect(await adapter.steer(handle, { kind: "prompt", text: "Hallo" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 1, 8000);
    await adapter.stop(handle, ctx);
  });

  it("BUG-0032: an agent that ignores session/cancel is force-ended and the session recovers", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], stuckTurnMs: 300 });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "STUMM" }, ctx);
    await waitFor(() => turns.includes("idle"), 8000);
    expect(turns).toEqual(["working", "idle"]);
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_stuck")).toBeTruthy();
    expect(await adapter.steer(handle, { kind: "prompt", text: "Hallo" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 1, 8000);
    await adapter.stop(handle, ctx);
  });

  it("BUG-0032: a pending permission request disarms the watchdog — waiting for the phone is not stuck", async () => {
    const turns: string[] = [];
    const runner = new ProcessRunner();
    const asked: ToolPermissionRequest[] = [];
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      spawnWorker: (cmd, o) => runner.spawn({ name: "acp-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
      requestToolPermission: async (req: ToolPermissionRequest) => {
        asked.push(req);
        await new Promise((r) => setTimeout(r, 900));
        return { behavior: "allow" as const, updatedInput: req.input };
      },
      turn: (state: "working" | "idle") => turns.push(state),
    } as Partial<AdapterContext>);
    await createAdapter({ command: [agent], stuckTurnMs: 300 }).start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
    await waitFor(() => turns.includes("idle"), 8000);
    expect(asked).toHaveLength(1);
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "provider.error")).toBeUndefined();
    expect(texts(ctx.events, "assistant")[0]).toContain("Ausgabe hallo-acp");
  });

  it("BUG-0033: buffered chunks go out live while the turn runs, not only at its end", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent] });
    await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "STREAM" }, ctx);
    // The turn is silent for 5 s after the first chunk; without the live
    // flush the first assistant text only appears when the turn ends.
    await waitFor(() => texts(ctx.events, "assistant").length >= 1, 3_500);
    expect(turns).not.toContain("idle");
    await waitFor(() => turns.includes("idle"), 8_000);
    expect(texts(ctx.events, "assistant").join("")).toBe("Antwort auf: STREAM · ACP");
  });

  it("BUG-0293: Updates ohne ausstehenden Prompt flusht die Zug-Abschlussnachricht", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent] });
    await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "HINTERGRUND" }, ctx);
    // Der erste Zug endet regulär (end_turn → idle). Danach sendet der Agent
    // von sich aus Updates — wie ein Background-Task-Ergebnis in opencode:
    // kein session/prompt steht aus, und der Abschlussnachricht folgt kein
    // Tool-Call mehr. Der Mapper-Puffer braucht einen Trigger (Trailing-Flush).
    await waitFor(() => turns.includes("idle"), 8_000);
    await waitFor(() => texts(ctx.events, "assistant").some((t) => (t ?? "").includes("Hintergrund-Ergebnis")), 4_000);
    // Das Thinking kam live schon mit dem ersten Message-Chunk (Mapper-Flush
    // des Thought-Puffers) — das war im Live-Fund seq 358, der Text fehlte.
    expect(texts(ctx.events, "thinking").join("")).toContain("Hintergrund-Ergebnis da.");
  });

  it("ADR-0032: without totalTokens the turn counts input+output as its tokens", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "OHNE_TOTAL" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const turnEnd = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end");
    expect(turnEnd?.tokensEst).toBe(15);
    expect((turnEnd?.payload as { usage?: { input?: number; output?: number } }).usage).toMatchObject({ input: 10, output: 5 });
  });

  it("EPIC-P84: Cache- und Denk-Token, die der Agent getrennt meldet, gehen nicht verloren", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "MIT_CACHE" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const turnEnd = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end");
    // Eingabe bleibt der frische Anteil (wie Claude: ohne cacheIncluded), Denken zählt als Ausgabe.
    expect(turnEnd?.payload).toMatchObject({ usage: { input: 30, output: 20 }, cacheInputTokens: 50 });
    expect(turnEnd?.payload).not.toHaveProperty("cacheIncluded");
    expect(turnEnd?.tokensEst).toBe(100);
  });

  it("models(): a listing command feeds the start form's dropdown; derived for `… acp` agents, explicit via modelsCommand", async () => {
    const list = ["zai-coding-plan/glm-5.3", "opencode/claude-fable-5", "opencode/gpt-6-astra", "", "kein modell"];
    const script = `process.stdout.write(${JSON.stringify(list.join("\n"))})`;
    // derived: the trailing "acp" becomes "models" (opencode: `opencode models`)
    const derived = createAdapter({ command: [process.execPath, "-e", script, "acp"] });
    expect((await derived.models?.() ?? []).map((m) => m.id)).toEqual(["zai-coding-plan/glm-5.3", "opencode/claude-fable-5", "opencode/gpt-6-astra"]);
    // no derivation without a trailing "acp" — empty catalog, not an error
    expect(await createAdapter({ command: ["x"] }).models?.()).toEqual([]);
    const explicit = createAdapter({ command: ["x"], modelsCommand: [process.execPath, "-e", script] });
    expect((await explicit.models?.() ?? []).map((m) => m.id)).toEqual(["zai-coding-plan/glm-5.3", "opencode/claude-fable-5", "opencode/gpt-6-astra"]);
    // a failing command throws — the catalog route catches and shows free text
    const failing = createAdapter({ command: ["x"], modelsCommand: [process.execPath, "-e", "process.exit(1)"] });
    await expect(failing.models?.()).rejects.toThrow();
  });


  it("Nutzerwunsch 27.11.2026: das modelsCommand läuft mit env/envFiles — Provider-Keys erreichen auch den Katalog", async () => {
    const script = 'if (process.env.ZAI_API_KEY === "test-key") process.stdout.write("zai/glm-5.3\\n")';
    const adapter = createAdapter({ command: ["x"], env: { ZAI_API_KEY: "test-key" }, modelsCommand: [process.execPath, "-e", script] });
    expect((await adapter.models?.() ?? []).map((m) => m.id)).toEqual(["zai/glm-5.3"]);
    const ohne = createAdapter({ command: ["x"], modelsCommand: [process.execPath, "-e", script] });
    expect(await ohne.models?.()).toEqual([]);
  });
  it("BUG-0036: recover() plays a loaded history back silently — no second copy of the turn", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => texts(ctx.events, "assistant").length === 1);
    const native = String(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session")?.payload.nativeSessionId);
    await adapter.stop(handle, ctx);

    // hub restart: no surviving worker, the native id is known — the agent
    // re-notifies the loaded conversation (see the stand-in's session/load)
    const ctx2 = context({ turns: [] });
    const recoverCtx = Object.assign(ctx2, { nativeSessionId: native }) as typeof ctx2 & { nativeSessionId: string };
    const recovered = (await adapter.recover?.("restart", 1, recoverCtx)) ?? null;
    expect(recovered).toBeTruthy();
    expect(texts(ctx2.events, "assistant")).toEqual([]);
    expect(ctx2.events.filter((e) => e.type === "tool_use")).toEqual([]);
    expect(ctx2.events.filter((e) => e.type === "thinking")).toEqual([]);
    // after the takeover a new prompt still works normally
    expect(await adapter.steer(recovered!, { kind: "prompt", text: "Weiter" }, ctx2)).toEqual({ ok: true });
    await waitFor(() => texts(ctx2.events, "assistant").length === 1);
    await adapter.stop(recovered!, ctx2);
  });

  it("BUG-0060: recover() without a surviving agent starts none — one agent starts with the first prompt", async () => {
    const runner = new ProcessRunner();
    const spawned: string[][] = [];
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      nativeSessionId: "acp_alt_1234",
      adoptWorker: async () => null,
      spawnWorker: (cmd, o) => {
        spawned.push(cmd);
        return runner.spawn({ name: "acp-lazy", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) });
      },
      turn: () => {},
    } as Partial<AdapterContext>);
    const adapter = createAdapter({ command: [agent], label: "fake" });

    const handle = await adapter.recover!("lazy", 1, ctx);
    expect(handle).toEqual({ sessionId: "lazy" });
    expect(spawned).toEqual([]); // recovery is instant: no process, no history load
    expect((await adapter.status(handle!)).state).toBe("healthy");
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "acp.dormant")).toBe(true);

    // two prompts at once wake it once; both are delivered, the old history stays silent
    const [one, two] = await Promise.all([
      adapter.steer(handle!, { kind: "prompt", text: "eins" }, ctx),
      adapter.steer(handle!, { kind: "prompt", text: "zwei" }, ctx),
    ]);
    expect(one.ok && two.ok).toBe(true);
    expect(spawned.length).toBe(1);
    await waitFor(() => texts(ctx.events, "assistant").length >= 2);
    await adapter.stop(handle!, ctx);
  });

  it("BUG-0060: a dormant session can be stopped, and a failed wake says so instead of hanging", async () => {
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      nativeSessionId: "acp_alt_1234",
      adoptWorker: async () => null,
      spawnWorker: async () => {
        throw new Error("kein Agent");
      },
    } as Partial<AdapterContext>);
    const adapter = createAdapter({ command: ["/nonexistent"], label: "fake" });
    const handle = await adapter.recover!("dormant-fail", 1, ctx);
    const failed = await adapter.steer(handle!, { kind: "prompt", text: "los" }, ctx);
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain("Agent konnte nicht gestartet werden");
    await adapter.stop(handle!, ctx); // no error
    expect((await adapter.status(handle!)).state).toBe("down");
  });

  it("a stopped run continues in its loaded conversation — args.resumeSessionId, silent replay (BUG-0036)", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    // the native id an earlier run left behind; the stand-in replays the
    // old conversation on session/load — none of it may reach the stream
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Weiter im Kontext", args: { resumeSessionId: "acp_alt_1234" } }, ctx);
    await waitFor(() => turns.includes("idle"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session");
    expect((native?.payload as { nativeSessionId?: string }).nativeSessionId).toBe("acp_alt_1234");
    expect(ctx.events.filter((e) => e.type === "tool_use")).toEqual([]);
    // the loaded conversation's replay must stay out; the turn's own
    // thinking ("Ich überlege kurz.") is welcome
    expect(texts(ctx.events, "thinking").join("")).not.toContain("replayed");
    expect(texts(ctx.events, "assistant")).toEqual(["Antwort auf: Weiter im Kontext · ACP"]);
    await adapter.stop(handle, ctx);
  });

  it("BUG-0126: a native id the agent no longer knows degrades to a fresh context instead of bricking the session", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    // maki live 2026-11-11: the store lost the session — session/load
    // answers “Resource not found: not found: <id>”. Without the fix this
    // start() rejected with exactly that error (session.start_failed loop).
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Weiter im Kontext", args: { resumeSessionId: "acp_lost_9876" } }, ctx);
    await waitFor(() => turns.includes("idle"));
    const lost = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.context_lost");
    expect(lost?.payload).toMatchObject({ kind: "acp.context_lost", lostSessionId: "acp_lost_9876" });
    expect(lost?.summary).toContain("nicht mehr vorhanden");
    // the fresh binding is announced — the hub record follows the new id
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session");
    expect((native?.payload as { nativeSessionId?: string }).nativeSessionId).not.toBe("acp_lost_9876");
    // the prompt ran in the fresh context — visible answer, no replay
    expect(texts(ctx.events, "assistant")).toEqual(["Antwort auf: Weiter im Kontext · ACP"]);
    expect(texts(ctx.events, "thinking").join("")).not.toContain("replayed");
    await adapter.stop(handle, ctx);
  });

  it("BUG-0126: waking a dormant session whose native id is gone also degrades — first prompt answers", async () => {
    const runner = new ProcessRunner();
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      nativeSessionId: "acp_lost_dormant",
      adoptWorker: async () => null,
      spawnWorker: (cmd, o) => runner.spawn({ name: "acp-lost", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
      turn: () => {},
    } as Partial<AdapterContext>);
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.recover!("dormant-lost", 1, ctx);
    expect(await adapter.steer(handle!, { kind: "prompt", text: "einmal wach werden" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 1);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "acp.context_lost")).toBe(true);
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session");
    expect((native?.payload as { nativeSessionId?: string }).nativeSessionId).not.toBe("acp_lost_dormant");
    await adapter.stop(handle!, ctx);
  });

  it("BUG-0039: an adoption (importHistory) plays the loaded history into the tail — the hub never had it", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    // adopting an observed session: same resumeSessionId as a reopen, plus
    // the manager's importHistory flag — the load replay is the only source
    // of history, so it must reach the stream.
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), args: { resumeSessionId: "acp_alt_1234", importHistory: true } }, ctx);
    await waitFor(() => texts(ctx.events, "assistant").length >= 1);
    expect(texts(ctx.events, "thinking").join("")).toContain("replayed");
    expect(texts(ctx.events, "assistant").join("")).toContain("Replay der alten Antwort");
    expect(ctx.events.some((e) => e.type === "tool_use")).toBe(true);
    // no prompt went along — nothing is running, the session sits between turns
    expect(turns).toEqual([]);
    await adapter.stop(handle, ctx);
  });

  it("ADR-0041: eine geladene Session bekommt das konfigurierte Modell (maki lief sonst auf einem gesperrten letzten Modell)", async () => {
    const ctx = context({ turns: [] });
    const adapter = createAdapter({ command: [agent], label: "fake", model: "lokal/klein" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), args: { resumeSessionId: "acp_alt_1234", importHistory: true } }, ctx);
    const model = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model");
    expect(model?.payload).toMatchObject({ model: "lokal/klein", value: '["lokal","klein"]' });
    await adapter.stop(handle, ctx);
  });

  it("ADR-0041: ein beim Laden nicht angebotenes Modell sagt es und lässt die Session am Leben", async () => {
    const ctx = context({ turns: [] });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), model: "gibts/nicht", args: { resumeSessionId: "acp_alt_1234" } }, ctx);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "acp.model_unavailable")).toBe(true);
    await adapter.stop(handle, ctx);
  });

  it("ADR-0061: maki und omp wechseln das Modell in der laufenden Session — der nächste Zug läuft darauf", async () => {
    for (const preset of ["maki", "omp"] as const) {
      expect(createAdapter({ preset }).capabilities().features).toMatchObject({ modelChoice: "start", modelSwitch: true });
    }
    expect(createAdapter({ preset: "copilot" }).capabilities().features).toMatchObject({ modelChoice: "none", modelSwitch: false });

    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "eins" }, ctx);
    await waitFor(() => turns.filter((t) => t === "idle").length >= 1);
    expect(await adapter.steer(handle, { kind: "configure", model: "lokal/klein" }, ctx)).toEqual({ ok: true });
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload).toMatchObject({ model: "lokal/klein", value: '["lokal","klein"]' });
    await adapter.steer(handle, { kind: "prompt", text: "zwei" }, ctx);
    await waitFor(() => turns.filter((t) => t === "idle").length >= 2);
    expect(texts(ctx.events, "assistant")[1]).toContain('Modell ["lokal","klein"]');
    await adapter.stop(handle, ctx);
  });

  it("ADR-0061: ein nicht angebotenes Modell beim Wechsel wird abgelehnt — sichtbar, die Session bleibt auf ihrem", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "eins" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const ack = await adapter.steer(handle, { kind: "configure", model: "gibts/nicht" }, ctx);
    expect(ack.ok).toBe(false);
    expect(ack.detail).toContain("gibts/nicht");
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "acp.model_unavailable")).toBe(true);
    expect((await adapter.steer(handle, { kind: "configure", permissionMode: "auto" }, ctx)).ok).toBe(false);
    await adapter.stop(handle, ctx);
  });

  it("ADR-0061: der Wechsel mitten im Zug wird abgelehnt statt still verschluckt", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "LANGSAM eins" }, ctx);
    const ack = await adapter.steer(handle, { kind: "configure", model: "lokal/klein" }, ctx);
    expect(ack.ok).toBe(false);
    expect(ack.detail).toMatch(/Zug/);
    await adapter.stop(handle, ctx);
  });

  it("ADR-0061: eine geweckte Session läuft auf dem Modell der Session (ctx.model), nicht auf dem Config-Default", async () => {
    const runner = new ProcessRunner();
    const ctx = makeRecordingContext({
      workdir: process.cwd(),
      nativeSessionId: "acp_alt_1234",
      model: "lokal/klein",
      adoptWorker: async () => null,
      spawnWorker: (cmd, o) => runner.spawn({ name: "acp-wake-model", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
      turn: () => {},
    } as Partial<AdapterContext>);
    // Config-Default ist ein anderes Modell — das der Session gewinnt.
    const adapter = createAdapter({ command: [agent], label: "fake", model: "cloud/gross" });
    const handle = await adapter.recover!("wake-model", 1, ctx);
    await adapter.steer(handle!, { kind: "prompt", text: "nach dem Neustart" }, ctx);
    await waitFor(() => texts(ctx.events, "assistant").length >= 1);
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.model")?.payload).toMatchObject({ model: "lokal/klein" });
    await adapter.stop(handle!, ctx);
  });

  it("a failed prompt becomes a readable provider error (ADR-0015)", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "FEHLER" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const error = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "provider.error");
    expect(error?.payload).toMatchObject({ provider: "fake", category: "rate_limit" });
  });

  it("a plan shows up in the todo shape the run strip reads", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent] }).start({ adapter: "acp", project: process.cwd(), prompt: "PLAN" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const plan = ctx.events.find((e) => (e.payload as { name?: string }).name === "todowrite");
    expect((plan?.payload as { input: { todos: unknown[] } }).input.todos).toHaveLength(3);
  });
});

describe("ACP JSON-RPC and update mapping", () => {
  it("answers the agent's requests, ignores log noise, reports stray results", async () => {
    const written: string[] = [];
    const stray: unknown[] = [];
    const noise: string[] = [];
    const conn = new AcpConnection((l) => written.push(l), {
      onNotification: () => undefined,
      onRequest: async (method) => ({ echoed: method }),
      onStrayResult: (r) => stray.push(r),
      onNoise: (l) => noise.push(l),
    });
    conn.feed('{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{}}\r\nnpm warn something\n{"jsonrpc":"2.0","id":99,"result":{"stopReason":"end_turn"}}\n');
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(written[0]!)).toEqual({ jsonrpc: "2.0", id: 7, result: { echoed: "session/request_permission" } });
    expect(noise).toEqual(["npm warn something"]);
    expect(stray).toEqual([{ stopReason: "end_turn" }]);
  });

  it("a completed call that ends in a non-zero exit code is an error (dsh)", () => {
    const mapper = new UpdateMapper("x");
    const text = (t: string) => [{ type: "content" as const, content: { type: "text" as const, text: t } }];
    const [failed] = mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed", content: text("[stderr]\ncat: x: No such file\n[exit code: 1]") });
    const [ok] = mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "b", status: "completed", content: text("fine\n[exit code: 0]") });
    expect(failed?.payload).toMatchObject({ isError: true });
    expect(ok?.payload).toMatchObject({ isError: false });
  });

  it("an unknown update kind is reported once, not dropped", () => {
    const mapper = new UpdateMapper("x");
    expect(mapper.map({ sessionUpdate: "hologram" })).toHaveLength(1);
    expect(mapper.map({ sessionUpdate: "hologram" })).toHaveLength(0);
  });
});

describe("acp attachments (T7.10)", () => {
  it("an image becomes an image block when the agent takes images", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "acp-att-"));
    writeFileSync(join(dir, "img"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await createAdapter({ command: [agent] }).start(
      { adapter: "acp", project: process.cwd(), prompt: "Schau", attachments: [{ id: "c".repeat(64), name: "bild.png", mimeType: "image/png", kind: "image", bytes: 4, path: join(dir, "img"), text: null, method: null }] },
      ctx,
    );
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant")[0]).toContain("[image]");
    expect(texts(ctx.events, "assistant")[0]).toContain("(als Datei übergeben)");
  });
  it("dsh preset: models() lists every provider/model over ACP instead of the removed `--profile models`", async () => {
    // `command` replaces dsh's command line, the preset still selects the ACP catalog path.
    const adapter = createAdapter({ preset: "dsh", command: [agent] });
    const models = await adapter.models!();
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(["cloud/gross", "lokal/glm-5.3"]));
  });
  it("maki preset: `maki models` prints nothing, so models() asks the ACP session for the catalog", async () => {
    const adapter = createAdapter({ preset: "maki", command: [agent] });
    const models = await adapter.models!();
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(["cloud/gross", "lokal/glm-5.3"]));
  });
  it("BUG-0059: dsh does not claim image input (it reads attachments as OCR text), other presets keep it", () => {
    expect(createAdapter({ preset: "dsh" }).capabilities().features.images).toBe(false);
    expect(createAdapter({ preset: "dsh" }).capabilities().features.files).toBe(true);
    expect(createAdapter({ preset: "opencode" }).capabilities().features.images).toBe(true);
  });
});

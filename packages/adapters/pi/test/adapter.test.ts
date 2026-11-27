import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * 2026-10-26: same testkit gap as hermes — runContractTests() cannot
 * simulate spawnWorker, so these lifecycle tests use makeRecordingContext
 * and capture the argv the adapter really builds. The live contract is in
 * src/index.ts's doc comment (gpubox + agent-host, 2026-10-25): model choice
 * via `--model provider/id`, headless without a tty.
 */

function fakeProcess(): WorkerProcess {
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(() => {
    for (const cb of exitCbs) cb(0);
  }, 0);
  return {
    onStdout: () => undefined,
    onStderr: () => undefined,
    onExit: (cb) => exitCbs.add(cb),
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise((resolve) => exitCbs.add((code) => resolve({ code }))),
  };
}

function recording() {
  const spawned: string[][] = [];
  const ctx = makeRecordingContext({
    spawnWorker: async (cmd) => {
      spawned.push(cmd);
      return fakeProcess();
    },
  });
  return { ctx, spawned };
}

const GPUBOX = "gpubox/halogen-qwen3.8-flash-next-uncensored-iq4xs";

describe("pi adapter model handling", () => {
  it("startet mit dem konfigurierten Default-Modell und meldet es als Event", async () => {
    const adapter = createAdapter({ model: GPUBOX });
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "hallo" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).toContain(`--model ${GPUBOX}`);
    const modelEvent = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "pi.model");
    expect(modelEvent?.payload).toMatchObject({ kind: "pi.model", model: GPUBOX });
  });

  it("das Modell der Session gewinnt über den Default", async () => {
    const adapter = createAdapter({ model: GPUBOX });
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x", model: "other/mini" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).toContain("--model other/mini");
    expect(spawned[0]!.join(" ")).not.toContain(GPUBOX);
  });

  it("ohne Modell: kein --model und kein Model-Event (ehrlich, nicht geraten)", async () => {
    const adapter = createAdapter({});
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).not.toContain("--model");
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.model")).toBe(false);
  });

  it("steer nutzt dasselbe effektive Modell weiter", async () => {
    const adapter = createAdapter({ model: GPUBOX });
    const { ctx, spawned } = recording();
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "a" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    const ack = await adapter.steer(handle, { kind: "prompt", text: "b" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawned[1]!.join(" ")).toContain(`--model ${GPUBOX}`);
    expect(spawned[1]!.join(" ")).toContain("--continue");
  });
});

describe("pi adapter env/envFiles — GLM ohne /login wählbar (Nutzerwunsch 27.11.2026)", () => {
  /** Fake-pi: listet zai-Modelle nur, wenn die Env den Schlüssel bringt — genau wie das
   * echte `pi --list-models` Provider ohne nutzbare Anmeldung versteckt. */
  function piMitEnvSchluessel(): { bin: string; keyFile: string } {
    const dir = mkdtempSync(join(tmpdir(), "ancientvoid-pi-env-"));
    const keyFile = join(dir, "zai.key");
    writeFileSync(keyFile, "test-key");
    const bin = join(dir, "pi");
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        'if [ "$ZAI_API_KEY" = "test-key" ]; then',
        '  printf "provider  model  context  max-out  thinking  images\\nzai  glm-5.3  1M  131.1K  yes  no\\n"',
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    return { bin, keyFile };
  }

  it("models(): der envFiles-Schlüssel erreicht das Listing — zai/glm-5.3 erscheint", async () => {
    const { bin, keyFile } = piMitEnvSchluessel();
    const adapter = createAdapter({ command: bin, envFiles: { ZAI_API_KEY: keyFile } });
    const models = await adapter.models!();
    expect(models.map((m) => m.id)).toContain("zai/glm-5.3");
  });

  it("models() ohne Env bleibt ehrlich leer — kein Erraten von Providern", async () => {
    const { bin } = piMitEnvSchluessel();
    const adapter = createAdapter({ command: bin });
    const models = await adapter.models!();
    expect(models).toEqual([]);
  });

  it("start(): Config-Env erreicht jeden pi-Prozess", async () => {
    const spawns: { env?: Record<string, string> }[] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (_cmd, opts?: { env?: Record<string, string> }) => {
        spawns.push(opts?.env ? { env: opts.env } : {});
        return fakeProcess();
      },
    });
    const adapter = createAdapter({ env: { ZAI_API_KEY: "config-key" } });
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    expect(spawns[0]!.env).toMatchObject({ ZAI_API_KEY: "config-key" });
  });

  it("start(): die Env des Session-Starts gewinnt über die Config-Env (wie ACP)", async () => {
    const spawns: { env?: Record<string, string> }[] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (_cmd, opts?: { env?: Record<string, string> }) => {
        spawns.push(opts?.env ? { env: opts.env } : {});
        return fakeProcess();
      },
    });
    const adapter = createAdapter({ env: { ZAI_API_KEY: "config-key" } });
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "y", env: { ZAI_API_KEY: "session-key" } }, ctx);
    expect(spawns[0]!.env).toMatchObject({ ZAI_API_KEY: "session-key" });
  });
});

describe("pi adapter prompt argv (BUG-0066)", () => {
  // Run the built command line through a real `sh`, with the pi binary
  // replaced by a script that prints its argv — so the test sees exactly
  // what pi would receive, quoting included.
  function argvPi(): string {
    const dir = mkdtempSync(join(tmpdir(), "ancientvoid-pi-argv-"));
    const bin = join(dir, "pi");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"\n`);
    chmodSync(bin, 0o755);
    return bin;
  }

  function received(cmd: string[]): string[] {
    return JSON.parse(execFileSync(cmd[0]!, cmd.slice(1), { encoding: "utf8" })) as string[];
  }

  const prompts = ["hallo", 'Sag "OK" und dann \'tschüss\'', "-v ist keine Option", "$HOME `id` ; echo x"];

  it.each(prompts)("pi bekommt den Prompt unverändert als einzige Nachricht: %s", async (prompt) => {
    const adapter = createAdapter({ command: argvPi(), model: GPUBOX });
    const { ctx, spawned } = recording();
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt }, ctx);
    await adapter.steer(handle, { kind: "prompt", text: prompt }, ctx);
    for (const cmd of spawned) {
      const argv = received(cmd);
      expect(argv).not.toContain("exec");
      // Everything after `--` is a message; exactly one, verbatim.
      expect(argv.slice(argv.indexOf("--") + 1)).toEqual([prompt]);
    }
  });
});

describe("pi adapter health (BUG-0076)", () => {
  function fakeExitProcess(code: number): WorkerProcess {
    const exitCbs = new Set<(code: number | null) => void>();
    setTimeout(() => {
      for (const cb of exitCbs) cb(code);
    }, 0);
    return {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onExit: (cb) => exitCbs.add(cb),
      write: () => undefined,
      kill: async () => undefined,
      exited: () => new Promise((resolve) => exitCbs.add((c) => resolve({ code: c }))),
    };
  }

  it("ein fehlerfreier Turn nach einem gescheiterten ist wieder healthy — kein Error-Altbestand", async () => {
    const adapter = createAdapter({});
    const codes = [3, 0];
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeExitProcess(codes.shift() ?? 0) });
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "geht schief" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    // Der erste Turn endete abnorm (Exit 3) — down ist hier korrekt.
    expect((await adapter.status(handle)).state).toBe("down");

    const ack = await adapter.steer(handle, { kind: "prompt", text: "nochmal" }, ctx);
    expect(ack.ok).toBe(true);
    await waitFor(() => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === "pi.turn_end").length >= 2);
    // BUG-0076: der neue Prozess lief fehlerfrei (Exit 0) — status() muss
    // healthy melden, sonst setzt der Hub-Heartbeat die Session erneut auf error.
    expect((await adapter.status(handle)).state).toBe("healthy");
  });
});

describe("pi adapter streams the json run (BUG-0065)", () => {
  it("Thinking und Tool-Aufruf kommen ins Event-Log, während pi noch läuft", async () => {
    let out: (chunk: string) => void = () => undefined;
    const exitCbs = new Set<(code: number | null) => void>();
    const proc: WorkerProcess = {
      onStdout: (cb) => {
        out = cb;
      },
      onStderr: () => undefined,
      onExit: (cb) => exitCbs.add(cb),
      write: () => undefined,
      kill: async () => undefined,
      exited: () => new Promise(() => undefined),
    };
    const ctx = makeRecordingContext({ spawnWorker: async () => proc });
    const adapter = createAdapter({});
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    out(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "erst lesen" } }) + "\n");
    out(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } } } }) + "\n");
    expect(ctx.events.map((e) => e.type)).toEqual(expect.arrayContaining(["thinking", "tool_use"]));
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end")).toBe(false);
    for (const cb of exitCbs) cb(0);
    expect(ctx.events.at(-1)?.payload).toMatchObject({ kind: "pi.turn_end" });
  });

  it("pi läuft im JSON-Modus", async () => {
    const adapter = createAdapter({});
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    expect(spawned[0]!.join(" ")).toContain("-p --mode json");
  });

  it("ein Absturz mit Grund auf stderr wird sichtbar", async () => {
    let err: (chunk: string) => void = () => undefined;
    const exitCbs = new Set<(code: number | null) => void>();
    const proc: WorkerProcess = {
      onStdout: () => undefined,
      onStderr: (cb) => {
        err = cb;
      },
      onExit: (cb) => exitCbs.add(cb),
      write: () => undefined,
      kill: async () => undefined,
      exited: () => new Promise(() => undefined),
    };
    const ctx = makeRecordingContext({ spawnWorker: async () => proc });
    await createAdapter({}).start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    err("Error: No API key found for provider gpubox\n");
    for (const cb of exitCbs) cb(1);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "provider.error")).toBe(true);
  });
});

describe("pi context window (ADR-0032)", () => {
  it("die konfigurierte Fenstergröße steht in den Capabilities und in der Modell-Ansage", async () => {
    const adapter = createAdapter({ model: GPUBOX, contextWindowTokens: 131072 });
    expect(adapter.capabilities().contextWindowTokens).toBe(131072);
    const { ctx } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    expect(ctx.events.find((e) => e.payload.kind === "pi.model")?.payload).toMatchObject({ model: GPUBOX, contextWindowTokens: 131072 });
  });

  it("ohne Konfiguration bleibt die Größe unbekannt", () => {
    expect(createAdapter({}).capabilities().contextWindowTokens).toBeUndefined();
  });

  it("EPIC-P35 T35.7/ADR-0054: contextWindows-Map schlägt Einzelwert und Tabelle; Tabelle füllt Lücken", async () => {
    const { ctx } = recording();
    await createAdapter({ model: GPUBOX, contextWindowTokens: 131072, contextWindows: { "flash-next": 65_536 } }).start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    expect(ctx.events.find((e) => e.payload.kind === "pi.model")?.payload).toMatchObject({ contextWindowTokens: 65_536 });
    // Ohne jede Konfiguration greift die kuratierte Tabelle (glm-5.3 → 1 M; das gpubox-Quant kennt sie mit 131072).
    const { ctx: ctx2 } = recording();
    await createAdapter({ model: "zai/glm-5.3" }).start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx2);
    expect(ctx2.events.find((e) => e.payload.kind === "pi.model")?.payload).toMatchObject({ contextWindowTokens: 1_000_000 });
    const { ctx: ctx3 } = recording();
    await createAdapter({ model: GPUBOX }).start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx3);
    expect(ctx3.events.find((e) => e.payload.kind === "pi.model")?.payload).toMatchObject({ contextWindowTokens: 131_072 });
  });
});

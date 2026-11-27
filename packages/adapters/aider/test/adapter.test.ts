import { describe, it, expect } from "vitest";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

// Same testkit gap as adapter-claude/adapter-codex/adapter-opencode (see
// their test files' doc comments): runContractTests() can't exercise a real
// spawnWorker adapter. It also can't exercise this adapter at all, since its
// default SessionSpec (no `model`) is exactly the input this adapter is
// required to refuse (see doc comment point 3 in src/index.ts) — so this
// builds its own lifecycle test on makeRecordingContext instead.

function fakeAiderProcess(stdout: string, exitCode: number | null = 0): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (const cb of stdoutCbs) cb(stdout);
    await new Promise((r) => setTimeout(r, 0));
    for (const cb of exitCbs) cb(exitCode);
  }, 0);
  return {
    onStdout: (cb) => stdoutCbs.add(cb),
    onStderr: () => undefined,
    onExit: (cb) => exitCbs.add(cb),
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise((resolve) => exitCbs.add((code) => resolve({ code }))),
  };
}

describe("aider adapter — lifecycle against a synthetic (unverified-happy-path) stream", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("aider");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toMatchObject({
      reasoning: false,
      tools: true,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
    });
    // follow-up prompts are not wired (steer(prompt) refuses) — say so.
    expect(adapter.capabilities().features).toMatchObject({ followUp: false, interrupt: true, toolGate: "bypass" });
  });

  it("start() refuses to spawn without spec.model — real no-model behavior is a 5-minute OAuth hang, never risked here", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => {
        throw new Error("must not spawn without a model");
      },
    });
    const adapter = createAdapter();
    await expect(adapter.start({ adapter: "aider", project: "/tmp", prompt: "say ok" }, ctx)).rejects.toThrow(
      /requires SessionSpec.model/,
    );
    const refused = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "aider.missing_model");
    expect(refused).toBeDefined();
  });

  it("start() with a model spawns `aider --message <prompt> --model <model> --yes-always --no-pretty --no-stream`", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeAiderProcess("Hello! a.txt contains the word hello.\n");
      },
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "aider", project: "/tmp", prompt: "say ok", model: "anthropic/claude-sonnet-5" },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--message");
    expect(spawnedCmds[0]).toContain("say ok");
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("anthropic/claude-sonnet-5");
    expect(spawnedCmds[0]).toContain("--yes-always");
    expect(spawnedCmds[0]).toContain("--no-pretty");
    expect(spawnedCmds[0]).toContain("--no-stream");
  });

  it("the whole stdout blob becomes a single assistant event — no fabricated fine-grained parsing", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeAiderProcess("line one\nline two\nline three\n"),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "aider", project: "/tmp", prompt: "go", model: "m" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const assistantEvents = ctx.events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect((assistantEvents[0]!.payload as { text?: string }).text).toBe("line one\nline two\nline three");
  });

  it("steer(prompt) is honestly unwired — unverified whether aider's own history file carries context across invocations", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeAiderProcess("ok\n"),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "aider", project: "/tmp", prompt: "go", model: "m" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const ack = await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("a non-zero exit sets status down; a clean exit does not", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeAiderProcess("ok\n", 0),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "aider", project: "/tmp", prompt: "go", model: "m" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect((await adapter.status(handle)).state).toBe("healthy");

    const ctx2 = makeRecordingContext({
      spawnWorker: async () => fakeAiderProcess("", 1),
    });
    const handle2 = await adapter.start({ adapter: "aider", project: "/tmp", prompt: "go", model: "m" }, ctx2);
    let downState = false;
    for (let i = 0; i < 40 && !downState; i++) {
      downState = (await adapter.status(handle2)).state === "down";
      if (!downState) await new Promise((r) => setTimeout(r, 25));
    }
    expect(downState).toBe(true);
  });

  it("Adapter-Standard: cfg.model ersetzt spec.model, apiBase/apiKeyFile landen als OPENAI_*-Env (Key nie in argv)", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const keyFile = join(mkdtempSync(join(tmpdir(), "aider-key-")), "k");
    writeFileSync(keyFile, "sekret\n");
    let seen: { cmd: string[]; env?: Record<string, string> | undefined } | undefined;
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd, opts) => {
        seen = { cmd, env: opts?.env };
        return fakeAiderProcess("ok");
      },
    });
    const adapter = createAdapter({ model: "openai/glm-5.3", apiBase: "https://api.z.ai/api/coding/paas/v4", apiKeyFile: keyFile });
    await adapter.start({ adapter: "aider", project: "/tmp", prompt: "say ok" }, ctx);
    expect(seen!.cmd).toContain("openai/glm-5.3");
    expect(seen!.cmd.join(" ")).not.toContain("sekret");
    expect(seen!.env).toMatchObject({ OPENAI_API_BASE: "https://api.z.ai/api/coding/paas/v4", OPENAI_API_KEY: "sekret" });
  });

  it("Nutzerwunsch 27.11.2026: env/envFiles (litellm-Provider-Keys) laufen in jedem aider-Lauf mit", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const keyFile = join(mkdtempSync(join(tmpdir(), "aider-env-")), "anthropic");
    writeFileSync(keyFile, "file-key\n");
    let seen: Record<string, string> | undefined;
    const ctx = makeRecordingContext({
      spawnWorker: async (_cmd, opts) => {
        seen = opts?.env;
        return fakeAiderProcess("ok");
      },
    });
    const adapter = createAdapter({ env: { ZAI_API_KEY: "direct-key" }, envFiles: { ANTHROPIC_API_KEY: keyFile } });
    await adapter.start({ adapter: "aider", project: "/tmp", prompt: "say ok", model: "zai/glm-5.3" }, ctx);
    expect(seen).toMatchObject({ ZAI_API_KEY: "direct-key", ANTHROPIC_API_KEY: "file-key" });
  });
});

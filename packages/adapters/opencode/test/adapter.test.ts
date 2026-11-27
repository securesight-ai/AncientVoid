import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter, parseModelList } from "../src/index.ts";

// Same testkit gap as adapter-claude/adapter-codex (see their test files'
// doc comments): runContractTests() can't exercise a real spawnWorker
// adapter, so this builds its own lifecycle test on makeRecordingContext.

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

function fakeOpencodeProcess(content: string, exitCode: number | null = 0): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (const cb of stdoutCbs) cb(content);
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

describe("opencode adapter — lifecycle against a real captured stream", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("opencode");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toMatchObject({
      reasoning: true,
      tools: true,
      cost: true,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, toolGate: "allowlist", agents: true });
    expect(createAdapter({ extraArgs: ["--auto"] }).capabilities().features.toolGate).toBe("bypass");
  });

  it("start() spawns `opencode run <prompt> --format json` and emits schema-valid events", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "read a.txt" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("run");
    expect(spawnedCmds[0]).toContain("read a.txt");
    expect(spawnedCmds[0]).toContain("--format");
    expect(spawnedCmds[0]).toContain("json");
  });

  it("passes the configured model and announces it before the process answers", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter({ model: "zai-coding-plan/glm-5.3" });
    await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "read a.txt" }, ctx);
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("zai-coding-plan/glm-5.3");
    expect(ctx.events.some((event) => event.summary === "OpenCode · zai-coding-plan/glm-5.3")).toBe(true);
  });

  it("steer(prompt) continues via --session <id> captured from the real sessionID field", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "read a.txt" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));

    await adapter.steer(handle, { kind: "prompt", text: "now read b.txt" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).toContain("--session");
    expect(spawnedCmds[1]).toContain("ses_f4e417746ffeHpklpqLT8XojKI");
  });

  it("T3.12: spec.model appends --model on the initial spawn only, never on --session continuation", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "go", model: "zai-coding-plan/glm-5.3" },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("zai-coding-plan/glm-5.3");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).not.toContain("--model");
  });

  it("args.agent appends --agent on the initial spawn; args.skill is visibly ignored, not silently dropped", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess(loadFixture("trivial-read.jsonl")),
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "go", args: { agent: "build", skill: "bugfix" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const ignored = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "opencode.skill_ignored");
    expect(ignored).toBeDefined();
    expect((ignored!.payload as { requested?: string }).requested).toBe("bugfix");
  });

  it("a hub-resolved skillChain is not reported as ignored", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        expect(cmd).toContain("go");
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "go", args: { skill: "neon", skillChain: ["task", "neon"] } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "opencode.skill_ignored")).toBe(false);
  });

  it("resumeSessionId continues the same OpenCode session", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "weiter", args: { resumeSessionId: "ses_abc" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--session");
    expect(spawnedCmds[0]).toContain("ses_abc");
    expect(ctx.events.some((e) => (e.payload as { nativeSessionId?: string }).nativeSessionId === "ses_f4e417746ffeHpklpqLT8XojKI")).toBe(
      true,
    );
  });

  it("EPIC-P35 T35.3: start mit resumeSessionId ohne Prompt bleibt idle — kein leerer Prompt, der nächste Prompt setzt fort (hub-Resume)", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    expect(adapter.capabilities().resume).toMatchObject({ ref: "native", hub: true });

    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", args: { resumeSessionId: "ses_idle" } }, ctx);
    expect(spawnedCmds).toHaveLength(0);
    expect((await adapter.status(handle)).state).toBe("healthy");

    await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--session");
    expect(spawnedCmds[0]).toContain("ses_idle");
  });

  it("a non-zero exit sets status down; a clean one-shot exit does not", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess(loadFixture("trivial-read.jsonl"), 0),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect((await adapter.status(handle)).state).toBe("healthy");

    const ctx2 = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess("", 1),
    });
    const handle2 = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "go" }, ctx2);
    let downState = false;
    for (let i = 0; i < 40 && !downState; i++) {
      downState = (await adapter.status(handle2)).state === "down";
      if (!downState) await new Promise((r) => setTimeout(r, 25));
    }
    expect(downState).toBe(true);
  });

  it("ADR-0014: recover() adopts the turn that survived the hub restart", async () => {
    const adapter = createAdapter();
    const ctx = makeRecordingContext({
      adoptWorker: async () => fakeOpencodeProcess(loadFixture("trivial-read.jsonl")),
      nativeSessionId: "ses_before",
    });
    const handle = await adapter.recover!("s1", 0, ctx);
    expect(handle?.sessionId).toBe("s1");
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(ctx.spawned).toEqual([]);
  });

  it("ADR-0014: recover() without a worker resumes with --session on the next prompt", async () => {
    const adapter = createAdapter();
    const spawned: string[][] = [];
    const ctx = makeRecordingContext({
      adoptWorker: async () => null,
      nativeSessionId: "ses_before",
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return fakeOpencodeProcess("");
      },
    });
    const handle = await adapter.recover!("s1", 0, ctx);
    expect((await adapter.steer(handle!, { kind: "prompt", text: "weiter" }, ctx)).ok).toBe(true);
    expect(spawned[0]).toEqual(expect.arrayContaining(["--session", "ses_before"]));
  });
});

describe("opencode model catalog (ADR-0018)", () => {
  it("reads provider/model lines and skips everything else", () => {
    expect(parseModelList("opencode/big-pickle\nzai-coding-plan/glm-5.3\n\nWarning: something\n")).toEqual([
      { id: "opencode/big-pickle" },
      { id: "zai-coding-plan/glm-5.3" },
    ]);
  });
});


describe("opencode env/envFiles — Provider-Keys erreichen Katalog und Züge (Nutzerwunsch 27.11.2026)", () => {
  it("models(): das Listing läuft mit der Env; ohne Key bleibt es ehrlich leer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-env-"));
    const keyFile = join(dir, "zai.key");
    writeFileSync(keyFile, "test-key\n");
    const bin = join(dir, "opencode");
    writeFileSync(bin, ["#!/bin/sh", 'if [ "$ZAI_API_KEY" = "test-key" ]; then echo "zai/glm-5.3"; fi', ""].join("\n"));
    chmodSync(bin, 0o755);
    const mit = createAdapter({ command: bin, envFiles: { ZAI_API_KEY: keyFile } });
    expect(((await mit.models?.()) ?? []).map((m) => m.id)).toEqual(["zai/glm-5.3"]);
    const ohne = createAdapter({ command: bin });
    expect((((await ohne.models?.()) ?? []).map((m) => m.id))).toEqual([]);
  });

  it("start() und steer() reichen die Env an jeden opencode-Prozess durch", async () => {
    const spawns: ({ env?: Record<string, string> })[] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (_cmd, opts?: { env?: Record<string, string> }) => {
        spawns.push(opts?.env ? { env: opts.env } : {});
        return fakeOpencodeProcess("");
      },
    });
    const adapter = createAdapter({ env: { ZAI_API_KEY: "config-key" } });
    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "x" }, ctx);
    expect(spawns[0]?.env).toMatchObject({ ZAI_API_KEY: "config-key" });
    await adapter.steer(handle, { kind: "prompt", text: "y" }, ctx);
    expect(spawns[1]?.env).toMatchObject({ ZAI_API_KEY: "config-key" });
  });

  it("start(): die Env des Session-Starts gewinnt über die Config-Env (wie ACP/pi)", async () => {
    const spawns: ({ env?: Record<string, string> })[] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (_cmd, opts?: { env?: Record<string, string> }) => {
        spawns.push(opts?.env ? { env: opts.env } : {});
        return fakeOpencodeProcess("");
      },
    });
    const adapter = createAdapter({ env: { ZAI_API_KEY: "config-key" } });
    await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "x", env: { ZAI_API_KEY: "session-key" } }, ctx);
    expect(spawns[0]?.env).toMatchObject({ ZAI_API_KEY: "session-key" });
  });
});

describe("opencode attachments (T7.10)", () => {
  it("images and PDFs as -f files, text files in the prompt", async () => {
    const calls: string[][] = [];
    const { makeRecordingContext } = await import("@ancientvoid/adapter-testkit");
    const ctx = makeRecordingContext({ spawnWorker: async (cmd) => { calls.push(cmd); throw new Error("stop here"); } });
    await createAdapter().start({
      adapter: "opencode",
      project: "/tmp",
      prompt: "Lies",
      attachments: [
        { id: "a".repeat(64), name: "foto.jpg", mimeType: "image/jpeg", kind: "image", bytes: 1000, path: "/data/att/aaa", text: null, method: null },
        { id: "b".repeat(64), name: "notiz.md", mimeType: "text/markdown", kind: "text", bytes: 10, path: "/data/att/bbb", text: "# Hallo", method: "text" },
      ],
    }, ctx).catch(() => undefined);
    const cmd = calls[0]!;
    expect(cmd.slice(cmd.indexOf("-f"), cmd.indexOf("-f") + 2)).toEqual(["-f", "/data/att/aaa"]);
    expect(cmd.filter((a) => a === "-f")).toHaveLength(1);
    expect(cmd[2]).toContain("# Hallo");
  });
});

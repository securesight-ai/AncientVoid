import { describe, expect, it } from "vitest";
import {
  cleanLocalAnswer,
  enhancePrompt,
  localModelState,
  RewriteFailed,
  type EnhanceFlavor,
  type LocalRewriteModel,
  type OneShotRunner,
} from "../../../src/modules/prompts/enhance.ts";

/** Fake llama.cpp: `/slots` and `/chat/completions` answered per test. */
function fakeServer(opts: {
  slots?: number | unknown[] | "throw";
  chat?: number | string | "throw" | "hang";
}): { fetch: typeof fetch; calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/slots")) {
      if (opts.slots === "throw") throw new TypeError("fetch failed");
      if (typeof opts.slots === "number") return new Response("", { status: opts.slots });
      return Response.json(opts.slots ?? [{ id: 0, is_processing: false }]);
    }
    bodies.push(JSON.parse(String(init?.body)));
    if (opts.chat === "throw") throw new TypeError("fetch failed");
    if (opts.chat === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (typeof opts.chat === "number") return new Response("busy", { status: opts.chat });
    return Response.json({ choices: [{ message: { content: opts.chat ?? "Ziel: lokal" } }] });
  }) as typeof fetch;
  return { fetch: fn, calls, bodies };
}

function local(server: { fetch: typeof fetch }, timeoutMs?: number): LocalRewriteModel {
  return { url: "http://127.0.0.1:9/v1", model: "qwen3-coder", fetch: server.fetch, ...(timeoutMs ? { timeoutMs } : {}) };
}

function recordingRunner(answer = "Ziel: vom Adapter"): { run: OneShotRunner; seen: { flavor: EnhanceFlavor; prompt: string }[] } {
  const seen: { flavor: EnhanceFlavor; prompt: string }[] = [];
  return {
    seen,
    run: async (flavor, prompt) => {
      seen.push({ flavor, prompt });
      return { enhanced: answer, costUsd: 0.01 };
    },
  };
}

describe("EPIC-P68 engine chain (ADR-0089)", () => {
  it("P90 uses a pinned Pi model before the automatic chain and explains a fallback", async () => {
    const seen: string[] = [];
    const server = fakeServer({});
    const result = await enhancePrompt("claude", "x", "/tmp", {
      local: local(server),
      preferred: { id: "my-pi", registration: { module: "@ancientvoid/adapter-pi" }, model: "local/qwen" },
      runOneShot: async (flavor, _prompt, _cwd, _registration, model) => {
        seen.push(`${flavor}/${model}`);
        throw new Error("offline");
      },
    });
    expect(seen).toEqual(["pi/local/qwen"]);
    expect(result.engine.kind).toBe("local");
    expect(result.skipped[0]).toMatchObject({ engine: "my-pi", reason: "offline" });
  });
  it("AC-P68-1: a free local model answers, no CLI one-shot runs, no cost is invented", async () => {
    const server = fakeServer({ chat: "<think>hmm</think>\nZiel: lokal" });
    const runner = recordingRunner();
    const result = await enhancePrompt("claude", "mach login schneller", "/tmp", {
      local: local(server),
      runOneShot: runner.run,
      context: "<<<PROJEKTKONTEXT\nProjekt: demo\nPROJEKTKONTEXT>>>",
    });
    expect(result.enhanced).toBe("Ziel: lokal");
    expect(result.engine).toEqual({ kind: "local", id: "local", model: "qwen3-coder" });
    expect(result.skipped).toEqual([]);
    expect(result.costUsd).toBeUndefined();
    expect(runner.seen).toEqual([]);
    const body = server.bodies[0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0]!.content).toContain("Projekt: demo");
    expect(body.messages[1]).toEqual({ role: "user", content: "mach login schneller" });
  });

  it("AC-P68-2: all slots busy → the selected adapter answers, the reason is reported", async () => {
    const server = fakeServer({ slots: [{ is_processing: true }, { is_processing: true }] });
    const runner = recordingRunner();
    const result = await enhancePrompt("claude", "mach login schneller", "/tmp", { local: local(server), runOneShot: runner.run });
    expect(result.engine).toEqual({ kind: "adapter", id: "claude" });
    expect(result.skipped).toEqual([{ engine: "Lokales Modell (qwen3-coder)", reason: "ausgelastet (alle Slots belegt)" }]);
    expect(result.costUsd).toBe(0.01);
    expect(runner.seen.map((s) => s.flavor)).toEqual(["claude"]);
    expect(server.calls.some((url) => url.endsWith("/chat/completions"))).toBe(false);
  });

  it.each([
    ["503 from the completion", { chat: 503 }, "ausgelastet (HTTP 503)"],
    ["unreachable server", { slots: "throw" as const }, "nicht erreichbar"],
    ["empty answer", { chat: "  " }, "leere Antwort"],
    ["timeout", { chat: "hang" as const }, "hat nicht rechtzeitig geantwortet"],
  ])("AC-P68-2: %s → adapter fallback with that reason", async (_label, opts, reason) => {
    const server = fakeServer(opts as Parameters<typeof fakeServer>[0]);
    const runner = recordingRunner();
    const result = await enhancePrompt("codex", "x", "/tmp", { local: local(server, 50), runOneShot: runner.run });
    expect(result.engine.id).toBe("codex");
    expect(result.skipped[0]!.reason).toBe(reason);
  });

  it("no local model configured → says so; an adapter without one-shot ends at opencode with both reasons", async () => {
    const runner = recordingRunner();
    const result = await enhancePrompt("aider", "x", "/tmp", { runOneShot: runner.run });
    expect(result.engine).toEqual({ kind: "adapter", id: "opencode" });
    expect(result.skipped).toEqual([
      { engine: "Lokales Modell", reason: "nicht konfiguriert" },
      { engine: "aider", reason: "kein eigener One-Shot" },
    ]);
    expect(runner.seen.map((s) => s.flavor)).toEqual(["opencode"]);
  });

  it("the CLI prompt carries the framed context and keeps the raw text last after ---", async () => {
    const runner = recordingRunner();
    await enhancePrompt("opencode", "mach das spiel neon", "/tmp", { runOneShot: runner.run, context: "<<<PROJEKTKONTEXT\nX\nPROJEKTKONTEXT>>>" });
    const prompt = runner.seen[0]!.prompt;
    expect(prompt.startsWith("<<<PROJEKTKONTEXT")).toBe(true);
    expect(prompt.split("\n---\n").pop()).toBe("mach das spiel neon");
  });

  it("every stage failing throws RewriteFailed with all reasons", async () => {
    const run: OneShotRunner = async () => {
      throw new Error("kaputt");
    };
    const err = await enhancePrompt("claude", "x", "/tmp", { runOneShot: run }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RewriteFailed);
    expect((err as RewriteFailed).skipped.map((s) => s.engine)).toEqual(["Lokales Modell", "Claude"]);
    expect((err as Error).message).toContain("Claude: kaputt");
  });
});

describe("localModelState", () => {
  it("free with one idle slot, unknown without /slots, busy on 503", async () => {
    expect(await localModelState(local(fakeServer({ slots: [{ is_processing: true }, { is_processing: false }] })))).toBe("free");
    expect(await localModelState(local(fakeServer({ slots: 501 })))).toBe("unknown");
    expect(await localModelState(local(fakeServer({ slots: 503 })))).toBe("busy");
  });

  it("asks the server root, not /v1", async () => {
    const server = fakeServer({});
    await localModelState(local(server));
    expect(server.calls).toEqual(["http://127.0.0.1:9/slots"]);
  });
});

describe("cleanLocalAnswer", () => {
  it("drops think blocks and a wrapping code fence", () => {
    expect(cleanLocalAnswer("<think>a\nb</think>\n```markdown\nZiel: x\n```")).toBe("Ziel: x");
  });
});

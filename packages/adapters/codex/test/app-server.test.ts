import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import type { AdapterContext, EmittedEvent, ToolPermissionRequest } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter } from "../src/index.ts";
import { listModels } from "../src/app-server.ts";
import { quotaOf, itemCompleted } from "../src/app-server-events.ts";
import { standIn } from "../../../../e2e/support/stand-in.ts";

const fakeCodex = standIn("codex");
chmodSync(fakeCodex, 0o755);

function context(answer?: (req: ToolPermissionRequest) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }>) {
  const runner = new ProcessRunner();
  const turns: string[] = [];
  const asked: ToolPermissionRequest[] = [];
  const ctx = makeRecordingContext({
    workdir: process.cwd(),
    spawnWorker: (cmd, o) => runner.spawn({ name: "codex-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    turn: (s: "working" | "idle") => turns.push(s),
    ...(answer
      ? {
          requestToolPermission: async (req: ToolPermissionRequest) => {
            asked.push(req);
            return answer(req);
          },
        }
      : {}),
  } as Partial<AdapterContext>);
  return { ctx, turns, asked };
}
const kinds = (events: EmittedEvent[]) => events.map((e) => (e.payload as { kind?: string }).kind);

describe("codex app-server mode (T7.2)", () => {
  it("reports a child that stays active beyond the main turn, then completes independently", async () => {
    const { ctx } = context();
    const timeline: string[] = [];
    ctx.turn = state => { timeline.push(state); };
    ctx.activity = activity => { if (activity.id === "agent:child") timeline.push(activity.state); };
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "CHILD_ACTIVITY" }, ctx);
    try {
      await waitFor(() => timeline.includes("completed"));
      expect(timeline).toContain("running");
      expect(timeline.indexOf("running")).toBeLessThan(timeline.indexOf("idle"));
      expect(timeline.indexOf("idle")).toBeLessThan(timeline.indexOf("completed"));
    } finally { await adapter.stop(handle, ctx); }
  });
  it("does not resurrect a completed turn when its start response arrives late", async () => {
    const { ctx } = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "END_BEFORE_ACK" }, ctx);
    try {
      const ack = await adapter.steer(handle, { kind: "prompt", text: "REJECT_START" }, ctx);
      expect(ack).toMatchObject({ ok: false, detail: expect.stringContaining("turn/start") });
    } finally { await adapter.stop(handle, ctx); }
  });
  it("uses native /compact and resumes normal prompts after the provider finishes", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd() }, ctx);
    try {
      expect(adapter.capabilities().commands).toContainEqual(expect.objectContaining({ name: "/compact", scope: "steer" }));
      expect(createAdapter({ mode: "exec" }).capabilities().commands ?? []).not.toContainEqual(expect.objectContaining({ name: "/compact" }));
      expect(await adapter.steer(handle, { kind: "prompt", text: "/compact text" }, ctx)).toMatchObject({ ok: false });
      const pending = adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx);
      expect(await adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx)).toMatchObject({ ok: false });
      expect(await pending).toEqual({ ok: true });
      await waitFor(() => turns.at(-1) === "idle");
      expect(kinds(ctx.events).filter((kind) => kind?.startsWith("codex.compaction"))).toEqual(["codex.compaction_start", "codex.compaction_end"]);
      expect(ctx.events.some((event) => event.type === "assistant")).toBe(false);
      expect(await adapter.steer(handle, { kind: "prompt", text: "Weiter" }, ctx)).toEqual({ ok: true });
      await waitFor(() => ctx.events.some((event) => event.payload.text === "Antwort auf: Weiter · Codex"));
    } finally { await adapter.stop(handle, ctx); }
  });

  it("reports provider refusal and releases the compaction lock", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), env: { ANCIENTVOID_FAKE_COMPACT_REJECT: "1" } }, ctx);
    try {
      expect(await adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx)).toMatchObject({
        ok: false,
        detail: expect.stringContaining("Provider rejected compaction"),
      });
      expect(turns.at(-1)).toBe("idle");
      expect(kinds(ctx.events)).toContain("provider.error");
      expect(await adapter.steer(handle, { kind: "prompt", text: "Weiter" }, ctx)).toEqual({ ok: true });
    } finally { await adapter.stop(handle, ctx); }
  });

  it("continues the existing native thread instead of silently starting a new conversation", async () => {
    const first = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "first" }, first.ctx);
    await waitFor(() => first.turns.includes("idle"));
    const native = first.ctx.events.find(e => e.payload?.kind === "codex.native_session")?.payload?.nativeSessionId;
    await adapter.stop(handle, first.ctx);
    const second = context();
    const resumed = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "continue", args: { resumeSessionId: native } }, second.ctx);
    try {
      await waitFor(() => second.turns.includes("idle"));
      expect(second.ctx.events.find(e => e.payload?.kind === "codex.native_session")?.payload?.nativeSessionId).toBe(native);
    } finally { await adapter.stop(resumed, second.ctx); }
  });
  it("rejects a refused follow-up instead of acknowledging a lost input (BUG-0158)", async () => {
    const { ctx } = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    try {
      const ack = await adapter.steer(handle, { kind: "prompt", text: "REJECT_STEER" }, ctx);
      expect(ack).toMatchObject({ ok: false, detail: expect.stringContaining("turn/steer") });
      expect(kinds(ctx.events)).toContain("provider.error");
    } finally { await adapter.stop(handle, ctx); }
  });

  it("rejects a refused new turn and reports failed initial submission (BUG-0158)", async () => {
    const { ctx } = context();
    const adapter = createAdapter({ command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd() }, ctx);
    try {
      expect(await adapter.steer(handle, { kind: "prompt", text: "REJECT_START" }, ctx)).toMatchObject({ ok: false });
    } finally { await adapter.stop(handle, ctx); }
    await expect(adapter.start({ adapter: "codex", project: process.cwd(), prompt: "REJECT_START" }, ctx)).rejects.toThrow("turn/start");
  });

  it("capabilities: native gate, questions, quota, model choice — exec stays sandbox", () => {
    expect(createAdapter({ mode: "app-server" }).capabilities()).toMatchObject({ usage: true, features: { toolGate: "native", questions: true, modelChoice: "start" } });
    expect(createAdapter({ mode: "app-server", approvalPolicy: "never" }).capabilities().features.toolGate).toBe("sandbox");
    expect(createAdapter({ mode: "exec" }).capabilities().features.toolGate).toBe("sandbox");
    expect(createAdapter().capabilities().features.toolGate, "app-server is the default").toBe("native");
  });

  it("a turn: thread id, plan as todos, reasoning, answer, tokens, quota windows", async () => {
    const { ctx, turns } = context();
    await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(kinds(ctx.events)).toContain("codex.native_session");
    expect(ctx.events.find((e) => e.type === "assistant")?.payload).toMatchObject({ text: "Antwort auf: Hallo · Codex" });
    expect(ctx.events.find((e) => e.type === "thinking")?.payload).toMatchObject({ text: "Kurz überlegt." });
    expect(ctx.events.find((e) => (e.payload as { name?: string }).name === "todowrite")).toBeTruthy();
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.token_usage")?.tokensEst).toBe(120);
    // P84: Codex meldet die Eingabe samt Cache; der Cache bleibt getrennt sichtbar und ist als enthalten markiert.
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.token_usage")?.payload)
      .toMatchObject({ usage: { input: 100, output: 20 }, cacheInputTokens: 40, cacheIncluded: true });
    const quota = ctx.events.find((e) => e.usageQuota)?.usageQuota;
    expect(quota?.windows.map((w) => [w.id, w.utilization])).toEqual([["five_hour", 0.12], ["seven_day", 0.4]]);
  });

  it("a command asks the phone; accept runs it, decline does not — never acceptForSession", async () => {
    for (const allow of [true, false]) {
      const { ctx, turns, asked } = context(async (req) => (allow ? { behavior: "allow", updatedInput: req.input } : { behavior: "deny", message: "nein" }));
      await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
      await waitFor(() => turns.includes("idle"));
      expect(asked[0]).toMatchObject({ toolName: "Shell", input: { command: "echo hallo-codex" } });
      const answer = ctx.events.find((e) => e.type === "assistant")?.payload as { text: string };
      expect(answer.text).toContain(allow ? "Ausgabe hallo-codex (accept)" : "nicht ausgeführt (decline)");
      expect(ctx.events.find((e) => e.type === "tool_result")?.payload).toMatchObject({ isError: !allow });
    }
  });

  it("a codex question is answered on the phone and goes back by question id", async () => {
    const { ctx, turns, asked } = context(async (req) => ({ behavior: "allow", updatedInput: { ...req.input, answers: { "Welche Farbe?": "Grün" } } }));
    await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "FRAGE" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(asked[0]).toMatchObject({ toolName: "AskUserQuestion", input: { questions: [{ question: "Welche Farbe?", options: [{ label: "Rot" }, { label: "Grün" }] }] } });
    expect((ctx.events.find((e) => e.type === "assistant")?.payload as { text: string }).text).toContain("Gewählt: Grün");
  });

  it("park interrupts the running turn", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ mode: "app-server", command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await adapter.steer(handle, { kind: "park" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_end")?.payload).toMatchObject({ status: "interrupted" });
    await adapter.stop(handle, ctx);
  });

  it("model catalog from model/list, hidden models left out", async () => {
    expect(await listModels(fakeCodex)).toEqual([
      { id: "gpt-6-astra", label: "GPT-6-Astra" },
      { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    ]);
  });
});

describe("codex app-server events", () => {
  it("quota needs a reset time — never a window that never expires", () => {
    expect(quotaOf({ primary: { usedPercent: 50, windowDurationMins: 300 } })).toBeUndefined();
  });
  it("a declined command is an error result that says so", () => {
    expect(itemCompleted({ type: "commandExecution", id: "i", status: "declined", exitCode: null })[0]?.payload).toMatchObject({ isError: true, content: "abgelehnt — nicht ausgeführt" });
  });
});

describe("codex attachments (T7.10)", () => {
  it("an image goes as localImage, a document's text rides in the prompt", async () => {
    const { ctx, turns } = context();
    const attachments = [
      { id: "a".repeat(64), name: "foto.png", mimeType: "image/png", kind: "image" as const, bytes: 1000, path: "/data/att/aaa", text: null, method: null },
      { id: "b".repeat(64), name: "notiz.txt", mimeType: "text/plain", kind: "text" as const, bytes: 20, path: "/data/att/bbb", text: "Einkaufsliste: Milch", method: "text" as const },
    ];
    await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "Schau", attachments }, ctx);
    await waitFor(() => turns.includes("idle"));
    const answer = (ctx.events.find((e) => e.type === "assistant")?.payload as { text: string }).text;
    expect(answer).toContain("[Bilder: 1]");
    expect(answer).toContain("Einkaufsliste: Milch");
    expect(answer).toContain("foto.png");
  });

  // BUG-0158: Nachweislich abgelehnte Eingaben bekommen ein negatives Ack mit
  // sichtbarem Grund — nie { ok: true }. Ein Timeout bliebe „Ergebnis
  // unbekannt" (STUMM-Test deckt die Wartesemantik, T17.4).
  it("a rejected turn/steer acks negative with the provider's reason", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ mode: "app-server", command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await waitFor(() => turns.includes("working"));
    const ack = await adapter.steer(handle, { kind: "prompt", text: "Folgeeingabe ABLEHNEN" }, ctx);
    expect(ack.ok).toBe(false);
    expect((ack as { detail?: string }).detail).toContain("abgelehnt");
    expect((ack as { detail?: string }).detail).toContain("provider rejected input");
    await adapter.steer(handle, { kind: "stop" }, ctx);
  });

  it("a rejected turn/start acks negative and keeps the provider.error visible", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ mode: "app-server", command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const ack = await adapter.steer(handle, { kind: "prompt", text: "Neuer Zug ABLEHNEN" }, ctx);
    expect(ack.ok).toBe(false);
    expect((ack as { detail?: string }).detail).toContain("abgelehnt");
    expect(kinds(ctx.events).filter((k) => k === "provider.error").length).toBe(1);
    await adapter.steer(handle, { kind: "stop" }, ctx);
  });
});

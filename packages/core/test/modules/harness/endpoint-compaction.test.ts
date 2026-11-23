import { afterEach, expect, it, vi } from "vitest";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../../../../../examples/adapters/openai-compat/adapter.ts";
import type { HistoryMessage } from "../../../../../examples/adapters/openai-compat/compaction.ts";

afterEach(() => vi.unstubAllGlobals());

it("projects exact old repeats at request time and restores the full history when switched off", async () => {
  const original = "Kein Deployment. Datei lib/a.ts bleibt read-only. Ticket #123.\n".repeat(32);
  const unique = original.replace("#123", "#124");
  const requests: HistoryMessage[][] = [];
  const replies = [original, original, unique, "d", "e", "f", "g", "h", "i", "j"];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    requests.push(JSON.parse(String(options.body)).messages);
    const content = replies.shift();
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
  }));
  let enabled = false;
  let completed = 0;
  const ctx = makeRecordingContext({ turn: (state) => { if (state === "idle") completed++; } });
  Object.defineProperty(ctx, "automaticCompaction", { get: () => enabled });
  const adapter = createAdapter({ baseUrl: "http://localhost/v1" });
  const handle = await adapter.start({ adapter: "my-endpoint", project: process.cwd() }, ctx);
  async function prompt(text: string) {
    const before = completed;
    expect(await adapter.steer(handle, { kind: "prompt", text }, ctx)).toEqual({ ok: true });
    await waitFor(() => completed === before + 1);
  }
  for (const text of ["start", "repeat", original, "four", "five", "six"]) await prompt(text);

  enabled = true;
  await prompt("follow-up");
  const compact = requests.at(-1)!;
  expect(compact[1]?.content).toBe(original);
  expect(compact[3]?.content).toContain("Exact repeat of message 2");
  expect(compact[4]?.content).toBe(original);
  expect(compact[5]?.content).toBe(unique);
  expect(compact.at(-1)?.content).toBe("follow-up");

  enabled = false;
  await prompt("full");
  const full = requests.at(-1)!;
  expect(full[3]?.content).toBe(original);
  const equivalentFull = full.slice(0, compact.length);
  equivalentFull[compact.length - 1] = compact.at(-1)!;
  const savings = Buffer.byteLength(JSON.stringify(equivalentFull)) - Buffer.byteLength(JSON.stringify(compact));
  expect(savings).toBeGreaterThan(1500);
  expect(ctx.events.some((event) => event.payload.kind === "endpoint.compaction" && event.payload.savedBytes === savings)).toBe(true);

  expect(await adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx)).toEqual({ ok: true });
  expect(requests).toHaveLength(8);
  await prompt("manual");
  expect(requests.at(-1)?.[3]?.content).toContain("Exact repeat");
  await prompt("full again");
  expect(requests.at(-1)?.[3]?.content).toBe(original);
  expect(requests.flat().some(({ content }) => content === "/compact")).toBe(false);
});

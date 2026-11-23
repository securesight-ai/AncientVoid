import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiStream } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Real `pi -p --mode json` capture (pi 1.4.0, gpubox-qwen, 2026-10-27):
// one read tool call, thinking on, paths anonymized.
const fixture = readFileSync(join(here, "fixtures", "tool-use.jsonl"), "utf8");

function run(chunks: string[]) {
  const stream = createPiStream();
  return [...chunks.flatMap((c) => stream.push(c)), ...stream.end()];
}

describe("pi --mode json stream (BUG-0065)", () => {
  it("ein echter Lauf ergibt Thinking, Tool-Aufruf, Tool-Ergebnis und Antwort, in Reihenfolge", () => {
    const events = run([fixture]);
    const visible = events.filter((e) => e.type !== "system").map((e) => e.type);
    expect(visible).toEqual(["thinking", "tool_use", "tool_result", "thinking", "assistant"]);
    const call = events.find((e) => e.type === "tool_use")!;
    expect(call.payload).toMatchObject({ id: "call_fe23dab52a6d476c8dd7b965", name: "read", input: { path: "notiz.txt" } });
    const result = events.find((e) => e.type === "tool_result")!;
    expect(result.payload).toMatchObject({ toolUseId: "call_fe23dab52a6d476c8dd7b965", isError: false, content: "alpha\nbeta\n" });
    expect(events.find((e) => e.type === "thinking")!.payload.text).not.toBe("");
    expect(String(events.find((e) => e.type === "assistant")!.payload.text)).toMatch(/2/);
  });

  it("Records, die über Chunk-Grenzen geschnitten sind, gehen nicht verloren", () => {
    const whole = run([fixture]);
    const chunks: string[] = [];
    for (let i = 0; i < fixture.length; i += 97) chunks.push(fixture.slice(i, i + 97));
    expect(run(chunks)).toEqual(whole);
  });

  it("Events kommen, sobald ihr Block fertig ist, nicht erst am Prozessende (Streaming)", () => {
    const lines = fixture.split("\n");
    const cut = lines.findIndex((l) => l.includes('"tool_execution_end"'));
    const stream = createPiStream();
    const early = stream.push(lines.slice(0, cut).join("\n") + "\n");
    expect(early.map((e) => e.type)).toContain("tool_use");
  });

  it("Unicode-Zeilentrenner im Text trennen keine Records (pi docs/json.md)", () => {
    const line = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "a b c" } });
    expect(run([line + "\n"])).toEqual([expect.objectContaining({ type: "assistant", payload: { text: "a b c" } })]);
  });

  it("ein fehlgeschlagenes Tool ist als Fehler markiert", () => {
    const line = JSON.stringify({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "boom" }] }, isError: true });
    expect(run([line + "\n"])[0]).toMatchObject({ type: "tool_result", payload: { toolUseId: "c1", isError: true, content: "boom" } });
  });

  it("fail loud: unbekannte Typen und kaputte Zeilen werden sichtbar, nicht verworfen", () => {
    const events = run(['{"type":"brand_new_thing"}\n', "das ist kein json\n"]);
    expect(events).toHaveLength(2);
    expect(events[0]!.summary).toContain("brand_new_thing");
    expect(events[1]!.summary).toContain("kein JSON");
  });

  it("eine Antwort mit stopReason error wird ein Provider-Fehler", () => {
    const line = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "529 overloaded" } });
    expect(run([line + "\n"])).toEqual([expect.objectContaining({ payload: expect.objectContaining({ kind: "provider.error", provider: "pi" }) })]);
  });
});

describe("pi usage (ADR-0032)", () => {
  it("jede Modell-Antwort meldet Tokens; die Füllung zählt den Cache mit", () => {
    const usage = run([fixture]).filter((e) => e.payload.kind === "pi.usage");
    // Real capture: round 1 input 1057; round 2 input 53 + cacheRead 1057.
    expect(usage.map((e) => e.payload.usage)).toEqual([
      { input: 1057, output: 35 },
      { input: 1110, output: 22 },
    ]);
    expect(usage.map((e) => e.tokensEst)).toEqual([1092, 1132]);
  });

  it("ohne usage kein Token-Event (nichts geraten)", () => {
    const line = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } });
    expect(run([line + "\n"])).toEqual([]);
  });
});

describe("Compaction-Zeilen im Chat (Nutzerfund 2026-11-23)", () => {
  const zeile = (rec: Record<string, unknown>) => run([JSON.stringify(rec)])[0]!;

  it("eine fehlgeschlagene Verdichten sagt den Grund und dass der Kontext unverändert bleibt", () => {
    const e = zeile({
      type: "compaction_end",
      reason: "threshold",
      aborted: false,
      errorMessage: "Auto-compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete",
    });
    expect(e.payload).toMatchObject({ kind: "pi.compaction_end" });
    expect(String(e.summary)).toContain("fehlgeschlagen");
    expect(String(e.summary)).toContain("Antwort-Budget");
    expect(String(e.summary)).toContain("unverändert");
  });

  it("Start und Erfolg heißen deutsch, nach Grund unterschieden", () => {
    expect(String(zeile({ type: "compaction_start", reason: "threshold" }).summary)).toContain("Kontext an der Grenze");
    expect(String(zeile({ type: "compaction_start", reason: "manual" }).summary)).toContain("von Hand");
    expect(String(zeile({ type: "compaction_end", reason: "threshold", aborted: false }).summary)).toContain("Kontext verdichtet");
  });

  it("„session too small“ ist keine Panik, sondern nichts zu tun", () => {
    const e = zeile({ type: "compaction_end", reason: "manual", aborted: false, errorMessage: "Nothing to compact (session too small)" });
    expect(String(e.summary)).toContain("nichts zu verdichten");
  });
});

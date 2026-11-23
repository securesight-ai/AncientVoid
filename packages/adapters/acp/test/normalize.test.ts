import { describe, expect, it } from "vitest";
import { UpdateMapper, resolveRawInput } from "../src/normalize.ts";

describe("ACP-Textreihenfolge", () => {
  it("erhält assistant → thinking → assistant statt die Texte umzusortieren", () => {
    const mapper = new UpdateMapper("test");
    const events = [
      ...mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Ich prüfe." } }),
      ...mapper.map({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Erst lesen." } }),
      ...mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Ergebnis." } }),
      ...mapper.flush(),
    ];
    expect(events.map((e) => [e.type, e.payload.text])).toEqual([
      ["assistant", "Ich prüfe."], ["thinking", "Erst lesen."], ["assistant", "Ergebnis."],
    ]);
  });
});

describe("resolveRawInput", () => {
  it("nimmt Objekte und JSON-Strings; erfindet nichts aus title", () => {
    expect(resolveRawInput({ command: "ls" })).toEqual({ command: "ls" });
    expect(resolveRawInput('{"command":"ls","cwd":"/x"}')).toEqual({ command: "ls", cwd: "/x" });
    expect(resolveRawInput("not-json")).toBeUndefined();
    expect(resolveRawInput(null)).toBeUndefined();
  });
});

describe("BUG-0247/0248 — Shell-command kommt oft erst im tool_call_update", () => {
  it("opencode ACP: erstes tool_call nur cwd → tool_use wartet; Update liefert command", () => {
    const mapper = new UpdateMapper("opencode");
    expect(
      mapper.map({
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "shell",
        name: "shell",
        kind: "execute",
        status: "pending",
        rawInput: { cwd: "/anon/av" },
      }).filter((e) => e.type === "tool_use"),
    ).toEqual([]);

    const mid = mapper.map({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      title: "npm run lint",
      name: "shell",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "npm run lint", cwd: "/anon/av" },
    });
    expect(mid).toMatchObject([
      { type: "tool_use", payload: { id: "call_1", name: "shell", input: { command: "npm run lint", cwd: "/anon/av" } } },
    ]);
    // title bleibt Metadatum, wird nicht zu command (PRD §8.5)
    expect(mid[0]?.payload).toMatchObject({ title: "npm run lint" });
    expect(mid[0]?.payload.input).not.toHaveProperty("title");

    const done = mapper.map({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok\n" } }],
    });
    expect(done.map((e) => e.type)).toEqual(["tool_result"]);
    expect(done[0]?.payload).toMatchObject({ toolUseId: "call_1", isError: false });
  });

  it("maki ACP: bash ohne rawInput wartet; Update mit command emittiert tool_use (kein title→command)", () => {
    const mapper = new UpdateMapper("maki");
    expect(
      mapper.map({
        sessionUpdate: "tool_call",
        toolCallId: "m1",
        title: "tests",
        name: "bash",
        kind: "execute",
        status: "pending",
      }).filter((e) => e.type === "tool_use"),
    ).toEqual([]);

    const mid = mapper.map({
      sessionUpdate: "tool_call_update",
      toolCallId: "m1",
      name: "bash",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "npm test", description: "tests" },
    });
    expect(mid).toMatchObject([
      { type: "tool_use", payload: { id: "m1", name: "bash", input: { command: "npm test", description: "tests" } } },
    ]);
    expect(mid[0]?.payload.input).not.toHaveProperty("title");
  });

  it("Shell ohne jemals command: am Ende trotzdem tool_use (fail loud) + tool_result", () => {
    const mapper = new UpdateMapper("maki");
    mapper.map({
      sessionUpdate: "tool_call",
      toolCallId: "m2",
      title: "lint",
      name: "bash",
      kind: "execute",
      status: "pending",
    });
    const done = mapper.map({
      sessionUpdate: "tool_call_update",
      toolCallId: "m2",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });
    expect(done.map((e) => e.type)).toEqual(["tool_use", "tool_result"]);
    expect(done[0]?.payload).toMatchObject({ id: "m2", name: "bash", input: {} });
  });

  it("Nicht-Shell emittiert sofort (read mit path)", () => {
    const mapper = new UpdateMapper("opencode");
    const ev = mapper.map({
      sessionUpdate: "tool_call",
      toolCallId: "r1",
      name: "read",
      kind: "read",
      status: "pending",
      rawInput: { path: "a.ts" },
    });
    expect(ev).toMatchObject([{ type: "tool_use", payload: { id: "r1", name: "read", input: { path: "a.ts" } } }]);
  });
});

it("reports the OpenCode ACP compaction lifecycle from provider metadata", () => {
  const mapper = new UpdateMapper("OpenCode");
  const update = (status: string) => mapper.map({
    sessionUpdate: "session_info_update",
    _meta: { "opencode/compaction": { status, reason: "manual" } },
  });
  expect(update("started")[0]?.payload).toEqual({ kind: "acp.compaction_start", reason: "manual" });
  expect(update("completed")[0]?.payload).toEqual({ kind: "acp.compaction_end", reason: "manual" });
  expect(mapper.map({ sessionUpdate: "session_info_update" })).toEqual([]);
});

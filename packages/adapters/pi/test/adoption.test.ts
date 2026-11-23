import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRecordingContext } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";
import { transcriptEvents } from "../src/transcript.ts";
import { createPiStream } from "../src/normalize.ts";

const ID = "01a18324-d82d-77b4-88ff-1ab8ab9d3814";
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const msg = (message: unknown) => line({ type: "message", message });
const SESSION =
  line({ type: "session", version: 3, id: ID, cwd: "/work/app" }) +
  msg({ role: "system", content: "" }) +
  msg({ role: "user", content: [{ type: "text", text: "Liste die Dateien" }] }) +
  msg({ role: "assistant", content: [{ type: "thinking", thinking: "Ich schaue nach" }, { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] }) +
  msg({ role: "toolResult", toolCallId: "c1", toolName: "bash", isError: false, content: [{ type: "text", text: "a.ts\nb.ts" }] }) +
  msg({ role: "assistant", content: [{ type: "text", text: "Zwei Dateien" }] });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-adopt-"));
  dirs.push(root);
  const proj = join(root, "--work-app--");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, `2026-10-28T10-00-00-000Z_${ID}.jsonl`), SESSION);
  return root;
}
const fakeProc = () => ({ pid: 1, onStdout: () => {}, onStderr: () => {}, onExit: () => {}, kill: async () => {} }) as never;

describe("pi: Session aus der Datei übernehmen (ADR-0041)", () => {
  it("transcriptEvents bildet user, thinking, tool_use, tool_result und assistant ab", () => {
    const events = transcriptEvents(SESSION);
    expect(events.map((e) => e.type)).toEqual(["user", "thinking", "tool_use", "tool_result", "assistant"]);
    expect(events[0]!.payload).toEqual({ text: "Liste die Dateien" });
    expect(events[2]!.payload).toMatchObject({ id: "c1", name: "bash", input: { command: "ls" } });
    expect(events[3]!.payload).toMatchObject({ toolUseId: "c1", isError: false, content: "a.ts\nb.ts" });
  });

  it("der Stream meldet die native Session-ID, damit der Hub sie kennt (Dedupe, Recovery)", () => {
    const events = createPiStream().push(line({ type: "session", id: ID, cwd: "/x" }));
    expect(events[0]!.payload).toMatchObject({ kind: "pi.session", nativeSessionId: ID });
  });

  it("EPIC-P35 T35.3: die promptlose Übernahme ist als hub-Resume deklariert („Weitermachen“)", () => {
    expect(createAdapter({}).capabilities().resume).toMatchObject({ ref: "native", hub: true });
  });

  it("ohne Prompt startet kein Prozess; der erste Prompt setzt mit --session <Datei> fort, jeder weitere ebenso", async () => {
    const root = store();
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd: string[]) => { calls.push(cmd); return fakeProc(); } });
    const adapter = createAdapter({ sessionsDir: root });
    const handle = await adapter.start({ adapter: "pi", project: "/work/app", args: { resumeSessionId: ID, importHistory: true } }, ctx);
    expect(calls).toHaveLength(0);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.transcript_imported")).toBe(true);
    expect(ctx.events.filter((e) => e.type === "tool_use")).toHaveLength(1);
    await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
    await adapter.steer(handle, { kind: "prompt", text: "nochmal" }, ctx);
    for (const c of calls) {
      const cmd = c[2]!;
      expect(cmd).toContain("--session");
      expect(cmd).toContain(`_${ID}.jsonl`);
      expect(cmd).not.toContain("--fork");
      expect(cmd).not.toContain("--continue");
    }
  });

  it("forkSession: --fork nur im ersten Zug, danach --continue in der Kopie", async () => {
    const root = store();
    const calls: string[][] = [];
    // BUG-0261: ein zweiter Prompt waehrend eines laufenden Zug wird abgelehnt.
    // Der Zug muss also enden, bevor der naechste Prompt kommt — genau so ruft
    // der Hub den Adapter an. Fake-Prozess meldet seinen Exit sofort.
    const fertig = () => ({
      pid: 1,
      onStdout: () => {},
      onStderr: () => {},
      onExit: (cb: (code: number | null) => void) => { setTimeout(() => cb(0), 0); },
      kill: async () => {},
    }) as never;
    const ctx = makeRecordingContext({ spawnWorker: async (cmd: string[]) => { calls.push(cmd); return fertig(); } });
    const adapter = createAdapter({ sessionsDir: root });
    const handle = await adapter.start({ adapter: "pi", project: "/work/app", args: { resumeSessionId: ID, forkSession: true } }, ctx);
    await adapter.steer(handle, { kind: "prompt", text: "eins" }, ctx);
    await new Promise((r) => setTimeout(r, 5));
    const zweiter = await adapter.steer(handle, { kind: "prompt", text: "zwei" }, ctx);
    expect(zweiter.ok).toBe(true);
    expect(calls[0]![2]).toContain("--fork");
    expect(calls[1]![2]).toContain("--continue");
    expect(calls[1]![2]).not.toContain("--fork");
  });

  it("mit Prompt forkt schon der Start", async () => {
    const root = store();
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd: string[]) => { calls.push(cmd); return fakeProc(); } });
    await createAdapter({ sessionsDir: root }).start({ adapter: "pi", project: "/work/app", prompt: "los", args: { resumeSessionId: ID, forkSession: true } }, ctx);
    expect(calls[0]![2]).toContain("--fork");
  });

  it("unbekannte oder ungültige Session-IDs scheitern laut, vor dem Spawn", async () => {
    const root = store();
    let spawned = 0;
    const ctx = makeRecordingContext({ spawnWorker: async () => { spawned += 1; return fakeProc(); } });
    const adapter = createAdapter({ sessionsDir: root });
    await expect(adapter.start({ adapter: "pi", project: "/x", prompt: "a", args: { resumeSessionId: "../../etc/passwd" } }, ctx)).rejects.toThrow("keine Session-ID");
    await expect(adapter.start({ adapter: "pi", project: "/x", prompt: "a", args: { resumeSessionId: "01a18324-0000-7000-8000-00000000ffff" } }, ctx)).rejects.toThrow("nicht gefunden");
    expect(spawned).toBe(0);
  });

  it("recover findet die Datei der nativen ID wieder und setzt mit --session fort", async () => {
    const root = store();
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd: string[]) => { calls.push(cmd); return fakeProc(); }, nativeSessionId: ID } as never);
    const adapter = createAdapter({ sessionsDir: root });
    const handle = await adapter.recover!("s1", 0, ctx);
    expect(handle).not.toBeNull();
    await adapter.steer(handle!, { kind: "prompt", text: "weiter" }, ctx);
    expect(calls[0]![2]).toContain(`_${ID}.jsonl`);
    expect(await adapter.recover!("s2", 0, makeRecordingContext({} as never))).toBeNull();
  });
  it("BUG-0209: recover fragt den Hub nach einem überlebenden Worker — ohne ihn endet der offene Zug (adopted=false)", async () => {
    const root = store();
    let asked = 0;
    const ctx = makeRecordingContext({ adoptWorker: async () => { asked += 1; return null; }, nativeSessionId: ID } as never);
    const handle = await createAdapter({ sessionsDir: root }).recover!("s1", 0, ctx);
    expect(asked).toBe(1);
    expect(handle).not.toBeNull(); // der nächste Prompt setzt weiterhin fort
  });
});

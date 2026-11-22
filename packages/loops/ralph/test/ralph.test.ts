import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@ancientvoid/adapter-testkit";
import { createLoopConnector } from "../src/index.ts";

let dir: string;

const stateFile = (target = "EPIC-T1") => join(dir, `${target}-state.json`);
const setState = (target: string, doc: Record<string, unknown>) => writeFileSync(stateFile(target), JSON.stringify(doc));
const of = (ctx: { events: { payload?: unknown }[] }, k: string) => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === k).map((e) => e.payload as Record<string, unknown>);
const progress = (ctx: { events: { payload?: unknown }[] }) => of(ctx, "loop.progress").filter((p) => p.source === "ralph");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ancientvoid-ralph-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const connect = async (opts: { target?: string; resume?: unknown; prepare?: () => void } = {}) => {
  const connector = createLoopConnector({ stateDir: dir, pollMs: 40 });
  const ctx = makeRecordingContext();
  opts.prepare?.();
  const handle = await connector.start({ project: dir, options: { target: opts.target ?? "EPIC-T1" } }, ctx, { resume: opts.resume ?? null, saveCursor: () => undefined });
  return { connector, ctx, handle };
};

describe("loop-ralph", () => {
  it("besteht die Loop-Contract-Suite", async () => {
    const results = await runLoopContractTests(createLoopConnector, {
      config: { stateDir: dir, pollMs: 40 },
      spec: { project: dir, options: { target: "EPIC-T1" } },
      prepare: () => setState("EPIC-T1", { status: "running", tasks_done: ["T1"], tasks_total: ["T1", "T2"] }),
    });
    assertContractGreen(results);
  });

  it("start() legt ein fehlendes State-File an (Deploy-Regel: State VOR Runner-Start)", async () => {
    expect(existsSync(stateFile())).toBe(false);
    const { ctx, connector, handle } = await connect();
    expect(existsSync(stateFile())).toBe(true);
    const doc = JSON.parse(readFileSync(stateFile(), "utf8")) as { status: string; epic: string };
    expect(doc.status).toBe("running");
    expect(doc.epic).toBe("EPIC-T1");
    await connector.stop(handle, ctx);
  });

  it("start() ohne target scheitert laut (fail loud)", async () => {
    const connector = createLoopConnector({ stateDir: dir, pollMs: 40 });
    const ctx = makeRecordingContext();
    await expect(connector.start({ project: dir, options: {} }, ctx, { resume: null, saveCursor: () => undefined })).rejects.toThrow(/target/);
  });

  it("meldet Fortschritt und dedupliziert unveränderten Zustand", async () => {
    setState("EPIC-T1", { status: "running", tasks_done: ["T1"], tasks_total: ["T1", "T2"], current_task: "T2" });
    const { ctx, connector, handle } = await connect();
    await waitFor(() => progress(ctx).length === 1, 3000);
    const first = progress(ctx)[0];
    expect(first).toBeDefined();
    expect(first).toMatchObject({ source: "ralph", epic: "EPIC-T1", done: 1, total: 2, status: "running", step: "T2" });
    await new Promise((r) => setTimeout(r, 150));
    expect(progress(ctx)).toHaveLength(1); // kein Change → kein zweites Event
    setState("EPIC-T1", { status: "running", tasks_done: ["T1", "T2"], tasks_total: ["T1", "T2"] });
    await waitFor(() => progress(ctx).length === 2, 3000);
    const second = progress(ctx)[1];
    expect(second).toBeDefined();
    expect(second).toMatchObject({ done: 2, total: 2 });
    await connector.stop(handle, ctx);
  });

  it("wartend = Gate grün, wartet auf Jans Abnahme (loop.notify, degraded)", async () => {
    setState("EPIC-T1", { status: "running", tasks_done: ["T1"], tasks_total: ["T1"] });
    const { ctx, connector, handle } = await connect();
    await waitFor(() => progress(ctx).length === 1, 3000);
    setState("EPIC-T1", { status: "wartend", tasks_done: ["T1"], tasks_total: ["T1"], report_pending: true });
    await waitFor(() => of(ctx, "loop.notify").length === 1, 3000);
    const notified = of(ctx, "loop.notify")[0];
    expect(notified).toBeDefined();
    expect(notified).toMatchObject({ epic: "EPIC-T1", status: "wartend", level: "1" });
    expect(String(notified?.reason)).toContain("Abnahme");
    const rep = await connector.status(handle);
    expect(rep.state).toBe("degraded");
    await connector.stop(handle, ctx);
  });

  it("blocked und stopped werden als Eskalation (Level 2) sichtbar", async () => {
    setState("EPIC-T1", { status: "blocked", tasks_done: [], tasks_total: ["T1"], gate_fails: 5 });
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.notify").some((p) => p.status === "blocked"), 3000);
    expect(of(ctx, "loop.notify").find((p) => p.status === "blocked")).toMatchObject({ level: "2" });
    await connector.stop(handle, ctx);
  });

  it("unlesbares State-File → loop.broken, wieder lesbar → loop.recovered", async () => {
    writeFileSync(stateFile(), "{kein json");
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.broken").length === 1, 3000);
    setState("EPIC-T1", { status: "running", tasks_done: ["T1"], tasks_total: ["T1"] });
    await waitFor(() => of(ctx, "loop.recovered").length === 1, 3000);
    const rep = await connector.status(handle);
    expect(rep.state).toBe("healthy");
    await connector.stop(handle, ctx);
  });

  it("control: pause/resume setzen paused im State-File; unbekannte Befehle werden laut abgelehnt", async () => {
    setState("EPIC-T1", { status: "running", tasks_done: [], tasks_total: ["T1"] });
    const { ctx, connector, handle } = await connect();
    const pause = await connector.control(handle, { kind: "pause" }, ctx);
    expect(pause.ok).toBe(true);
    expect((JSON.parse(readFileSync(stateFile(), "utf8")) as { paused?: boolean }).paused).toBe(true);
    const resume = await connector.control(handle, { kind: "resume" }, ctx);
    expect(resume.ok).toBe(true);
    expect((JSON.parse(readFileSync(stateFile(), "utf8")) as { paused?: boolean }).paused).toBe(false);
    const reject = await connector.control(handle, { kind: "workNext", text: "x" }, ctx);
    expect(reject.ok).toBe(false);
    expect(reject.detail).toBeTruthy();
    await connector.stop(handle, ctx);
  });

  it("control adressiert den Lauf des Handles — nicht irgendeinen offenen (Regression)", async () => {
    setState("EPIC-A", { status: "running", tasks_done: [], tasks_total: ["A1"] });
    setState("EPIC-B", { status: "running", tasks_done: [], tasks_total: ["B1"] });
    const connector = createLoopConnector({ stateDir: dir, pollMs: 40 });
    const ctxA = makeRecordingContext();
    const ctxB = makeRecordingContext();
    const a = await connector.start({ project: dir, options: { target: "EPIC-A" } }, ctxA, { resume: null, saveCursor: () => undefined });
    const b = await connector.start({ project: dir, options: { target: "EPIC-B" } }, ctxB, { resume: null, saveCursor: () => undefined });
    const pauseB = await connector.control(b, { kind: "pause" }, ctxB);
    expect(pauseB.ok).toBe(true);
    expect((JSON.parse(readFileSync(stateFile("EPIC-B"), "utf8")) as { paused?: boolean }).paused).toBe(true);
    expect((JSON.parse(readFileSync(stateFile("EPIC-A"), "utf8")) as { paused?: boolean }).paused).toBeUndefined();
    // Ein getrennter Lauf ist kein Ziel mehr: pausieren scheitert laut, nicht daneben.
    await connector.stop(a, ctxA);
    const pauseStopped = await connector.control(a, { kind: "pause" }, ctxA);
    expect(pauseStopped.ok).toBe(false);
    await connector.stop(b, ctxB);
  });

  it("stop() trennt sauber (kein weiteres Event danach)", async () => {
    setState("EPIC-T1", { status: "running", tasks_done: [], tasks_total: ["T1"] });
    const { ctx, connector, handle } = await connect();
    await waitFor(() => progress(ctx).length === 1, 3000);
    await connector.stop(handle, ctx);
    const before = ctx.events.length;
    setState("EPIC-T1", { status: "wartend", tasks_done: ["T1"], tasks_total: ["T1"] });
    await new Promise((r) => setTimeout(r, 250));
    expect(ctx.events.length).toBe(before);
    expect((await connector.status(handle)).state).toBe("down");
  });
});

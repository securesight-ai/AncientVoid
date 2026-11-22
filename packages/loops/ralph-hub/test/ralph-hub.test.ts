import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor, type RecordingContext } from "@ancientvoid/adapter-testkit";
import { createLoopConnector } from "../src/index.ts";
import type { WorkerProcess } from "@ancientvoid/contracts";

/**
 * ADR-0110: Ralph im Hub — die Schleife treibt JEDE promptbare CLI. Statt eines
 * echten Agenten steht hier eine Attrappe: pro Spawn bearbeitet sie genau eine
 * Aufgabe in der State-Datei (der Prompt enthält deren Pfad) und exit 0.
 */
let dir: string;
const stateFile = (target = "EPIC-X") => join(dir, ".ralph", `${target}-state.json`);
const of = (ctx: RecordingContext, k: string) => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === k).map((e) => e.payload as Record<string, unknown>);

/** Der Prompt nennt die State-Datei — die Attrappe schneidet sie heraus. */
const statePathIn = (argv: string[]): string => {
  const joined = argv.join(" ");
  const hit = /State-Datei \(Wahrheit über Fortschritt\): (\S+)/.exec(joined);
  return hit?.[1] ?? "";
};

/** Ein Agenten-Durchlauf: erste offene Aufgabe → done; keine mehr → status wartend. */
function advance(argv: string[]): string {
  const file = statePathIn(argv);
  const doc = JSON.parse(readFileSync(file, "utf8")) as { status: string; tasks_done: string[]; tasks_total: string[]; current_task: string | null };
  const next = (doc.tasks_total ?? []).find((t) => !(doc.tasks_done ?? []).includes(t));
  if (next) {
    doc.tasks_done = [...(doc.tasks_done ?? []), next];
    doc.current_task = (doc.tasks_total ?? []).find((t) => !doc.tasks_done.includes(t)) ?? null;
  } else if (doc.status === "running") {
    doc.status = "wartend";
  }
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return `Aufgabe erledigt (${doc.tasks_done.length}/${doc.tasks_total.length})`;
}

/** Ein Agent pro Aufruf: erste offene Aufgabe → done; Optionen steuern Sonderfälle. */
function fakeAgent(opts: { failOnce?: boolean; never?: boolean } = {}): RecordingContext["spawnWorker"] {
  let calls = 0;
  return async (argv) => {
    calls += 1;
    if (opts.never) return fakeWorker(0, `nix getan ${calls}`);
    if (opts.failOnce && calls === 1) return fakeWorker(1, "erster Versuch schlägt fehl");
    return fakeWorker(0, advance(argv));
  };
}

function fakeWorker(code: number, out: string): WorkerProcess {
  const listeners = { out: [] as Array<(c: string) => void>, err: [] as Array<(c: string) => void>, exit: [] as Array<(c: number | null) => void> };
  const proc: WorkerProcess = {
    pid: 42_000 + Math.floor(Math.random() * 999),
    onStdout: (cb) => {
      listeners.out.push(cb);
    },
    onStderr: (cb) => {
      listeners.err.push(cb);
    },
    onExit: (cb) => {
      listeners.exit.push(cb);
    },
    write: () => undefined,
    kill: async () => {
      for (const cb of listeners.exit) cb(null);
    },
    exited: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          for (const cb of listeners.out) cb(out);
          resolve({ code });
        }, 5);
      }),
  };
  return proc;
}

async function connect(opts: { target?: string; command?: string; maxTurns?: string; agent?: RecordingContext["spawnWorker"]; resume?: unknown; prepare?: () => void } = {}) {
  const connector = createLoopConnector({ stateDir: ".ralph", turnTimeoutMs: 10_000 });
  const cursors: unknown[] = [];
  const agent = opts.agent ?? fakeAgent();
  const ctx = makeRecordingContext({
    workdir: dir,
    // Das Testkit zeichnet Spawns in seiner Default-Implementierung auf — der Fake ersetzt sie, also hier selbst mitschreiben.
    spawnWorker: async (argv, spawnOpts) => {
      ctx.spawned.push(argv);
      return agent(argv, spawnOpts);
    },
  });
  const handle = await connector.start(
    { project: dir, options: { target: opts.target ?? "EPIC-X", command: opts.command ?? "node agent.js {prompt}", ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}) } },
    ctx,
    { resume: opts.resume ?? null, saveCursor: (c) => cursors.push(c) },
  );
  return { connector, ctx, handle, cursors };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ancientvoid-ralph-hub-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loop-ralph-hub", () => {
  it("besteht die Loop-Contract-Suite (agents: hub)", async () => {
    const results = await runLoopContractTests(createLoopConnector, {
      config: { stateDir: ".ralph", turnTimeoutMs: 10_000 },
      spec: { project: dir, options: { target: "EPIC-X", command: "node agent.js {prompt}" } },
      prepare: (ctx) => {
        ctx.workdir = dir;
        ctx.spawnWorker = fakeAgent();
      },
    });
    assertContractGreen(results);
  });

  it("sät die State-Datei aus der Epic-Datei VOR dem ersten Turn (Deploy-Regel)", async () => {
    mkdirSync(join(dir, "epics"), { recursive: true });
    writeFileSync(join(dir, "epics", "EPIC-X-beispiel.md"), "# EPIC-X\n\n## Aufgaben\n\n- [ ] **T1.1** Erster\n- [ ] **T1.2** Zweiter\n- [x] **T1.3** Schon alt\n");
    // Der erste Agent hält seinen Turn offen, bis der Test die Saat geprüft hat.
    let los: () => void = () => undefined;
    const freigabe = new Promise<void>((resolve) => {
      los = resolve;
    });
    let erster = true;
    const agent: RecordingContext["spawnWorker"] = async (argv) => {
      if (erster) {
        erster = false;
        await freigabe;
      }
      return fakeWorker(0, advance(argv));
    };
    const { ctx, connector, handle } = await connect({ agent });
    const doc = JSON.parse(readFileSync(stateFile(), "utf8")) as { tasks_total: string[]; current_task: string };
    expect(doc.tasks_total).toEqual(["T1.1", "T1.2", "T1.3"]);
    expect(doc.current_task).toBe("T1.1");
    expect(ctx.spawned.length).toBe(1); // der haltende Agent läuft, die Saat liegt schon
    los();
    await waitFor(() => of(ctx, "loop.notify").some((p) => p.status === "wartend"), 15_000);
    await connector.stop(handle, makeRecordingContext());
  });

  it("{prompt} wird ersetzt; ohne Platzhalter hängt der Prompt als letztes Argument", async () => {
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1"], current_task: "T1" }));
    const { ctx, connector, handle } = await connect({ command: "claude -p {prompt}" });
    await waitFor(() => ctx.spawned.length >= 1, 5_000);
    const argv = ctx.spawned[0]!;
    expect(argv.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(argv.length).toBe(3);
    expect(argv[2]).toContain("State-Datei");
    expect(argv.join(" ")).not.toContain("{prompt}");
    await connector.stop(handle, makeRecordingContext());

    rmSync(join(dir, ".ralph"), { recursive: true, force: true });
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1"], current_task: "T1" }));
    const second = await connect({ command: "codex exec" });
    await waitFor(() => second.ctx.spawned.length >= 1, 5_000);
    expect(second.ctx.spawned[0]!.slice(0, 2)).toEqual(["codex", "exec"]);
    expect(second.ctx.spawned[0]!.at(-1)).toContain("State-Datei");
    await second.connector.stop(second.handle, makeRecordingContext());
  });

  it("Turn-Limit stoppt laut (Level 2), Budget zählt über Recovery weiter", async () => {
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1"], current_task: "T1" }));
    const { ctx, connector, handle, cursors } = await connect({ agent: fakeAgent({ never: true }), maxTurns: "2" });
    await waitFor(() => of(ctx, "loop.notify").some((p) => String(p.reason).includes("Turn-Limit")), 10_000);
    expect(ctx.spawned.length).toBe(2);
    expect(of(ctx, "loop.notify").find((p) => String(p.reason).includes("Turn-Limit"))).toMatchObject({ level: "2" });
    expect((await connector.status(handle)).state).toBe("degraded");
    const cursor = cursors.at(-1) as { turns: number };
    expect(cursor.turns).toBe(2);
    await connector.stop(handle, makeRecordingContext());
  });

  it("pause hält die Schleife an (keine neuen Turns), resume läuft weiter", async () => {
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1", "T2"], current_task: "T1" }));
    const { ctx, connector, handle } = await connect();
    await waitFor(() => ctx.spawned.length >= 1, 5_000);
    const pause = await connector.control(handle, { kind: "pause" }, makeRecordingContext());
    expect(pause.ok).toBe(true);
    await waitFor(() => of(ctx, "loop.progress").some((p) => p.done === 1), 10_000); // laufender Turn endet noch
    await new Promise((r) => setTimeout(r, 400));
    const held = ctx.spawned.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.spawned.length).toBe(held); // pausiert: kein neuer Turn
    const resume = await connector.control(handle, { kind: "resume" }, makeRecordingContext());
    expect(resume.ok).toBe(true);
    await waitFor(() => of(ctx, "loop.notify").some((p) => p.status === "wartend"), 10_000);
    await connector.stop(handle, makeRecordingContext());
  });

  it("fehlender Agenten-Befehl scheitert laut; unlesbare State-Datei wird loop.broken gemeldet", async () => {
    await expect(connect({ command: "  " })).rejects.toThrow(/command/);
    await expect(connect({ target: "???" })).rejects.toThrow(/target/);
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), "{kein json");
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.broken").length >= 1, 5_000);
    expect((await connector.status(handle)).state).toBe("broken");
    await connector.stop(handle, makeRecordingContext());
  });

  it("K5: jedes Event bleibt unter 4 KB — der Prompt und die CLI-Ausgabe stehen nicht im Event", async () => {
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1"], current_task: "T1" }));
    const { ctx, connector, handle } = await connect({ agent: async (argv) => fakeWorker(0, `${advance(argv)} A${"x".repeat(60_000)}`) });
    await waitFor(() => of(ctx, "loop.notify").some((p) => p.status === "wartend"), 10_000);
    for (const ev of ctx.events) expect(JSON.stringify(ev).length).toBeLessThan(4 * 1024);
    const turn = of(ctx, "loop.turn").at(-1);
    expect(turn).toMatchObject({ turn: expect.any(Number) });
    expect(JSON.stringify(turn)).not.toContain("xxxxx"); // Ausgabe nur als Blob-Referenz
    expect(ctx.blobs.length).toBeGreaterThan(0);
    await connector.stop(handle, makeRecordingContext());
  });

  it("stop() beendet den laufenden Agenten (kill) und die Schleife", async () => {
    mkdirSync(join(dir, ".ralph"), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ epic: "EPIC-X", status: "running", tasks_done: [], tasks_total: ["T1"], current_task: "T1" }));
    let killed = false;
    const agent: RecordingContext["spawnWorker"] = async () => {
      const w = fakeWorker(0, "arbeite…");
      const origKill = w.kill.bind(w);
      w.kill = async (sig) => {
        killed = true;
        return origKill(sig);
      };
      return w;
    };
    const { ctx, connector, handle } = await connect({ agent });
    await waitFor(() => ctx.spawned.length >= 1, 5_000);
    await connector.stop(handle, makeRecordingContext());
    expect(killed || ctx.spawned.length === 0).toBe(true); // kill gefeuert oder Turn war schon durch
    const spawns = ctx.spawned.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.spawned.length).toBe(spawns);
    expect((await connector.status(handle)).state).toBe("down");
  });
});

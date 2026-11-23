import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { TmuxRunner, TMUX_PREFIX } from "../src/tmux.ts";

const hasTmux = (await new TmuxRunner(join(tmpdir(), "probe")).isAvailable()).valueOf();
const itTmux = hasTmux ? it : it.skip;

describe("TmuxRunner", () => {
  let dir: string;
  let runner: TmuxRunner;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-tmux-"));
    runner = new TmuxRunner(join(dir, "logs"));
  });
  afterAll(async () => {
    await runner.reapOrphans([]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  // C-1 (red-team review, 2026-09-18, T4.10): an unvalidated env KEY was
  // interpolated straight into a shell command string. Runs without
  // itTmux — spawn() now rejects before ever touching tmux, so this must
  // hold even on a machine without tmux installed.
  it("rejects a shell-metacharacter env key instead of building an injectable command (C-1 fix)", async () => {
    const sentinel = join(dir, "pwned");
    await expect(
      runner.spawn({
        name: "test-injection",
        cwd: dir,
        cmd: ["true"],
        env: { [`X=$(touch ${sentinel})`]: "y" },
      }),
    ).rejects.toThrow(/invalid environment variable name/);
    await expect(stat(sentinel)).rejects.toThrow(); // never created — proves the command substitution never ran
  });

  it("accepts a legal env var name and rejects other illegal shapes without touching tmux", async () => {
    await expect(runner.spawn({ name: "t", cwd: dir, cmd: ["true"], env: { "1BAD": "y" } })).rejects.toThrow(
      /invalid environment variable name/,
    );
    await expect(runner.spawn({ name: "t", cwd: dir, cmd: ["true"], env: { "BAD KEY": "y" } })).rejects.toThrow(
      /invalid environment variable name/,
    );
  });

  itTmux("passes a legal env var through to the real spawned process", async () => {
    const proc = await runner.spawn({
      name: "test-env",
      cwd: dir,
      cmd: ["bash", "-c", "echo $GREETING"],
      env: { GREETING: "hello world" },
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    await proc.exited();
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["hello world"]);
  });

  itTmux("preserves a single quote in an env value instead of silently deleting it (value-quoting fix)", async () => {
    const proc = await runner.spawn({
      name: "test-env-quote",
      cwd: dir,
      cmd: ["bash", "-c", "echo $MSG"],
      env: { MSG: "it's a test" },
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    await proc.exited();
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["it's a test"]);
  });

  itTmux("spawns a command and streams stdout lines from a log directory with spaces", async () => {
    const spacedRunner = new TmuxRunner(join(dir, "worker logs"));
    const proc = await spacedRunner.spawn({
      name: "test-stdout",
      cwd: dir,
      cmd: ["bash", "-c", "for i in 1 2 3; do echo line-$i; done; sleep 0.2"],
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    const exit = await proc.exited();
    expect(exit.code).toBe(0);
    // pipe-pane flush needs a beat
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["line-1", "line-2", "line-3"]);
  });

  itTmux("reports exit codes via marker", async () => {
    const proc = await runner.spawn({
      name: "test-exit",
      cwd: dir,
      cmd: ["bash", "-c", "exit 7"],
    });
    const { code } = await proc.exited();
    expect(code).toBe(7);
  });

  itTmux("lists only ancientvoid-prefixed workers and reaps orphans", async () => {
    await runner.spawn({
      name: "test-orphan",
      cwd: dir,
      cmd: ["bash", "-c", "sleep 30"],
    });
    const workers = await runner.list();
    expect(workers.some((w) => w.name === "test-orphan")).toBe(true);
    const reaped = await runner.reapOrphans(["test-orphan"]);
    expect(reaped).toEqual([]);
    const reaped2 = await runner.reapOrphans([]);
    expect(reaped2).toContain(`${TMUX_PREFIX}test-orphan`);
  });

  itTmux("BUG-0019: never reaps a worker another hub owns", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "ancientvoid-tmux-other-"));
    const other = new TmuxRunner(join(otherDir, "logs"));
    try {
      await other.spawn({ name: "test-foreign", cwd: otherDir, cmd: ["bash", "-c", "sleep 30"] });
      expect((await runner.list()).some((w) => w.name === "test-foreign")).toBe(false);
      const reaped = await runner.reapOrphans([]);
      expect(reaped).not.toContain(`${TMUX_PREFIX}test-foreign`);
      expect((await other.list()).some((w) => w.name === "test-foreign")).toBe(true);
    } finally {
      await other.reapOrphans([]).catch(() => undefined);
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  itTmux("T5.6: a restarted hub adopts a surviving worker and reads on where it stopped", async () => {
    const first = await runner.spawn({
      name: "test-adopt",
      cwd: dir,
      cmd: ["bash", "-c", "echo eins; sleep 0.6; echo zwei; sleep 0.3; exit 4"],
    });
    const before: string[] = [];
    first.onStdout((chunk) => before.push(chunk.trim()));
    const deadline = Date.now() + 3000;
    while (!before.includes("eins") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(before).toEqual(["eins"]);

    // Same log dir → same owner, like the same hub after kill -9.
    const restarted = new TmuxRunner(join(dir, "logs"));
    const adopted = await restarted.adopt("test-adopt");
    expect(adopted).not.toBeNull();
    const after: string[] = [];
    adopted!.onStdout((chunk) => after.push(chunk.trim()));
    const { code } = await adopted!.exited();
    expect(after).toEqual(["zwei"]);
    expect(code).toBe(4);
    expect(await restarted.adopt("gibt-es-nicht")).toBeNull();
  });

  itTmux("BUG-0025: a killed worker reports its exit while other sessions keep the server alive", async () => {
    const keeper = await runner.spawn({ name: "test-keeper", cwd: dir, cmd: ["bash", "-c", "sleep 30"] });
    try {
      const proc = await runner.spawn({ name: "test-killed", cwd: dir, cmd: ["bash", "-c", "sleep 30"] });
      await proc.kill("SIGKILL");
      const outcome = await Promise.race([proc.exited().then(() => "exited"), new Promise((r) => setTimeout(() => r("hung"), 5000))]);
      expect(outcome).toBe("exited");
    } finally {
      await keeper.kill("SIGKILL");
    }
  });

  itTmux("kill terminates a worker", async () => {
    const proc = await runner.spawn({
      name: "test-kill",
      cwd: dir,
      cmd: ["bash", "-c", "sleep 30"],
    });
    await proc.kill("SIGKILL");
    const { code } = await proc.exited();
    expect(code === null || code !== 0).toBe(true);
    const workers = await runner.list();
    expect(workers.some((w) => w.name === "test-kill")).toBe(false);
  });

  // T7.2: JSON-RPC agents (ACP) need a real stdin — no echo, no 4 KB line
  // cut, and a hub restart must not close it.
  itTmux("pipe mode: long lines arrive whole, nothing is echoed, a new writer after adopt still reaches the worker", async () => {
    const echo = "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);console.log('len='+l.length+' tail='+l.slice(-5));if(l==='quit')process.exit(0);}})";
    const proc = await runner.spawn({ name: "test-pipe", cwd: dir, cmd: [process.execPath, "-e", echo], stdin: "pipe" });
    const lines: string[] = [];
    proc.onStdout((c) => lines.push(...c.split("\n").map((l) => l.trim()).filter(Boolean)));
    const long = "x".repeat(10_000) + "ENDE1";
    proc.write(long + "\n");
    await waitUntil(() => lines.some((l) => l === "len=10005 tail=ENDE1"));
    expect(lines.some((l) => l.includes("xxxxxxxxxx"))).toBe(false); // no echo of the input
    // the hub restarts: a second runner adopts the pane and writes on
    const next = new TmuxRunner(join(dir, "logs"));
    const adopted = await next.adopt("test-pipe");
    expect(adopted).not.toBeNull();
    const after: string[] = [];
    adopted!.onStdout((c) => after.push(...c.split("\n").map((l) => l.trim()).filter(Boolean)));
    adopted!.write("zweiter\n");
    await waitUntil(() => after.some((l) => l === "len=7 tail=eiter"));
    adopted!.write("quit\n");
    expect((await adopted!.exited()).code).toBe(0);
  });

  // T17.5 (AC-P17-4), BUG-0012-Muster: reserved marker keys fail loudly
  // before tmux is ever touched; marker values are validated as hub ids.
  // Runs without itTmux for the same reason as C-1 above.
  it("rejects reserved ANCIENTVOID_* marker keys and non-id marker values without touching tmux", async () => {
    const sentinel = join(dir, "pwned-marker");
    await expect(
      runner.spawn({
        name: "test-marker-inject",
        cwd: dir,
        cmd: ["true"],
        env: { ANCIENTVOID_SESSION_ID: `$(touch ${sentinel})` },
      }),
    ).rejects.toThrow(/reserved for hub markers/);
    await expect(stat(sentinel)).rejects.toThrow();
    await expect(runner.spawn({ name: "t", sessionId: "bad;value", cwd: dir, cmd: ["true"] })).rejects.toThrow(
      /not a hub-internal id/,
    );
  });

  itTmux("T17.5: spawn sets @ancientvoid_session/@ancientvoid_worker and the pane process sees ANCIENTVOID_* env", async () => {
    const proc = await runner.spawn({
      name: "11111111-marker",
      sessionId: "11111111-marker",
      cwd: dir,
      cmd: ["bash", "-c", "echo S=$ANCIENTVOID_SESSION_ID W=$ANCIENTVOID_WORKER_ID; sleep 5"],
    });
    const lines: string[] = [];
    proc.onStdout((c) => lines.push(...c.split("\n").map((l) => l.trim()).filter(Boolean)));
    await waitUntil(() => lines.some((l) => l.startsWith("S=")));
    // list() BEFORE the exit: track() kills the remained pane once the
    // process is done — the marker must be readable while the worker lives.
    const listed = (await runner.list()).find((w) => w.name === "11111111-marker");
    expect(listed?.sessionId).toBe("11111111-marker");
    expect(listed?.workerId).toMatch(/^[0-9a-f-]{36}$/); // randomUUID, never user input
    expect(lines.find((l) => l.startsWith("S="))).toBe(`S=11111111-marker W=${listed?.workerId}`);
    await proc.kill("SIGKILL");
    await proc.exited();
  });

  itTmux("T17.6: adopt finds a renamed worker via the marker; without marker it falls back by name, loudly", async () => {
    await runner.spawn({ name: "22222222-adopt", sessionId: "22222222-adopt", cwd: dir, cmd: ["bash", "-c", "sleep 5"] });
    await tmux0(["rename-session", "-t", `${TMUX_PREFIX}22222222-adopt`, `${TMUX_PREFIX}22222222-renamed`]);
    const warns: string[] = [];
    const restart = new TmuxRunner(join(dir, "logs"), undefined, (level, msg) => {
      if (level === "warn") warns.push(msg);
    });
    const adopted = await restart.adopt("22222222-adopt"); // name heuristic alone would fail
    expect(adopted).not.toBeNull();
    expect(warns).toEqual([]);
    await adopted!.kill("SIGKILL");

    await runner.spawn({ name: "33333333-old", cwd: dir, cmd: ["bash", "-c", "sleep 5"] });
    await tmux0(["set-option", "-t", `${TMUX_PREFIX}33333333-old`, "-u", "@ancientvoid_session"]); // simulate a pre-T17.5 worker
    const byName = await restart.adopt("33333333-old");
    expect(byName).not.toBeNull();
    expect(warns.some((m) => m.includes("name heuristic"))).toBe(true); // fallback is logged, never silent
    await byName!.kill("SIGKILL");
  });

  // BUG-0157: Ein alter Handle darf einen Nachfolger unter demselben
  // Sessionnamen nie beenden — Steuerung zielt auf die Pane-ID der eigenen
  // Generation, das Exit-Cleanup prüft Pane-Zugehörigkeit vor kill-session.
  itTmux("an old worker handle cannot terminate a successor with the same session name", async () => {
    const first = await runner.spawn({ name: "gen-race", cwd: dir, cmd: ["sleep", "30"] });
    await first.kill("SIGTERM");
    await first.exited();
    // Nachfolger-Generation unter demselben Namen.
    const second = await runner.spawn({ name: "gen-race", cwd: dir, cmd: ["sleep", "30"] });
    // Alter Handle killt erneut (z. B. verspätetes Cleanup im Fehlerpfad).
    await first.kill("SIGKILL");
    await first.kill("SIGTERM").catch(() => undefined);
    const listed = await runner.list();
    expect(listed.some((w) => w.fullName === `${TMUX_PREFIX}gen-race`)).toBe(true);
    // … und der Nachfolger läuft wirklich noch (Pane lebt, kein Exit-Feuer).
    let secondExited = false;
    second.onExit(() => (secondExited = true));
    await new Promise((r) => setTimeout(r, 500));
    expect(secondExited).toBe(false);
    await second.kill("SIGTERM");
    await second.exited();
  });
});

/** T17.6: rename/set-option from the test side — execTmux is private, tests
 * must not widen the prod API. */
function tmux0(args: string[]): Promise<void> {
  return new Promise((res, rej) => spawn("tmux", args, { stdio: "ignore" }).on("close", () => res()).on("error", rej));
}

async function waitUntil(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

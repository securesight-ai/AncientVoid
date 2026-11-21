import { afterEach, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFileSync } from "node:child_process";
import { HubDatabase, WorktreeManager } from "@ancientvoid/core";
import { TmuxRunner } from "@ancientvoid/workers";
import { cwdInside, runWorktrees } from "../src/worktrees.ts";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

const git = promisify(execFile);

// top-level await is only legal at module level (ADR-0002 skip pattern)
const hasTmux = (await new TmuxRunner(join(tmpdir(), "probe")).isAvailable()).valueOf();
const itTmux = hasTmux ? it : it.skip;

describe("hubctl worktrees (EPIC-P14 T14.2/T14.3)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("cwdInside sees a process whose cwd is inside the directory, and not after it exits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-cwd-"));
    dirs.push(dir);
    await mkdir(join(dir, "sub"));
    expect(await cwdInside(dir)).toBe(false);
    const child = spawn("sleep", ["30"], { cwd: join(dir, "sub") });
    try {
      expect(await cwdInside(dir)).toBe(true);
    } finally {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    expect(await cwdInside(dir)).toBe(false);
  });

  it("cwdInside fails safe: an unreadable /proc means 'in use'", async () => {
    expect(await cwdInside("/tmp/x", "/nonexistent-proc")).toBe(true);
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-wtctl-"));
    dirs.push(root);
    const repo = join(root, "repo");
    await mkdir(repo);
    await git("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await git("git", ["-C", repo, "config", "user.email", "t@ancientvoid.local"]);
    await git("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repo, "a.txt"), "hi\n");
    await git("git", ["-C", repo, "add", "a.txt"]);
    await git("git", ["-C", repo, "commit", "-q", "-m", "initial"]);
    const dbPath = join(root, "hub.db");
    const db = new HubDatabase(dbPath);
    const worktrees = new WorktreeManager(join(root, "worktrees"));
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string; notnull: number; dflt_value: unknown }[];
    const add = async (id: string, status: string, archived: number) => {
      const created = await worktrees.create(id, repo);
      const values: Record<string, unknown> = { id, adapter: "dummy", project: repo, status, archived, worktree_sha: created!.baseSha };
      for (const c of columns) if (c.notnull && c.dflt_value === null && !(c.name in values)) values[c.name] = typeof c.dflt_value === "number" ? 0 : "x";
      const names = Object.keys(values);
      db.prepare(`INSERT INTO sessions (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...(Object.values(values) as never[]));
    };
    return { dbPath, worktrees, add };
  }

  it("list shows state, prune is a dry run by default and --apply removes only clean ones", async () => {
    const { dbPath, worktrees, add } = await fixture();
    await add("aaaaaaaa-clean", "idle", 1);
    await add("bbbbbbbb-work", "idle", 1);
    await writeFile(join(worktrees.pathFor("bbbbbbbb-work"), "x.txt"), "arbeit\n");
    await add("cccccccc-live", "working", 0);

    const out: string[] = [];
    await runWorktrees(["--db", dbPath], (t) => out.push(t));
    expect(out.join("\n")).toContain("aaaaaaaa");
    expect(out.join("\n")).toMatch(/bbbbbbbb.*work.*Arbeit — bleibt/);
    expect(out.at(-1)).toMatch(/3 Worktrees.*entfernbar: 1/);

    out.length = 0;
    await runWorktrees(["prune", "--db", dbPath], (t) => out.push(t));
    expect(out.join("\n")).toContain("würde entfernen");
    expect(existsSync(worktrees.pathFor("aaaaaaaa-clean"))).toBe(true);

    out.length = 0;
    await runWorktrees(["prune", "--apply", "--db", dbPath], (t) => out.push(t));
    expect(existsSync(worktrees.pathFor("aaaaaaaa-clean"))).toBe(false);
    expect(existsSync(join(worktrees.pathFor("bbbbbbbb-work"), "x.txt"))).toBe(true);
    expect(existsSync(worktrees.pathFor("cccccccc-live"))).toBe(true);
  });

  // T17.6 (ADR-0037): the marker is prune's primary in-use signal — exact
  // session identity even when the pane process has left the worktree
  // (cwdInside alone would not see it). Skips visibly without tmux.
  itTmux("prune keeps a worktree whose live worker is only identifiable by the marker (T17.6)", async () => {
    const { dbPath, worktrees, add } = await fixture();
    await add("dddddddd-marker", "idle", 1); // archived + clean → prunable without protection
    const path = worktrees.pathFor("dddddddd-marker");
    execFileSync("tmux", ["new-session", "-d", "-s", "ancientvoid-dddddddd-marker", "-c", path, "bash", "-c", "cd /; sleep 30"], { stdio: "ignore" });
    execFileSync("tmux", ["set-option", "-t", "ancientvoid-dddddddd-marker", "@ancientvoid_session", "dddddddd-marker"], { stdio: "ignore" });
    try {
      const out: string[] = [];
      await runWorktrees(["prune", "--apply", "--db", dbPath], (t) => out.push(t));
      expect(existsSync(path)).toBe(true); // the marker holds the worktree
      expect(out.join("\n")).toContain("Prozess aktiv — bleibt"); // listed as protected
      expect(out.filter((l) => l.startsWith("entfernt")).some((l) => l.includes("dddddddd"))).toBe(false); // never removed
    } finally {
      execFileSync("tmux", ["kill-session", "-t", "ancientvoid-dddddddd-marker"], { stdio: "ignore" });
    }
    const out: string[] = [];
    await runWorktrees(["prune", "--apply", "--db", dbPath], (t) => out.push(t));
    expect(existsSync(path)).toBe(false); // worker gone → removable
  });

  itTmux("the cwd fallback stays and is visibly flagged (T17.6)", async () => {
    const { dbPath, worktrees, add } = await fixture();
    await add("eeeeeeee-heur", "idle", 1);
    const child = spawn("sleep", ["30"], { cwd: worktrees.pathFor("eeeeeeee-heur") }); // no marker
    try {
      const out: string[] = [];
      await runWorktrees(["list", "--db", dbPath], (t) => out.push(t));
      expect(out.join("\n")).toContain("cwd-Heuristik");
    } finally {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
  });
});

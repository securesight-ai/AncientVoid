import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { EventStore, HubDatabase } from "@ancientvoid/core";
import { createBackup, pruneBackups, restoreBackup } from "../src/backup.ts";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

// ADR-0002-Muster: ohne tmux sichtbar übersprungen, nie als Pass gezählt.
const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

describe("hubctl encrypted backup and restore (T12.3)", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-backup-"));
    const source = join(root, "data");
    const output = join(root, "full.ancientvoidbak");
    const restore = join(root, "restored");
    const key = join(root, "backup.key");
    const config = join(root, "hub.config.json");
    const configOut = join(root, "restored-config.json");
    await mkdir(source, { mode: 0o700 });
    await writeFile(key, "correct horse battery staple\n", { mode: 0o600 });
    await writeFile(config, JSON.stringify({ dataDir: source, server: { host: "127.0.0.1", port: 7373 } }));
    const db = new HubDatabase(join(source, "hub.db"));
    const bytes = Buffer.from("attachment bytes");
    const attachmentId = createHash("sha256").update(bytes).digest("hex");
    await mkdir(join(source, "attachments"), { recursive: true });
    await writeFile(join(source, "attachments", attachmentId), bytes);
    await writeFile(join(source, "attachments", `${attachmentId}.txt`), "extracted words");
    db.prepare("INSERT INTO attachments (id,name,mime_type,bytes,kind,created_at,extraction) VALUES (?,?,?,?,?,?,?)")
      .run(attachmentId, "proof.txt", "text/plain", bytes.length, "text", "2026-09-24T00:00:00.000Z", JSON.stringify({ status: "done", method: "text", chars: 15, error: null }));
    db.prepare("INSERT INTO drafts (session_id,text,attachment_ids,revision,updated_at,device) VALUES (?,?,?,?,?,?)")
      .run("s_test", "unfinished prompt", JSON.stringify([attachmentId]), 3, "2026-09-24T00:00:00.000Z", "pixel");
    db.prepare("INSERT INTO fleet_peers (host_id,url,token,protocol_version,paired_at) VALUES (?,?,?,?,?)")
      .run("remote", "https://remote.invalid", "sensitive-peer-token", 1, "2026-09-24T00:00:00.000Z");
    db.prepare("INSERT INTO desktop_actions (id,companion,created_at,state,text) VALUES (?,?,?,?,?)")
      .run("d_pending", "pc", "2026-09-24T00:00:00.000Z", JSON.stringify({ id: "d_pending", status: "pending" }), "pending private text");
    const store = new EventStore(source);
    const payload = Buffer.from("large event payload");
    const hash = createHash("sha256").update(payload).digest("hex");
    await store.initSession("s_test");
    await writeFile(join(source, "sessions", "s_test", "blobs", hash), payload);
    await writeFile(join(source, "sessions", "s_test", "events.jsonl"), `${JSON.stringify({ seq: 1, blobRef: `sha256:${hash}` })}\n`);
    await writeFile(join(source, "sessions", "s_test", "snapshot.json"), JSON.stringify({ sessionId: "s_test", seq: 1 }));
    await mkdir(join(source, "media", "job-1"), { recursive: true });
    await writeFile(join(source, "media", "job-1", "result.json"), "media result");
    await mkdir(join(source, "workers", "s_test"), { recursive: true });
    await writeFile(join(source, "workers", "s_test", "worker.log"), "worker log");
    await mkdir(join(source, "worktrees", "s_test"), { recursive: true });
    await writeFile(join(source, "worktrees", "s_test", "work.txt"), "worktree state");
    await store.flush();
    db.close();
    return { source, output, restore, key, config, configOut, attachmentId, payload, hash };
  }

  it("restores SQLite metadata, attachments, media, workers, worktrees, JSONL, snapshots and blobs", async () => {
    const f = await fixture();
    await createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key });
    await restoreBackup({ archiveFile: f.output, targetDir: f.restore, configOut: f.configOut, keyFile: f.key });

    const db = new HubDatabase(join(f.restore, "hub.db"));
    expect(db.prepare("SELECT text, attachment_ids FROM drafts WHERE session_id = ?").get("s_test"))
      .toMatchObject({ text: "unfinished prompt", attachment_ids: JSON.stringify([f.attachmentId]) });
    expect(db.prepare("SELECT token FROM fleet_peers WHERE host_id = ?").get("remote"))
      .toMatchObject({ token: "sensitive-peer-token" });
    expect(db.prepare("SELECT text FROM desktop_actions WHERE id = ?").get("d_pending"))
      .toMatchObject({ text: "pending private text" });
    db.close();
    expect(await readFile(join(f.restore, "attachments", f.attachmentId))).toEqual(Buffer.from("attachment bytes"));
    expect(await readFile(join(f.restore, "attachments", `${f.attachmentId}.txt`), "utf8")).toBe("extracted words");
    expect(await readFile(join(f.restore, "sessions", "s_test", "blobs", f.hash))).toEqual(f.payload);
    expect(await readFile(join(f.restore, "sessions", "s_test", "events.jsonl"), "utf8")).toContain(`sha256:${f.hash}`);
    expect(await readFile(join(f.restore, "sessions", "s_test", "snapshot.json"), "utf8")).toContain('"seq":1');
    expect(await readFile(join(f.restore, "media", "job-1", "result.json"), "utf8")).toBe("media result");
    expect(await readFile(join(f.restore, "workers", "s_test", "worker.log"), "utf8")).toBe("worker log");
    expect(await readFile(join(f.restore, "worktrees", "s_test", "work.txt"), "utf8")).toBe("worktree state");
    expect(JSON.parse(await readFile(f.configOut, "utf8"))).toMatchObject({ dataDir: f.restore });
    await expect(readFile(join(f.restore, ".ancientvoid-hub.pid"))).rejects.toThrow();
  });

  it("publishes the restored datadir and SQLite database with private permissions", async () => {
    const f = await fixture();
    await createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key });
    await restoreBackup({ archiveFile: f.output, targetDir: f.restore, configOut: f.configOut, keyFile: f.key });

    expect((await stat(f.restore)).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.restore, "hub.db"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(f.restore, "sessions"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.restore, "sessions", "s_test", "events.jsonl"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(f.restore, "attachments", f.attachmentId))).mode & 0o777).toBe(0o600);
  });

  it("rejects a wrong key and leaves no partial restore directory", async () => {
    const f = await fixture();
    await createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key });
    const wrongKey = join(root, "wrong.key");
    await writeFile(wrongKey, "this is a wrong backup key\n", { mode: 0o600 });
    await expect(restoreBackup({ archiveFile: f.output, targetDir: f.restore, configOut: f.configOut, keyFile: wrongKey })).rejects.toThrow();
    await expect(readFile(join(f.restore, "hub.db"))).rejects.toThrow();
  });

  it("encrypts secrets and refuses to overwrite an existing archive", async () => {
    const f = await fixture();
    await createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key });
    const archive = await readFile(f.output);
    expect(archive.includes(Buffer.from("sensitive-peer-token"))).toBe(false);
    await expect(createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key }))
      .rejects.toThrow("existiert bereits");
  });

  it("does not back up a live hub", async () => {
    const f = await fixture();
    await writeFile(join(f.source, ".ancientvoid-hub.pid"), `${process.pid}\n`);
    await expect(createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key }))
      .rejects.toThrow("Hub läuft noch");
  });

  it("rejects modified ciphertext without publishing data or config", async () => {
    const f = await fixture();
    await createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key });
    const archive = await readFile(f.output);
    archive[40] = archive[40]! ^ 0xff;
    await writeFile(f.output, archive);
    await expect(restoreBackup({ archiveFile: f.output, targetDir: f.restore, configOut: f.configOut, keyFile: f.key }))
      .rejects.toThrow();
    await expect(readFile(join(f.restore, "hub.db"))).rejects.toThrow();
    await expect(readFile(f.configOut)).rejects.toThrow();
  });

  it.skipIf(!hasTmux)("refuses an active tmux worker owned by this datadir", async () => {
    const f = await fixture();
    const socketDir = join(root, "tmux-socket");
    await mkdir(socketDir);
    const previousSocketDir = process.env.TMUX_TMPDIR;
    const previousTmux = process.env.TMUX;
    process.env.TMUX_TMPDIR = socketDir;
    delete process.env.TMUX;
    try {
      execFileSync("tmux", ["new-session", "-d", "-s", "ancientvoid-backup-test", "sleep", "60"]);
      const owner = createHash("sha256").update(resolve(f.source, "workers")).digest("hex").slice(0, 16);
      execFileSync("tmux", ["set-option", "-t", "ancientvoid-backup-test", "@ancientvoid_owner", owner]);
      await expect(createBackup({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key }))
        .rejects.toThrow("tmux-Worker dieses Hubs läuft noch");
    } finally {
      execFileSync("tmux", ["kill-server"], { stdio: "ignore" });
      if (previousSocketDir === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = previousSocketDir;
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
    }
  });

  it("previews backup retention and deletes only beyond the explicit keep count", async () => {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-backup-retention-"));
    const archiveDir = join(root, "archives");
    await mkdir(archiveDir);
    for (let i = 0; i < 3; i++) {
      const path = join(archiveDir, `backup-${i}.ancientvoidbak`);
      await writeFile(path, `archive ${i}`);
      const time = new Date(Date.UTC(2026, 0, i + 1));
      await utimes(path, time, time);
    }
    const preview = await pruneBackups({ directory: archiveDir, keep: 1 });
    expect(preview.map((path) => path.split("/").at(-1))).toEqual(["backup-0.ancientvoidbak", "backup-1.ancientvoidbak"]);
    expect(await readdir(archiveDir)).toHaveLength(3);
    const removed = await pruneBackups({ directory: archiveDir, keep: 1, apply: true });
    expect(removed).toEqual(preview);
    expect(await readdir(archiveDir)).toEqual(["backup-2.ancientvoidbak"]);
  });

  it("cleans the partial archive when the destination refuses further writes", async () => {
    const f = await fixture();
    const script = join(root, "limited-backup.mjs");
    await writeFile(script, [
      'process.on("SIGXFSZ", () => {});',
      'const { createBackup } = await import(process.env.BACKUP_MODULE);',
      'await createBackup(JSON.parse(process.env.BACKUP_OPTIONS));',
    ].join("\n"));
    expect(() => execFileSync("bash", ["-c", 'ulimit -f 4; exec "$NODE_BIN" "$SCRIPT_FILE"'], {
      env: {
        ...process.env,
        NODE_BIN: process.execPath,
        SCRIPT_FILE: script,
        BACKUP_MODULE: new URL("../src/backup.ts", import.meta.url).href,
        BACKUP_OPTIONS: JSON.stringify({ dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key }),
      },
      stdio: "pipe",
    })).toThrow();
    await expect(readFile(f.output)).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(".ancientvoid-backup-"))).toEqual([]);
    await expect(readFile(join(f.source, ".ancientvoid-hub.pid"))).rejects.toThrow();
  });

  it("cleans the partial archive when the output filesystem reports ENOSPC", async () => {
    const f = await fixture();
    const noSpace = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    await expect(createBackup(
      { dataDir: f.source, configFile: f.config, outputFile: f.output, keyFile: f.key },
      () => new Writable({ write(_chunk, _encoding, callback) { callback(noSpace); } }),
    )).rejects.toMatchObject({ code: "ENOSPC" });
    await expect(readFile(f.output)).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(".ancientvoid-backup-"))).toEqual([]);
    await expect(readFile(join(f.source, ".ancientvoid-hub.pid"))).rejects.toThrow();
  });
});

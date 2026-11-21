import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readlink, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { acquireBackupLock, HubDatabase } from "@ancientvoid/core";
import { t } from "./i18n/index.ts";

/** Eigene Fehlerklasse für sprachvariablen Text: die catch-Weiche prüft Instanzen
 * statt Katalogtexte (EPIC-P61 — Meldungen sind sprachvariabel). */
class BackupLogicError extends Error {}

const MAGIC = Buffer.from("AncientVoidBK01", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const KEY_BYTES = 32;

export interface CreateBackupOptions {
  dataDir: string;
  configFile: string;
  outputFile: string;
  keyFile: string;
}

export interface RestoreBackupOptions {
  archiveFile: string;
  targetDir: string;
  configOut: string;
  keyFile: string;
}

export interface PruneBackupsOptions {
  directory: string;
  keep: number;
  apply?: boolean;
}

async function backupKey(file: string): Promise<Buffer> {
  const path = resolve(file);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(t("bk_key_regular"));
  if ((info.mode & 0o077) !== 0) throw new Error(t("bk_key_not_private"));
  const passphrase = (await readFile(path, "utf8")).trim();
  if (Buffer.byteLength(passphrase) < 16) throw new Error(t("bk_key_min_bytes"));
  return Buffer.from(passphrase, "utf8");
}

async function deriveKey(passphrase: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scryptCallback(passphrase, salt, KEY_BYTES, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolvePromise(Buffer.from(key));
    });
  });
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function validateSourceTree(root: string, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (/[\n\r]/.test(entry.name)) throw new Error(t("bk_no_newline_path", { name: JSON.stringify(entry.name) }));
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path);
      const resolved = resolve(dirname(path), target);
      if (!contains(root, resolved)) throw new Error(t("symlink_out", { rel: relative(root, path), target }));
    } else if (info.isDirectory()) {
      await validateSourceTree(root, path);
    } else if (!info.isFile()) {
      throw new Error(t("only_regular_dirs", { rel: relative(root, path) }));
    }
  }
}

function tar(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const stderr = child.stderr;
    if (!stderr) return reject(new Error(t("tar_stderr_pipe")));
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => { if (err.length < 8000) err += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(t("tar_fail", { cs: String(code ?? signal ?? t("unknown_fallback")), err: err.trim().slice(0, 500) })));
    });
  });
}

function waitForTar(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let err = "";
    const stderr = child.stderr;
    if (!stderr) return reject(new Error(t("tar_stderr_pipe")));
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => { if (err.length < 8000) err += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`tar schlug fehl (${code ?? signal ?? "unbekannt"}): ${err.trim().slice(0, 500)}`)));
  });
}

async function assertHubStopped(dataDir: string, ownsBackupLock = false): Promise<void> {
  const lock = join(dataDir, ".ancientvoid-hub.pid");
  let lockText: string | undefined;
  try {
    lockText = await readFile(lock, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (lockText !== undefined) {
    const text = lockText.trim();
    const match = /^(hub|backup):(\d+)$/.exec(text);
    const pid = /^\d+$/.test(text) ? Number(text) : match ? Number(match[2]) : 0;
    if (ownsBackupLock && match?.[1] === "backup" && pid === process.pid) {
      // This caller holds the shared lock so a new hub cannot start mid-backup.
    } else {
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          throw new BackupLogicError(t("still_running", { a: match?.[1] === "backup" ? t("running_backup") : t("running_hub"), pid }));
        } catch (err) {
          if (err instanceof BackupLogicError) throw err;
          if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw new BackupLogicError(t("pid_lock_uncheckable", { err: String(err) }), { cause: err });
        }
      }
      throw new BackupLogicError(t("stale_pid_lock"));
    }
  }
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await lstat(join(dataDir, `hub.db${suffix}`));
      throw new BackupLogicError(t("hub_db_exists", { suffix }));
    } catch (err) {
      if (err instanceof BackupLogicError) throw err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

async function assertNoActiveWorkers(dataDir: string): Promise<void> {
  const owner = createHash("sha256").update(resolve(dataDir, "workers")).digest("hex").slice(0, 16);
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("tmux", ["list-panes", "-a", "-F", "#{@ancientvoid_owner}|#{pane_dead}"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") resolvePromise({ code: 0, stdout: "", stderr: "" });
      else reject(err);
    });
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
  // tmux 3.5, wenn das Socket-Verzeichnis noch nie angelegt wurde: „error connecting … (No such file or directory)“.
  if (result.code !== 0 && !/no server running|can't connect to server|no such file or directory/i.test(result.stderr)) {
    throw new Error(t("tmux_status_uncheckable", { x: result.stderr.trim() }));
  }
  if (result.stdout.split("\n").some((line) => {
    const [workerOwner, paneDead] = line.split("|");
    return workerOwner === owner && paneDead === "0";
  })) {
    throw new Error(t("tmux_still_running"));
  }
}

function checkedArchiveName(name: string): string {
  const clean = name.replace(/^\.\//, "").replace(/\/$/, "");
  if (!clean || clean === ".") return "";
  if (clean.startsWith("/") || clean.split("/").some((part) => part === ".." || part === "")) throw new Error(t("unsafe_path", { name }));
  if (clean.includes("\0") || /[\n\r]/.test(clean)) throw new Error(t("invalid_path"));
  return clean;
}

async function verifyRestoredTree(dataDir: string): Promise<void> {
  const sessionsDir = join(dataDir, "sessions");
  const attachmentsDir = join(dataDir, "attachments");
  await stat(join(dataDir, "hub.db"));
  await stat(sessionsDir);
  const db = new HubDatabase(join(dataDir, "hub.db"));
  try {
    const check = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== "ok") throw new Error(t("sqlite_integrity", { x: check?.integrity_check ?? t("no_result") }));
    for (const row of db.prepare("SELECT id, bytes FROM attachments").all() as { id: string; bytes: number }[]) {
      if (!/^[a-f0-9]{64}$/.test(row.id)) throw new Error(t("invalid_attachment_id", { id: row.id }));
      const path = join(attachmentsDir, row.id);
      const info = await stat(path);
      if (info.size !== row.bytes || await hashFile(path) !== row.id) throw new Error(t("attachment_missing", { id: row.id }));
    }
    for (const row of db.prepare("SELECT attachment_ids FROM drafts").all() as { attachment_ids: string }[]) {
      const ids = JSON.parse(row.attachment_ids) as unknown;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))) throw new Error(t("invalid_attachment_ref"));
      for (const id of ids) await stat(join(attachmentsDir, id));
    }
  } finally {
    db.close();
  }

  for (const session of await readdir(sessionsDir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const stream = createReadStream(join(sessionsDir, session.name, "events.jsonl"), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      let ev: { blobRef?: unknown };
      try { ev = JSON.parse(line) as { blobRef?: unknown }; }
      catch { continue; } // EventStore recovery deliberately skips a torn line.
      if (typeof ev.blobRef !== "string") continue;
      const match = /^sha256:([a-f0-9]{64})$/.exec(ev.blobRef);
      if (!match) throw new Error(t("unknown_blob_format", { name: session.name }));
      const path = join(sessionsDir, session.name, "blobs", match[1]!);
      if (await hashFile(path) !== match[1]) throw new Error(t("blob_missing", { name: `${session.name}/${match[1]}` }));
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function secureRestoredTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      // Open it for the owner before recursion, even if the archive had mode 000.
      await chmod(path, 0o700);
      await secureRestoredTree(path);
    } else if (entry.isFile()) {
      const info = await lstat(path);
      await chmod(path, info.mode & 0o100 ? 0o700 : 0o600);
    }
  }
  await chmod(root, 0o700);
}

/** The writer seam makes filesystem write failures reproducible without filling a real disk. */
export async function createBackup(options: CreateBackupOptions, outputStream: (path: string) => Writable = (path) => createWriteStream(path, { flags: "a", mode: 0o600 })): Promise<void> {
  const dataDir = resolve(options.dataDir);
  const outputFile = resolve(options.outputFile);
  const configFile = resolve(options.configFile);
  const keyFile = resolve(options.keyFile);
  if (contains(dataDir, outputFile)) throw new Error(t("bk_file_outside"));
  if (contains(dataDir, keyFile)) throw new Error(t("bk_key_outside"));
  if (contains(dataDir, configFile)) throw new Error(t("bk_config_outside"));
  await assertHubStopped(dataDir);
  const releaseBackupLock = await acquireBackupLock(dataDir);
  let tmpDir: string | undefined;
  let key: Buffer | undefined;
  try {
    await assertHubStopped(dataDir, true);
    await assertNoActiveWorkers(dataDir);
    await validateSourceTree(dataDir);
    key = await backupKey(keyFile);
    const config = await readFile(configFile);
    const parent = dirname(outputFile);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    tmpDir = await mkdtemp(join(parent, ".ancientvoid-backup-"));
    const tmpFile = join(tmpDir, "archive.tmp");
    // Config liegt im Staging schon unter ihrem Archivnamen: kein GNU-only
    // --transform, und -C zwischen den Operanden verstehen GNU- und BSD-tar (macOS).
    await mkdir(join(tmpDir, "config"), { mode: 0o700 });
    await writeFile(join(tmpDir, "config", "hub.config.json"), config, { mode: 0o600 });
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const derived = await deriveKey(key, salt);
    const cipher = createCipheriv("aes-256-gcm", derived, iv);
    derived.fill(0);
    await writeFile(tmpFile, Buffer.concat([MAGIC, salt, iv]), { flag: "wx", mode: 0o600 });
    const child = spawn("tar", [
      "--create", "--gzip", "--file", "-",
      "--exclude=./.ancientvoid-hub.pid",
      "-C", dataDir, ".",
      "-C", tmpDir, "config/hub.config.json",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const closed = waitForTar(child);
    const encryptedOutput = outputStream(tmpFile);
    await Promise.all([pipeline(child.stdout!, cipher, encryptedOutput), closed]);
    await writeFile(tmpFile, cipher.getAuthTag(), { flag: "a", mode: 0o600 });
    await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });
    await link(tmpFile, outputFile).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "EEXIST") throw new Error(t("bk_exists", { file: outputFile }));
      throw err;
    });
    await unlink(tmpFile);
  } finally {
    key?.fill(0);
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    await releaseBackupLock();
  }
}

export async function restoreBackup(options: RestoreBackupOptions): Promise<void> {
  const archiveFile = resolve(options.archiveFile);
  const targetDir = resolve(options.targetDir);
  const configOut = resolve(options.configOut);
  const keyFile = resolve(options.keyFile);
  if (contains(targetDir, archiveFile) || contains(targetDir, keyFile) || contains(targetDir, configOut)) throw new Error(t("archive_key_config_outside"));
  await lstat(targetDir).then(() => { throw new Error(t("restore_target_exists", { file: targetDir })); }, (err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw err; });
  await lstat(configOut).then(() => { throw new Error(t("config_target_exists", { file: configOut })); }, (err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw err; });
  const key = await backupKey(keyFile);
  let stagingRoot: string | undefined;
  let configTemp: string | undefined;
  let targetPublished = false;
  let configPublished = false;
  try {
    const size = (await stat(archiveFile)).size;
    if (size <= HEADER_BYTES + TAG_BYTES) throw new Error("Backup-Archiv ist leer oder abgeschnitten.");
    const headerHandle = await open(archiveFile, "r");
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    try {
      await headerHandle.read(header, 0, HEADER_BYTES, 0);
      await headerHandle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    } finally {
      await headerHandle.close();
    }
    const magic = header.subarray(0, MAGIC.length);
    if (!magic.equals(MAGIC)) throw new Error("Unbekanntes Backup-Format.");
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
    const derived = await deriveKey(key, salt);
    const decipher = createDecipheriv("aes-256-gcm", derived, iv);
    derived.fill(0);
    decipher.setAuthTag(tag);
    const parent = dirname(targetDir);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    stagingRoot = await mkdtemp(join(parent, ".ancientvoid-restore-"));
    const tarFile = join(stagingRoot, "archive.tar.gz");
    const extracted = join(stagingRoot, "data");
    const start = HEADER_BYTES;
    const end = size - TAG_BYTES - 1;
    await pipeline(createReadStream(archiveFile, { start, end }), decipher, createWriteStream(tarFile, { flags: "wx", mode: 0o600 }));
    const listing = await listTar(tarFile);
    const names = listing.split("\n").filter(Boolean).map(checkedArchiveName);
    if (!names.includes("hub.db") || !names.some((name) => name === "sessions" || name.startsWith("sessions/")) || !names.includes("config/hub.config.json")) {
      throw new Error(t("backup_missing_core"));
    }
    await mkdir(extracted, { mode: 0o700 });
    await tar(["--extract", "--gzip", "--file", tarFile, "--directory", extracted, "--no-same-owner", "--no-same-permissions"]);
    await verifyRestoredTree(extracted);
    await secureRestoredTree(extracted);
    const configBytes = await readFile(join(extracted, "config", "hub.config.json"));
    const parsed = JSON.parse(configBytes.toString("utf8")) as Record<string, unknown>;
    parsed.dataDir = targetDir;
    configTemp = `${configOut}.${randomBytes(8).toString("hex")}.tmp`;
    await mkdir(dirname(configOut), { recursive: true, mode: 0o700 });
    await writeFile(configTemp, `${JSON.stringify(parsed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(extracted, targetDir);
    targetPublished = true;
    await link(configTemp, configOut);
    configPublished = true;
    await unlink(configTemp);
  } catch (err) {
    if (targetPublished) await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    if (configPublished) await unlink(configOut).catch(() => undefined);
    throw err;
  } finally {
    key.fill(0);
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
    if (configTemp) await unlink(configTemp).catch(() => undefined);
  }
}

/** List old `.ancientvoidbak` archives, deleting only when the caller opts in. */
export async function pruneBackups(options: PruneBackupsOptions): Promise<string[]> {
  if (!Number.isSafeInteger(options.keep) || options.keep < 1) throw new Error("Aufbewahrung muss mindestens 1 Backup betragen.");
  const directory = resolve(options.directory);
  const candidates = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ancientvoidbak")) continue;
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink()) candidates.push({ path, name: entry.name, mtimeMs: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  const toRemove = candidates.slice(options.keep)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
    .map((entry) => entry.path);
  if (options.apply) for (const path of toRemove) await unlink(path);
  return toRemove;
}

function listTar(archive: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("tar", ["--list", "--gzip", "--file", archive], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk: string) => { if (stderr.length < 8000) stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolvePromise(stdout) : reject(new Error(t("bk_read_fail", { cs: String(code ?? signal), err: stderr.trim().slice(0, 500) }))));
  });
}

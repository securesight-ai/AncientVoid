import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DEVICE_SETUP_DOWNLOAD_TIMEOUT_MS,
  DEVICE_SETUP_JDK_URL,
  DEVICE_SETUP_PACKAGES,
  DEVICE_SETUP_STEP_TIMEOUT_MS,
  DEVICE_SETUP_TAIL_MAX_CHARS,
  DEVICE_SETUP_TOOLS_URL,
  type DeviceSetupPhase,
  type DeviceSetupStatus,
} from "@ancientvoid/contracts";
import type { DeviceExec } from "./device-shared.ts";
import { maskDeviceLog } from "./device-shared.ts";

/**
 * In-App-Setup der Android-Testgeräte (2026-11-24): JDK, cmdline-tools,
 * Lizenzen und Pakete — der komplette Simulator-Setup-Ablauf läuft über die
 * Hub-Routen in der PWA, ohne manuelle CLI-Schritte. Phasen sind fest
 * (keine freien Shell-Strings), Downloads nur auf ausdrücklichen Start
 * (EPIC-P42 §2). Der Zustand faltet aus setup.jsonl (K7): ein `running`
 * ohne lebenden Prozess wird nach Neustart `failed`, nie automatisch
 * fortgesetzt. Der Log-Schwanz ist gekappt (K5) und maskiert.
 */

const now = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type SetupState = "idle" | "running" | "done" | "failed";

interface SetupJournalRecord {
  t: "state" | "done";
  at: string;
  state?: SetupState;
  phase?: DeviceSetupPhase | "none";
  sdkRoot?: string | null;
  jdkHome?: string | null;
  reason?: string | null;
}

export interface DeviceSetupOptions {
  /** `<dataDir>/devices` des DeviceService — Journal und Vorschlag wohnen dort. */
  dataDir: string;
  exec: DeviceExec;
  /** Testnaht: Download-Ziel schreiben statt Netz (Produktion: Node-fetch-Stream). */
  download?: (url: string, dest: string, timeoutMs: number) => Promise<void>;
  jdkUrl?: string;
  toolsUrl?: string;
  packages?: readonly string[];
  /** Nach erfolgreichem Setup übernimmt der Service die SDK-Wurzel. */
  onReady: (sdkRoot: string, jdkHome: string | null) => void;
}

/** Letzter `done`-Eintrag des Setup-Journals — K7-Fallback für die SDK-Wurzel nach Neustart. */
export function readConfiguredSdkRoot(dataDir: string): string | null {
  let sdk: string | null = null;
  for (const rec of readJournal(join(dataDir, "setup.jsonl"))) {
    if (rec.t === "done" && typeof rec.sdkRoot === "string") sdk = rec.sdkRoot;
  }
  return sdk;
}

function readJournal(file: string): SetupJournalRecord[] {
  if (!existsSync(file)) return [];
  const out: SetupJournalRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SetupJournalRecord);
    } catch {
      // beschädigte Zeile überspringen — Rest bleibt lesbar
    }
  }
  return out;
}

/** Lokale Spiegel (file://) ohne Netz; http(s) über fetch mit Frist. */
async function nodeDownload(url: string, dest: string, timeoutMs: number): Promise<void> {
  if (url.startsWith("file:")) {
    await copyFile(fileURLToPath(url), dest);
    return;
  }
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen: HTTP ${res.status} von ${url}`);
  await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream), createWriteStream(dest));
}

/** Einziges Unterverzeichnis (Archiv mit einer Wurzel) — null bei keiner/mehreren Wurzeln. */
function findSingleDir(root: string): string | null {
  const entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries.length === 1 ? join(root, entries[0]!.name) : null;
}

export class DeviceSetup {
  private readonly dataDir: string;
  private readonly exec: DeviceExec;
  private readonly download: (url: string, dest: string, timeoutMs: number) => Promise<void>;
  private readonly jdkUrl: string;
  private readonly toolsUrl: string;
  private readonly packages: readonly string[];
  private readonly onReady: (sdkRoot: string, jdkHome: string | null) => void;
  private state: SetupState = "idle";
  private phase: DeviceSetupPhase | "none" = "none";
  private sdkRoot: string | null = null;
  private startedAt: string | null = null;
  private updatedAt = now();
  private reason: string | null = null;
  private tail = "";

  constructor(opts: DeviceSetupOptions) {
    this.dataDir = opts.dataDir;
    this.exec = opts.exec;
    this.download = opts.download ?? nodeDownload;
    this.jdkUrl = opts.jdkUrl ?? DEVICE_SETUP_JDK_URL;
    this.toolsUrl = opts.toolsUrl ?? DEVICE_SETUP_TOOLS_URL;
    this.packages = opts.packages ?? DEVICE_SETUP_PACKAGES;
    this.onReady = opts.onReady;
    this.recover();
  }

  private journalFile(): string {
    return join(this.dataDir, "setup.jsonl");
  }

  private journal(rec: SetupJournalRecord): void {
    appendFileSync(this.journalFile(), `${JSON.stringify(rec)}\n`);
  }

  /** K7: Stand aus dem Journal falten; `running` ohne lebenden Lauf → failed (nie fortsetzen). */
  private recover(): void {
    for (const rec of readJournal(this.journalFile())) {
      if (rec.t === "done") {
        this.state = "done";
        this.phase = "packages";
        this.sdkRoot = rec.sdkRoot ?? null;
        this.updatedAt = rec.at;
        continue;
      }
      if (rec.state) this.state = rec.state;
      if (rec.phase) this.phase = rec.phase;
      if (rec.sdkRoot !== undefined) this.sdkRoot = rec.sdkRoot;
      if (rec.reason !== undefined) this.reason = rec.reason;
      this.updatedAt = rec.at;
    }
    if (this.state === "running") {
      this.state = "failed";
      this.reason = "Setup wurde durch einen Hub-Neustart abgebrochen — erneut starten.";
      this.updatedAt = now();
      this.journal({ t: "state", at: this.updatedAt, state: "failed", phase: this.phase, sdkRoot: this.sdkRoot, reason: this.reason });
    }
  }

  status(): DeviceSetupStatus {
    return {
      state: this.state,
      phase: this.phase,
      sdkRoot: this.sdkRoot,
      suggestedSdkRoot: join(this.dataDir, "android-sdk"),
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      reason: this.reason,
      tail: this.tail.slice(-DEVICE_SETUP_TAIL_MAX_CHARS),
    };
  }

  private note(text: string): void {
    const stamp = maskDeviceLog(text.trim());
    if (!stamp) return;
    this.tail = `${this.tail}${stamp}\n`.slice(-DEVICE_SETUP_TAIL_MAX_CHARS * 2);
    this.updatedAt = now();
  }

  private set(state: SetupState, phase: DeviceSetupPhase | "none", reason: string | null = null): void {
    this.state = state;
    this.phase = phase;
    this.reason = reason;
    this.updatedAt = now();
    this.journal({ t: "state", at: this.updatedAt, state, phase, sdkRoot: this.sdkRoot, reason });
  }

  private async run(argv: string[], opts: { timeoutMs: number; env?: Record<string, string>; stdin?: string }, what: string): Promise<Buffer> {
    const res = await this.exec.run(argv, opts);
    this.note(`${what}: ${res.stdout.toString("utf8")}`);
    this.note(`${what}: ${res.stderr.trim()}`);
    if (res.code !== 0) throw new Error(`${what} fehlgeschlagen (Exit ${res.code}): ${clip(res.stderr.trim() || res.stdout.toString("utf8"), 400)}`);
    return res.stdout;
  }

  /** Setup starten. Läuft bereits eines → `started: false` (Route mappt auf 409). */
  async start(sdkRootRaw: string): Promise<{ started: boolean; status: DeviceSetupStatus }> {
    if (this.state === "running") return { started: false, status: this.status() };
    const sdkRoot = resolve(sdkRootRaw);
    if (!sdkRoot.startsWith("/")) return { started: false, status: { ...this.status(), reason: "Absoluter Zielordner erforderlich." } };
    this.sdkRoot = sdkRoot;
    this.startedAt = now();
    this.tail = "";
    this.reason = null;
    this.set("running", "jdk");
    void this.runAll(sdkRoot).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.note(`FEHLER: ${reason}`);
      this.set("failed", this.phase, clip(reason, 500));
    });
    return { started: true, status: this.status() };
  }

  private async runAll(sdkRoot: string): Promise<void> {
    const jdkHome = await this.phaseJdk(sdkRoot);
    const sdkmanager = await this.phaseTools(sdkRoot);
    const env = jdkHome ? { JAVA_HOME: jdkHome, PATH: `${join(jdkHome, "bin")}:${process.env.PATH ?? ""}` } : {};
    const answers = "y\n".repeat(50);
    this.set("running", "licenses");
    await this.run([sdkmanager, `--sdk_root=${sdkRoot}`, "--licenses"], { timeoutMs: DEVICE_SETUP_STEP_TIMEOUT_MS, env, stdin: answers }, "Lizenzen");
    this.set("running", "packages");
    await this.run([sdkmanager, `--sdk_root=${sdkRoot}`, ...this.packages], { timeoutMs: DEVICE_SETUP_STEP_TIMEOUT_MS, env, stdin: answers }, "Pakete");
    this.state = "done";
    this.phase = "packages";
    this.updatedAt = now();
    this.journal({ t: "done", at: this.updatedAt, sdkRoot, jdkHome });
    this.onReady(sdkRoot, jdkHome);
  }

  /** Java vorhanden → überspringen (null); sonst Temurin-JDK nach <sdkRoot>/.av-setup entpacken. */
  private async phaseJdk(sdkRoot: string): Promise<string | null> {
    this.set("running", "jdk");
    const probe = await this.exec.run(["java", "-version"], { timeoutMs: 10_000 });
    if (probe.code === 0) {
      this.note("JDK: System-Java vorhanden — Überspringen.");
      return null;
    }
    const work = join(sdkRoot, ".av-setup");
    rmSync(work, { recursive: true, force: true });
    const tar = join(work, "jdk.tar.gz");
    const extract = join(work, "jdk");
    mkdirSync(extract, { recursive: true });
    this.note(`JDK: Download ${this.jdkUrl}`);
    await this.download(this.jdkUrl, tar, DEVICE_SETUP_DOWNLOAD_TIMEOUT_MS);
    await this.run(["tar", "-xf", tar, "-C", extract], { timeoutMs: 600_000 }, "JDK entpacken");
    const home = findSingleDir(extract);
    if (!home || !existsSync(join(home, "bin", "java"))) throw new Error("JDK-Archiv enthält kein bin/java — Quelle prüfen.");
    const check = await this.exec.run([join(home, "bin", "java"), "-version"], { timeoutMs: 15_000 });
    if (check.code !== 0) throw new Error(`Entpacktes Java läuft nicht: ${clip(check.stderr.trim(), 200)}`);
    this.note("JDK: entpackt und lauffähig.");
    return home;
  }

  /** cmdline-tools vorhanden → überspringen; sonst Zip entpacken nach <sdkRoot>/cmdline-tools/latest. */
  private async phaseTools(sdkRoot: string): Promise<string> {
    this.set("running", "tools");
    const sdkmanager = join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
    if (existsSync(sdkmanager)) {
      this.note("Tools: sdkmanager vorhanden — Überspringen.");
      return sdkmanager;
    }
    const work = join(sdkRoot, ".av-setup");
    const zip = join(work, "tools.zip");
    const extract = join(work, "tools");
    mkdirSync(extract, { recursive: true });
    this.note(`Tools: Download ${this.toolsUrl}`);
    await this.download(this.toolsUrl, zip, DEVICE_SETUP_DOWNLOAD_TIMEOUT_MS);
    await this.run(["unzip", "-q", zip, "-d", extract], { timeoutMs: 300_000 }, "Tools entpacken");
    const inner = findSingleDir(extract);
    if (!inner || !existsSync(join(inner, "bin", "sdkmanager"))) throw new Error("Tools-Archiv enthält kein bin/sdkmanager — Quelle prüfen.");
    const target = join(sdkRoot, "cmdline-tools", "latest");
    mkdirSync(join(sdkRoot, "cmdline-tools"), { recursive: true });
    renameSync(inner, target);
    this.note("Tools: cmdline-tools/latest eingerichtet.");
    return sdkmanager;
  }
}

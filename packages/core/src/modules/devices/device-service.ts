import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, openSync, closeSync, accessSync, constants as fsConstants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  DEVICE_EMU_BOOT_TIMEOUT_MS,
  DEVICE_EMU_STOP_GRACE_MS,
  DEVICE_FRAME_MAX_BYTES,
  DEVICE_FRAME_MIN_INTERVAL_MS,
  DEVICE_INPUT_TIMEOUT_MS,
  DEVICE_INSTALL_TIMEOUT_MS,
  DEVICE_LEASE_IDLE_MS,
  DEVICE_LOGCAT_DEFAULT_BYTES,
  DEVICE_LOGCAT_MAX_BYTES,
  DEVICE_MAX_EMULATORS,
  DEVICE_OWNERSHIP_ENV,
  DEVICE_STEP_TIMEOUT_MAX_MS,
  DEVICE_TEST_TOTAL_TIMEOUT_MS,
  DEVICE_TREE_MAX_BYTES,
} from "@ancientvoid/contracts";
import type {
  AdbDeviceEntry,
  AvdDescriptor,
  DeviceAction,
  DeviceCapabilities,
  DeviceAvdCreateInput,
  DeviceImageList,
  DeviceStatus,
  DeviceTestEnv,
  DeviceTestRun,
  DeviceTestStep,
  DeviceTestCase,
} from "@ancientvoid/contracts";
import {
  adbBootCompletedArgv,
  adbDevicesArgv,
  adbEmuAvdNameArgv,
  adbGetpropArgv,
  adbInstallArgv,
  adbKeyArgv,
  adbLogcatArgv,
  adbOpenUrlArgv,
  adbPermissionArgv,
  adbRotateArgv,
  adbScreencapArgv,
  adbSwipeArgv,
  adbTapArgv,
  adbTextArgv,
  adbTreeArgv,
  adbWmSizeArgv,
  checkDeviceUrl,
  encodeInputText,
  emulatorArgv,
  isBootCompleted,
  parseAdbDevices,
  parseAvdConfigIni,
  parsePngSize,
  parseWmSize,
} from "./adb.ts";
import { DeviceSetup, readConfiguredSdkRoot } from "./device-setup.ts";

/**
 * EPIC-P42 (ADR-0067): Android-Device-Dienst. AV-eigene Emulatoren werden mit Ownership-Marker (pid + argv +
 * Umgebungsvariable, Muster wie ServiceSupervisor) gestartet und adoptiert; nur nachweisbar eigene Prozesse werden
 * beendet. Eine Steuerungslease je Gerät mit monotoner Generation; Eingaben sind an Generation UND Geometrie-Version
 * gebunden (veraltete Frames treffen nie den falschen Punkt). Frames/Logs/Bäume sind Bytes mit Grenzen, nie Events
 * (K5). Der Zustand faltet aus dem Journal (K7); Eingaben werden nach Neustart nie wiederholt.
 */
export { DeviceError, maskDeviceLog, type DeviceErrorCode, type DeviceExec } from "./device-shared.ts";
import { DeviceError, maskDeviceLog, type DeviceExec } from "./device-shared.ts";

const MAX_BUFFER = 16 * 1024 * 1024;

class NodeDeviceExec implements DeviceExec {
  run(argv: string[], opts: { timeoutMs: number; env?: Record<string, string>; stdin?: string }): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    return new Promise((resolve) => {
      const child = execFile(argv[0]!, argv.slice(1), { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER, encoding: "buffer", env: { ...process.env, ...opts.env } }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === "number" ? ((err as unknown as { code: number }).code) : err ? 1 : 0;
        resolve({ code, stdout: stdout ?? Buffer.alloc(0), stderr: (stderr ?? Buffer.alloc(0)).toString("utf8") });
      });
      // avdmanager/sdkmanager fragen nach (Lizenzen, Hardware-Profil) — Antwort über stdin, kein Shell-String.
      if (opts.stdin !== undefined) {
        child.stdin?.write(opts.stdin);
        child.stdin?.end();
      }
    });
  }
  spawnDetached(argv: string[], opts: { env: Record<string, string>; logFile: string }): { pid: number } {
    const out = openSync(opts.logFile, "a");
    try {
      const child = spawn(argv[0]!, argv.slice(1), { env: { ...process.env, ...opts.env }, detached: true, stdio: ["ignore", out, out] });
      child.unref();
      if (child.pid === undefined) throw new Error("Prozessstart fehlgeschlagen");
      return { pid: child.pid };
    } finally {
      closeSync(out);
    }
  }
  async ownedAlive(pid: number, marker: string): Promise<boolean> {
    let env: Buffer | null;
    try {
      env = readFileSync(`/proc/${pid}/environ`);
    } catch {
      env = null;
    }
    return Boolean(env && env.includes(Buffer.from(`${DEVICE_OWNERSHIP_ENV}=${marker}\0`)));
  }
  async kill(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    try {
      process.kill(pid, signal);
    } catch {
      // bereits beendet — Zielzustand erreicht
    }
  }
  async exited(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
}

export interface DeviceServiceOptions {
  dataDir: string;
  /** Android-SDK-Wurzel (Config `devices.sdkRoot`); Standard: env ANDROID_SDK_ROOT/ANDROID_HOME. */
  sdkRoot?: string;
  /** AVD-Home (Config `devices.avdHome`); Standard: <dataDir>/devices/avd. */
  avdHome?: string;
  avdAllowlist?: string[];
  maxEmulators?: number;
  /** Lease-Cleanup: beendete/archivierte Sessions verlieren die Steuerung. */
  isActive?: (sessionId: string) => boolean;
  /** Testnähen. */
  exec?: DeviceExec;
  kvmPath?: string;
  watchIntervalMs?: number;
  bootTimeoutMs?: number;
  leaseIdleMs?: number;
  reapIntervalMs?: number;
  /** In-App-Setup (2026-11-24): Overrides für Download-Quellen und Paketliste. */
  setup?: { jdkUrl?: string; toolsUrl?: string; packages?: readonly string[] };
}

type EmuState = "starting" | "booting" | "ready" | "stopping" | "stopped" | "unknown";

interface Lease {
  sessionId: string | null;
  owner: string;
  generation: number;
  acquiredAt: string;
  lastSeenAt: number;
}

interface Instance {
  instanceId: string;
  avdName: string;
  serial: string;
  port: number;
  pid: number;
  argv: string[];
  marker: string;
  startedAt: string;
  state: EmuState;
  generation: number;
  geometryVersion: number;
  seq: number;
  lease: Lease | null;
  lastFrame: { at: number; seq: number; data: Buffer; width: number; height: number; geometryVersion: number } | null;
  watcher: NodeJS.Timeout | null;
  startedAtMs: number;
}

interface ActiveTest {
  controller: AbortController;
}

interface JournalRecord {
  t: "started" | "state" | "stopped" | "lease" | "released";
  at: string;
  serial?: string;
  instanceId?: string;
  avdName?: string;
  pid?: number;
  port?: number;
  argv?: string[];
  marker?: string;
  state?: EmuState;
  reason?: string;
  sessionId?: string | null;
  owner?: string;
  generation?: number;
}
const now = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);


export class DeviceService {
  private readonly dataDir: string;
  private sdkRoot: string | null;
  private readonly avdHome: string;
  private readonly allowlist: string[];
  private readonly maxEmulators: number;
  private readonly isActive: (sessionId: string) => boolean;
  private readonly exec: DeviceExec;
  private readonly kvmPath: string;
  private readonly watchIntervalMs: number;
  private readonly bootTimeoutMs: number;
  private readonly leaseIdleMs: number;
  private readonly reapIntervalMs: number;
  private adbPath: string | null;
  private emulatorPath: string | null;
  /** JAVA_HOME des In-App-Setups (falls installiert) — avdmanager/sdkmanager brauchen es. */
  private jdkHome: string | null = null;
  private readonly instances = new Map<string, Instance>();
  private readonly generations = new Map<string, number>();
  private readonly tests = new Map<string, ActiveTest>(); // `${serial}:${runId}`
  private reaper: NodeJS.Timeout | null = null;
  private avdsCache: { at: number; avds: AvdDescriptor[] } | null = null;
  private inventoryCache: { at: number; rows: AdbDeviceEntry[] } | null = null;
  /** In-App-Setup (2026-11-24): JDK/Tools/Lizenzen/Pakete aus der PWA heraus. */
  readonly setup: DeviceSetup;

  constructor(opts: DeviceServiceOptions) {
    this.dataDir = join(opts.dataDir, "devices");
    mkdirSync(join(this.dataDir, "artifacts"), { recursive: true });
    // K7: Config/env vorziehen; sonst gilt die SDK-Wurzel des letzten erfolgreichen In-App-Setups.
    this.sdkRoot = opts.sdkRoot ?? process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? readConfiguredSdkRoot(join(opts.dataDir, "devices"));
    this.avdHome = opts.avdHome ?? join(this.dataDir, "avd");
    mkdirSync(this.avdHome, { recursive: true });
    this.allowlist = opts.avdAllowlist ?? [];
    this.maxEmulators = Math.max(1, opts.maxEmulators ?? DEVICE_MAX_EMULATORS);
    this.isActive = opts.isActive ?? (() => true);
    this.exec = opts.exec ?? new NodeDeviceExec();
    this.kvmPath = opts.kvmPath ?? "/dev/kvm";
    this.watchIntervalMs = opts.watchIntervalMs ?? 3_000;
    this.bootTimeoutMs = opts.bootTimeoutMs ?? DEVICE_EMU_BOOT_TIMEOUT_MS;
    this.leaseIdleMs = opts.leaseIdleMs ?? DEVICE_LEASE_IDLE_MS;
    this.reapIntervalMs = opts.reapIntervalMs ?? 15_000;
    this.adbPath = this.sdkRoot ? join(this.sdkRoot, "platform-tools", "adb") : null;
    this.emulatorPath = this.sdkRoot ? join(this.sdkRoot, "emulator", "emulator") : null;
    this.setup = new DeviceSetup({
      dataDir: this.dataDir,
      exec: this.exec,
      ...(opts.setup?.jdkUrl ? { jdkUrl: opts.setup.jdkUrl } : {}),
      ...(opts.setup?.toolsUrl ? { toolsUrl: opts.setup.toolsUrl } : {}),
      ...(opts.setup?.packages ? { packages: opts.setup.packages } : {}),
      onReady: (sdkRoot, jdkHome) => this.applySdkRoot(sdkRoot, jdkHome),
    });
    this.recover();
  }

  /** Nach erfolgreichem In-App-Setup übernimmt der Dienst die SDK-Wurzel (ohne Neustart). */
  private applySdkRoot(sdkRoot: string, jdkHome: string | null): void {
    this.sdkRoot = sdkRoot;
    this.jdkHome = jdkHome;
    this.adbPath = join(sdkRoot, "platform-tools", "adb");
    this.emulatorPath = join(sdkRoot, "emulator", "emulator");
    this.avdsCache = null;
  }

  // ---- Journal (K7) -----------------------------------------------------------------------------------------------
  private journalFile(): string {
    return join(this.dataDir, "devices.jsonl");
  }

  private journal(rec: JournalRecord): void {
    appendFileSync(this.journalFile(), `${JSON.stringify(rec)}\n`);
  }

  private readJournal(): JournalRecord[] {
    const file = this.journalFile();
    if (!existsSync(file)) return [];
    const out: JournalRecord[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as JournalRecord);
      } catch {
        // beschädigte Zeile überspringen — Rest bleibt lesbar
      }
    }
    return out;
  }

  /** K7-Wiederanlauf: Eigentum nur mit Marker belegen; Lease-Zähler bleiben, aktive Lease NICHT wiederhergestellt
   * (Eingaben werden nie wiederholt; eine alte Generation ist danach nie wieder gültig). */
  private recover(): void {
    const candidates = new Map<string, JournalRecord>();
    for (const rec of this.readJournal()) {
      if (rec.generation && rec.serial) this.generations.set(rec.serial, Math.max(this.generations.get(rec.serial) ?? 0, rec.generation));
      if (!rec.serial) continue;
      if (rec.t === "started") candidates.set(rec.serial, rec);
      else if (rec.t === "stopped") candidates.delete(rec.serial);
    }
    for (const [serial, rec] of candidates) {
      if (!rec.pid || !rec.marker || !rec.avdName || !rec.port) continue;
      void this.exec
        .ownedAlive(rec.pid, rec.marker)
        .then(async (owned) => {
          if (!owned) {
            this.journal({ t: "stopped", at: now(), serial, reason: "nach Neustart nicht nachweisbar eigen" });
            return;
          }
          const inst: Instance = {
            instanceId: rec.instanceId ?? randomUUID(),
            avdName: rec.avdName!,
            serial,
            port: rec.port!,
            pid: rec.pid!,
            argv: rec.argv ?? [],
            marker: rec.marker!,
            startedAt: rec.at,
            state: "unknown",
            generation: 0,
            geometryVersion: 1,
            seq: 0,
            lease: null,
            lastFrame: null,
            watcher: null,
            startedAtMs: Date.now(),
          };
          this.instances.set(serial, inst);
          await this.probeAdopted(inst).catch(() => undefined);
        })
        .catch(() => undefined);
    }
  }

  /** Adoptierter Emulator: online+gebootet → ready, sonst booting-Beobachtung neu aufsetzen. */
  private async probeAdopted(inst: Instance): Promise<void> {
    const online = (await this.runAdb(adbDevicesArgv(), 8_000)).stdout.toString("utf8");
    const row = parseAdbDevices(online).find((d) => d.serial === inst.serial);
    if (!row || row.state !== "device") {
      inst.state = "booting";
      this.journal({ t: "state", at: now(), serial: inst.serial, state: "booting", reason: "adoptiert, adb noch nicht bereit" });
      this.watchBoot(inst);
      return;
    }
    const booted = await this.bootCompleted(inst.serial);
    inst.state = booted ? "ready" : "booting";
    this.journal({ t: "state", at: now(), serial: inst.serial, state: inst.state, reason: "adoptiert" });
    if (!booted) this.watchBoot(inst);
    this.startReaper();
  }

  // ---- Fähigkeiten (T42.1) ----------------------------------------------------------------------------------------
  capabilities(): DeviceCapabilities {
    const reasons: string[] = [];
    const sdkRoot = this.sdkRoot;
    if (!sdkRoot) reasons.push("Kein Android-SDK konfiguriert — devices.sdkRoot setzen oder ANDROID_SDK_ROOT exportieren.");
    else if (!existsSync(sdkRoot)) reasons.push(`Android-SDK-Wurzel existiert nicht: ${sdkRoot}`);
    if (this.adbPath && !existsSync(this.adbPath)) reasons.push(`adb fehlt: ${this.adbPath}`);
    if (this.emulatorPath && !existsSync(this.emulatorPath)) reasons.push(`emulator fehlt: ${this.emulatorPath}`);
    let kvm: { available: boolean; reason: string | null };
    try {
      accessSync(this.kvmPath, fsConstants.R_OK | fsConstants.W_OK);
      kvm = { available: true, reason: null };
    } catch {
      kvm = { available: false, reason: `${this.kvmPath} fehlt oder ist nicht lesbar/schreibbar — Emulator ohne KVM ist nicht abnahmefähig.` };
      reasons.push(kvm.reason ?? "");
    }
    if (sdkRoot && existsSync(sdkRoot) && !this.adbPath) reasons.push("adb-Pfad nicht ableitbar.");
    return { ready: reasons.length === 0, sdkRoot, adbPath: this.adbPath, emulatorPath: this.emulatorPath, kvm, reasons };
  }

  private requireCaps(): void {
    const caps = this.capabilities();
    if (!caps.ready) throw new DeviceError("unavailable", `Android-Testgeräte nicht verfügbar: ${caps.reasons.join(" ")}`);
  }

  private runEnv(): Record<string, string> {
    return { ANDROID_SDK_ROOT: this.sdkRoot ?? "", ANDROID_AVD_HOME: this.avdHome };
  }

  private async runAdb(argv: string[], timeoutMs: number): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    if (!this.adbPath) throw new DeviceError("unavailable", "adb nicht verfügbar (SDK-Wurzel fehlt).");
    return this.exec.run([this.adbPath, ...argv], { timeoutMs, env: this.runEnv() });
  }

  private async runAdbChecked(argv: string[], timeoutMs: number, what: string): Promise<Buffer> {
    const res = await this.runAdb(argv, timeoutMs);
    if (res.code !== 0) throw new DeviceError("failed", `${what} fehlgeschlagen: ${clip(res.stderr.trim() || `Exit ${res.code}`, 300)}`);
    return res.stdout;
  }

  // ---- Inventar / AVDs --------------------------------------------------------------------------------------------
  private async rawInventory(fresh = false): Promise<AdbDeviceEntry[]> {
    if (!this.adbPath) return [];
    if (!fresh && this.inventoryCache && Date.now() - this.inventoryCache.at < 1_500) return this.inventoryCache.rows;
    const res = await this.runAdb(adbDevicesArgv(), 10_000).catch(() => null);
    if (!res || res.code !== 0) return []; // capabilities nennt den Grund; Inventar bleibt ehrlich leer
    const rows = parseAdbDevices(res.stdout.toString("utf8")).map((d) => {
      const inst = this.instances.get(d.serial);
      const owned = Boolean(inst);
      return {
        serial: d.serial,
        state: d.state,
        rawState: d.rawState,
        usb: d.usb,
        product: d.product,
        model: d.model,
        transportId: d.transportId,
        owned,
        foreignEmulator: !owned && d.serial.startsWith("emulator-"),
        physical: !owned && !d.serial.startsWith("emulator-"),
        instance: inst
          ? { instanceId: inst.instanceId, avdName: inst.avdName, pid: inst.pid, startedAt: inst.startedAt, state: inst.state }
          : null,
      } satisfies AdbDeviceEntry;
    });
    this.inventoryCache = { at: Date.now(), rows };
    return rows;
  }

  async listAvds(): Promise<AvdDescriptor[]> {
    if (!this.emulatorPath) return [];
    if (this.avdsCache && Date.now() - this.avdsCache.at < 30_000) return this.avdsCache.avds;
    const res = await this.exec.run([this.emulatorPath, "-list-avds"], { timeoutMs: 10_000, env: this.runEnv() }).catch(() => null);
    if (!res || res.code !== 0) return [];
    const names = res.stdout.toString("utf8").split("\n").map((l) => l.replace(/\r$/, "").trim()).filter((l) => l.length > 0 && l.length <= 64);
    const avds = names.map((name) => {
      const iniText = existsSync(join(this.avdHome, `${name}.avd`, "config.ini")) ? readFileSync(join(this.avdHome, `${name}.avd`, "config.ini"), "utf8") : "";
      const ini = parseAvdConfigIni(iniText);
      return { name, ...ini, allowed: this.allowlist.length === 0 || this.allowlist.includes(name) } satisfies AvdDescriptor;
    });
    this.avdsCache = { at: Date.now(), avds };
    return avds;
  }

  /** Installierte System-Images als sdkmanager-IDs (`system-images;<api>;<tag>;<abi>`). */
  listImages(): DeviceImageList {
    if (!this.sdkRoot) return { images: [] };
    const root = join(this.sdkRoot, "system-images");
    if (!existsSync(root)) return { images: [] };
    const images: string[] = [];
    for (const api of readdirSync(root, { withFileTypes: true })) {
      if (!api.isDirectory()) continue;
      for (const tag of readdirSync(join(root, api.name), { withFileTypes: true })) {
        if (!tag.isDirectory()) continue;
        for (const abi of readdirSync(join(root, api.name, tag.name), { withFileTypes: true })) {
          if (abi.isDirectory()) images.push(`system-images;${api.name};${tag.name};${abi.name}`);
        }
      }
    }
    return { images };
  }

  /** Neuer AVD aus der PWA — feste avdmanager-argv-Vorlage, `no` auf die Hardware-Profil-Rückfrage. */
  async createAvd(input: DeviceAvdCreateInput): Promise<AvdDescriptor> {
    this.requireCaps();
    const avdmanager = join(this.sdkRoot!, "cmdline-tools", "latest", "bin", "avdmanager");
    if (!existsSync(avdmanager)) throw new DeviceError("unavailable", `avdmanager fehlt: ${avdmanager}`);
    const existing = (await this.listAvds()).find((a) => a.name === input.name);
    if (existing) throw new DeviceError("conflict", `AVD „${input.name}“ existiert bereits.`);
    const env = this.jdkHome ? { ...this.runEnv(), JAVA_HOME: this.jdkHome, PATH: `${join(this.jdkHome, "bin")}:${process.env.PATH ?? ""}` } : this.runEnv();
    const res = await this.exec.run([avdmanager, "create", "avd", "-n", input.name, "-k", input.image, "--device", input.profile], { timeoutMs: 120_000, env, stdin: "no\n" });
    if (res.code !== 0) throw new DeviceError("failed", `AVD-Anlage fehlgeschlagen: ${clip(res.stderr.trim() || res.stdout.toString("utf8"), 400)}`);
    this.avdsCache = null;
    const created = (await this.listAvds()).find((a) => a.name === input.name);
    if (!created) throw new DeviceError("failed", `avdmanager meldete Erfolg, aber „${input.name}“ ist nicht gelistet — Zustand prüfen.`);
    return created;
  }

  async status(): Promise<DeviceStatus> {
    return {
      capabilities: this.capabilities(),
      devices: await this.rawInventory(),
      avds: await this.listAvds(),
      leases: [...this.instances.values()]
        .filter((i) => i.lease)
        .map((i) => ({ serial: i.serial, sessionId: i.lease!.sessionId, owner: i.lease!.owner, generation: i.lease!.generation, acquiredAt: i.lease!.acquiredAt, lastSeenAt: new Date(i.lease!.lastSeenAt).toISOString() })),
    };
  }

  // ---- Emulator-Lebenszyklus (T42.2) ------------------------------------------------------------------------------
  private ownedCount(): number {
    return [...this.instances.values()].filter((i) => i.state !== "stopped").length;
  }

  private async pickPort(): Promise<number> {
    const rows = await this.rawInventory();
    const taken = new Set([...rows.map((r) => r.serial), ...[...this.instances.values()].map((i) => i.serial)]);
    for (let port = 5554; port <= 5572; port += 2) if (!taken.has(`emulator-${port}`)) return port;
    throw new DeviceError("busy", "Kein freier Emulator-Port (5554–5572).");
  }

  /** Startet einen AV-eigenen Emulator. Der Start wird beobachtet (adb ready → boot completed); die Route kehrt
   * sofort mit `starting` zurück. Nur AV-gestartete Emulatoren stehen später unter AV-Steuerung. */
  async startEmulator(avdName: string, sessionId: string | null): Promise<AdbDeviceEntry> {
    this.requireCaps();
    const avds = await this.listAvds();
    const avd = avds.find((a) => a.name === avdName);
    if (!avd) throw new DeviceError("not_found", `AVD „${avdName}“ existiert im AVD-Home nicht.`);
    if (!avd.allowed) throw new DeviceError("blocked", `AVD „${avdName}“ steht nicht in der Allowlist (devices.avdAllowlist).`);
    const existing = [...this.instances.values()].find((i) => i.avdName === avdName && i.state !== "stopped");
    if (existing) return this.instanceEntry(existing);
    if (this.ownedCount() >= this.maxEmulators) throw new DeviceError("quota", `Höchstens ${this.maxEmulators} AV-eigene Emulatoren gleichzeitig (devices.maxEmulators).`);
    const port = await this.pickPort();
    const serial = `emulator-${port}`;
    const instanceId = randomUUID();
    const argv = emulatorArgv(this.emulatorPath!, avdName, port);
    const logFile = join(this.dataDir, `emulator-${instanceId}.log`);
    const { pid } = this.exec.spawnDetached(argv, { env: { ...this.runEnv(), [DEVICE_OWNERSHIP_ENV]: instanceId }, logFile });
    const inst: Instance = {
      instanceId,
      avdName,
      serial,
      port,
      pid,
      argv,
      marker: instanceId,
      startedAt: now(),
      state: "starting",
      generation: 0,
      geometryVersion: 1,
      seq: 0,
      lease: null,
      lastFrame: null,
      watcher: null,
      startedAtMs: Date.now(),
    };
    this.instances.set(serial, inst);
    this.inventoryCache = null; // der neue Emulator ist sofort sichtbar, nicht erst nach Cache-Ablauf
    this.journal({ t: "started", at: now(), serial, instanceId, avdName, pid, port, argv, marker: instanceId, sessionId });
    this.startReaper();
    this.watchBoot(inst);
    return this.instanceEntry(inst);
  }

  private instanceEntry(inst: Instance): AdbDeviceEntry {
    return {
      serial: inst.serial,
      state: "device",
      rawState: "device",
      usb: false,
      product: null,
      model: null,
      transportId: null,
      owned: true,
      foreignEmulator: false,
      physical: false,
      instance: { instanceId: inst.instanceId, avdName: inst.avdName, pid: inst.pid, startedAt: inst.startedAt, state: inst.state },
    };
  }

  private async bootCompleted(serial: string): Promise<boolean> {
    const out = await this.runAdb(adbBootCompletedArgv(serial), 8_000).catch(() => null);
    return Boolean(out && out.code === 0 && isBootCompleted(out.stdout.toString("utf8")));
  }

  /** Beobachtet adb-online → boot completed bis zur Frist; danach Stop mit Grund (fail loud). */
  private watchBoot(inst: Instance): void {
    if (inst.watcher) return;
    inst.watcher = setInterval(() => {
      void (async () => {
        if (inst.state === "stopped" || inst.state === "stopping") return;
        if (Date.now() - inst.startedAtMs > this.bootTimeoutMs) {
          await this.stopEmulator(inst.serial, "Boot-Zeit überschritten").catch(() => undefined);
          return;
        }
        const rows = await this.rawInventory().catch(() => [] as AdbDeviceEntry[]);
        const row = rows.find((r) => r.serial === inst.serial);
        if (!row) return; // adb sieht ihn noch nicht — weiter warten
        if (row.state === "offline" || row.state === "unauthorized") return;
        // Eigentumszuordnung prüfen: der Emulator-Konsole ihren AVD-Namen entnehmen (nur Start- und Adopt-Pfad).
        if (inst.state === "starting") {
          const name = await this.runAdb(adbEmuAvdNameArgv(inst.serial), 8_000).catch(() => null);
          const consoleName = name && name.code === 0 ? name.stdout.toString("utf8").split("\n")[0]!.replace(/\r$/, "").trim() : "";
          if (consoleName && consoleName !== inst.avdName) {
            await this.stopEmulator(inst.serial, "Serial gehört einem anderen AVD — nicht unseres").catch(() => undefined);
            return;
          }
          inst.state = "booting";
          this.journal({ t: "state", at: now(), serial: inst.serial, state: "booting" });
        }
        if (inst.state === "booting" && (await this.bootCompleted(inst.serial))) {
          inst.state = "ready";
          this.journal({ t: "state", at: now(), serial: inst.serial, state: "ready" });
          this.clearWatcher(inst);
        }
      })().catch(() => undefined);
    }, this.watchIntervalMs);
    inst.watcher.unref();
  }

  private clearWatcher(inst: Instance): void {
    if (inst.watcher) clearInterval(inst.watcher);
    inst.watcher = null;
  }

  /** Beendet nur nachweisbar eigene Emulatoren (SIGTERM → Frist → SIGKILL). Fremde/physical: blocked. */
  async stopEmulator(serial: string, reason = "vom Nutzer beendet"): Promise<{ serial: string; stopped: boolean }> {
    const inst = this.instances.get(serial);
    if (!inst) {
      // Stop-Entscheidung braucht aktuelles Inventar — der 1,5-s-Cache könnte ein fremdes Gerät verschweigen.
      const rows = await this.rawInventory(true);
      const row = rows.find((r) => r.serial === serial);
      if (row) throw new DeviceError("blocked", row.physical ? "Physische Geräte werden nie beendet (EPIC-P42 §2 Out)." : "Fremde Emulatoren werden nie beendet — nur AV-gestartete.");
      throw new DeviceError("not_found", `Kein Gerät mit Serial „${serial}“.`);
    }
    if (inst.state === "stopped") return { serial, stopped: true };
    this.clearWatcher(inst);
    inst.state = "stopping";
    this.journal({ t: "state", at: now(), serial, state: "stopping", reason });
    if (inst.lease) this.releaseLease(serial, inst.lease.generation, "Emulator wird beendet");
    await this.exec.kill(inst.pid, "SIGTERM");
    const graceStart = Date.now();
    while (Date.now() - graceStart < DEVICE_EMU_STOP_GRACE_MS) {
      if (await this.exec.exited(inst.pid)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await this.exec.exited(inst.pid)) && (await this.exec.ownedAlive(inst.pid, inst.marker).catch(() => false))) {
      await this.exec.kill(inst.pid, "SIGKILL");
      await new Promise((r) => setTimeout(r, 2_000));
    }
    inst.state = "stopped";
    this.journal({ t: "stopped", at: now(), serial, reason });
    this.instances.delete(serial);
    for (const key of [...this.tests.keys()]) if (key.startsWith(`${serial}:`)) this.tests.get(key)!.controller.abort();
    return { serial, stopped: true };
  }

  // ---- Lease (AC-P42-3) --------------------------------------------------------------------------------------------
  private nextGeneration(serial: string): number {
    const g = (this.generations.get(serial) ?? 0) + 1;
    this.generations.set(serial, g);
    return g;
  }

  /** Eine aktive Steuerungslease je Gerät; Konflikte werden verweigert, nie übernommen. */
  async acquireLease(serial: string, sessionId: string | null, owner: string): Promise<{ serial: string; generation: number }> {
    const inst = this.ownedReady(serial);
    if (inst.lease && Date.now() - inst.lease.lastSeenAt < this.leaseIdleMs) {
      throw new DeviceError("busy", `Gerät ist von „${inst.lease.owner}“ belegt (Generation ${inst.lease.generation}) — Lease läuft erst nach ${Math.round(this.leaseIdleMs / 1000)} s Ruhe ab.`);
    }
    const generation = this.nextGeneration(serial);
    inst.lease = { sessionId, owner, generation, acquiredAt: now(), lastSeenAt: Date.now() };
    this.journal({ t: "lease", at: now(), serial, sessionId, owner, generation });
    this.startReaper();
    return { serial, generation };
  }

  releaseLease(serial: string, generation: number, reason = "freigegeben"): { serial: string; released: boolean } {
    const inst = this.instances.get(serial);
    if (!inst?.lease) return { serial, released: false };
    if (inst.lease.generation !== generation) throw new DeviceError("conflict", "Generation passt nicht — die Lease gehört jemand anderem oder ist abgelaufen.");
    inst.lease = null;
    this.journal({ t: "released", at: now(), serial, generation, reason });
    return { serial, released: true };
  }

  private ownedReady(serial: string): Instance {
    const inst = this.instances.get(serial);
    if (!inst) {
      throw new DeviceError("not_found", `Kein AV-eigenes Gerät „${serial}“ — fremde/physical Geräte stehen außerhalb der Steuerung.`);
    }
    if (inst.state !== "ready") throw new DeviceError("busy", `Gerät ist nicht bereit (Zustand: ${inst.state}).`);
    return inst;
  }

  private requireLease(inst: Instance, generation: number): void {
    if (!inst.lease) throw new DeviceError("conflict", "Keine aktive Lease — zuerst Lease holen (Eingaben ohne Lease sind ungebunden und werden verweigert).");
    if (inst.lease.generation !== generation) throw new DeviceError("conflict", "Generation passt nicht — Lease wurde neu vergeben. Neu holen und mit aktuellem Bild wiederholen.");
    inst.lease.lastSeenAt = Date.now();
  }

  // ---- Eingaben (T42.3) --------------------------------------------------------------------------------------------
  /** Eingabe ist an Lease-Generation UND Geometrie-Version gebunden: veraltete Bilder treffen nie falsche Punkte. */
  async act(input: { serial: string; generation: number; geometryVersion: number; action: DeviceAction }): Promise<{ serial: string; geometryVersion: number; seq: number }> {
    const inst = this.ownedReady(input.serial);
    this.requireLease(inst, input.generation);
    if (input.geometryVersion !== inst.geometryVersion) {
      throw new DeviceError("conflict", "Das Bild ist veraltet (Rotation/Neustart) — aktualisieren und mit dem neuen Bild erneut eingeben.");
    }
    await this.execAction(inst, input.action, DEVICE_INPUT_TIMEOUT_MS);
    inst.lastFrame = null; // nächster Frame-Poll holt frisch
    inst.seq += 1;
    return { serial: inst.serial, geometryVersion: inst.geometryVersion, seq: inst.seq };
  }

  private async execAction(inst: Instance, action: DeviceAction, timeoutMs: number): Promise<void> {
    switch (action.type) {
      case "tap":
        await this.runAdbChecked(adbTapArgv(inst.serial, action.x, action.y), timeoutMs, "Tap");
        return;
      case "swipe":
        await this.runAdbChecked(adbSwipeArgv(inst.serial, action.x1, action.y1, action.x2, action.y2, action.durationMs), timeoutMs, "Swipe");
        return;
      case "text": {
        const enc = encodeInputText(action.text);
        if (!enc.ok) throw new DeviceError("blocked", enc.reason);
        await this.runAdbChecked(adbTextArgv(inst.serial, enc.encoded), timeoutMs, "Text");
        return;
      }
      case "key":
        await this.runAdbChecked(adbKeyArgv(inst.serial, action.key), timeoutMs, "Taste");
        return;
      case "rotate": {
        for (const argv of adbRotateArgv(inst.serial, action.orientation)) await this.runAdbChecked(argv, timeoutMs, "Rotation");
        inst.geometryVersion += 1; // alle offenen Bilder sind ab jetzt veraltet
        return;
      }
      case "openUrl": {
        const url = checkDeviceUrl(action.url);
        if (!url.ok) throw new DeviceError("blocked", url.reason);
        await this.runAdbChecked(adbOpenUrlArgv(inst.serial, url.url), timeoutMs, "URL öffnen");
        return;
      }
      case "permission":
        await this.runAdbChecked(adbPermissionArgv(inst.serial, action.package, action.permission, action.grant), timeoutMs, `Permission ${action.grant ? "erteilen" : "entziehen"}`);
        return;
    }
  }

  // ---- Frame (minimaler Bildpfad: PNG-Standbild, ADR-0067 §3) ------------------------------------------------------
  async frame(serial: string): Promise<{ data: Buffer; seq: number; width: number; height: number; geometryVersion: number } | null> {
    const inst = this.instances.get(serial);
    if (!inst || (inst.state !== "ready" && inst.state !== "booting")) return null;
    if (inst.lease) inst.lease.lastSeenAt = Date.now();
    if (inst.lastFrame && Date.now() - inst.lastFrame.at < DEVICE_FRAME_MIN_INTERVAL_MS) return { ...inst.lastFrame, data: inst.lastFrame.data };
    const out = await this.runAdb(adbScreencapArgv(serial), 15_000).catch(() => null);
    if (!out || out.code !== 0 || out.stdout.length === 0 || out.stdout.length > DEVICE_FRAME_MAX_BYTES) return inst.lastFrame ? { ...inst.lastFrame, data: inst.lastFrame.data } : null;
    const size = parsePngSize(out.stdout);
    if (!size) return inst.lastFrame ? { ...inst.lastFrame, data: inst.lastFrame.data } : null;
    inst.lastFrame = { at: Date.now(), seq: ++inst.seq, data: out.stdout, width: size.width, height: size.height, geometryVersion: inst.geometryVersion };
    return { ...inst.lastFrame, data: inst.lastFrame.data };
  }

  // ---- Logs / Accessibility-Baum (begrenzt, maskiert) ---------------------------------------------------------------
  async logs(serial: string, bytes = DEVICE_LOGCAT_DEFAULT_BYTES): Promise<{ text: string; truncated: boolean; at: string }> {
    this.ownedReady(serial);
    const cap = Math.min(Math.max(bytes, 1024), DEVICE_LOGCAT_MAX_BYTES);
    const lines = Math.max(50, Math.min(2_000, Math.round(cap / 80)));
    const out = await this.runAdbChecked(adbLogcatArgv(serial, lines), 15_000, "logcat");
    let text = maskDeviceLog(out.toString("utf8"));
    const truncated = text.length > cap;
    if (truncated) text = text.slice(-cap);
    return { text, truncated, at: now() };
  }

  async tree(serial: string): Promise<{ xml: string; truncated: boolean; at: string }> {
    this.ownedReady(serial);
    // uiautomator verweigert den ersten Dump nach Boot gern mit „could not get idle state“
    // (kein XML, Exit != 0 oder nur Meldungstext) — zweiter Versuch nach kurzer Pause ist
    // das übliche Beheben; erst danach failt der Baum laut.
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await this.runAdb(adbTreeArgv(serial), 25_000);
      last = out.stdout.toString("utf8");
      const start = last.indexOf("<?xml");
      const hierarchyStart = start === -1 ? last.indexOf("<hierarchy") : start;
      const end = last.lastIndexOf("</hierarchy>");
      if (hierarchyStart !== -1 && end !== -1) {
        let xml = last.slice(hierarchyStart, end + "</hierarchy>".length);
        const truncated = xml.length > DEVICE_TREE_MAX_BYTES;
        if (truncated) xml = xml.slice(0, DEVICE_TREE_MAX_BYTES);
        return { xml, truncated, at: now() };
      }
      if (out.code !== 0 && out.stderr.includes("not found")) break; // Gerät weg — Retries bringen nichts
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new DeviceError("failed", `Accessibility-Baum nicht lesbar (uiautomator lieferte kein XML). ${clip(last, 120)}`);
  }

  // ---- APK-Installation (nur aus referenziertem Artefakt, T42.4) ---------------------------------------------------
  async installApk(serial: string, generation: number, apkPath: string, expectedSha256: string): Promise<{ serial: string; sha256: string; detail: string }> {
    const inst = this.ownedReady(serial);
    this.requireLease(inst, generation);
    if (!existsSync(apkPath)) throw new DeviceError("not_found", `Artefakt fehlt: ${apkPath}`);
    const hash = createHash("sha256").update(readFileSync(apkPath)).digest("hex");
    if (hash !== expectedSha256) throw new DeviceError("blocked", `Hash stimmt nicht überein (erwartet ${expectedSha256.slice(0, 12)}…, ist ${hash.slice(0, 12)}…) — nichts wurde installiert.`);
    const out = await this.runAdb(adbInstallArgv(serial, apkPath), DEVICE_INSTALL_TIMEOUT_MS);
    const tail = clip(out.stdout.toString("utf8").trim() || out.stderr.trim(), 300);
    if (out.code !== 0 || /Failure/i.test(tail)) throw new DeviceError("failed", `Installation fehlgeschlagen: ${tail}`);
    return { serial, sha256: hash, detail: tail || "Success" };
  }

  // ---- Testläufe (T42.4, registrierte Schritte) ----------------------------------------------------------------------
  private testsFile(): string {
    return join(this.dataDir, "tests.jsonl");
  }

  private journalTest(run: DeviceTestRun): void {
    appendFileSync(this.testsFile(), `${JSON.stringify(run)}\n`);
  }

  listTests(serial: string): DeviceTestRun[] {
    if (!existsSync(this.testsFile())) return [];
    const byId = new Map<string, DeviceTestRun>();
    for (const line of readFileSync(this.testsFile(), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const run = JSON.parse(line) as DeviceTestRun;
        if (run.serial === serial || !serial) byId.set(run.id, run);
      } catch {
        // Zeile überspringen
      }
    }
    return [...byId.values()]
      .map((r) => (r.state === "running" && !this.tests.has(`${r.serial}:${r.id}`) ? { ...r, state: "unknown" as const, note: "Der Hub wurde während des Laufs beendet — Ergebnis unbekannt, nichts wird wiederholt." } : r))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 50);
  }

  artifactPath(serial: string, runId: string): string | null {
    const file = join(this.dataDir, "artifacts", `${runId.replace(/[^\w-]/g, "_")}.png`);
    return existsSync(file) ? file : null;
  }

  /** Startet den Lauf und kehrt mit `running` zurück; der Abschluss läuft im Hintergrund (Muster wie BrowserService). */
  async runTest(test: DeviceTestCase, sessionId: string | null): Promise<DeviceTestRun> {
    const inst = this.ownedReady(test.serial);
    if ([...this.tests.keys()].some((k) => k.startsWith(`${test.serial}:`))) throw new DeviceError("busy", "Auf diesem Gerät läuft schon ein Testlauf.");
    // Testlauf hält die Lease selbst: aktive Menschen-Lease blockiert (nie übernehmen).
    const lease = await this.acquireLease(test.serial, sessionId, `test:${test.name}`.slice(0, 120));
    const runId = randomUUID();
    const controller = new AbortController();
    this.tests.set(`${test.serial}:${runId}`, { controller });
    const env = await this.testEnv(inst);
    const run: DeviceTestRun = { id: runId, serial: test.serial, sessionId, name: test.name, state: "running", startedAt: now(), finishedAt: null, steps: [], env, artifact: null, note: null };
    this.journalTest(run);
    void this.executeTest(inst, run, test, lease.generation, controller)
      .catch(() => undefined)
      .finally(() => {
        this.tests.delete(`${test.serial}:${runId}`);
        this.releaseLease(test.serial, lease.generation, "Testlauf beendet");
      });
    return run;
  }

  abortTest(serial: string, runId: string): boolean {
    const t = this.tests.get(`${serial}:${runId}`);
    if (!t) return false;
    t.controller.abort();
    return true;
  }

  private async testEnv(inst: Instance): Promise<DeviceTestEnv> {
    const api = await this.runAdb(adbGetpropArgv(inst.serial, "ro.build.version.sdk"), 8_000).catch(() => null);
    const fp = await this.runAdb(adbGetpropArgv(inst.serial, "ro.build.fingerprint"), 8_000).catch(() => null);
    const wm = await this.runAdb(adbWmSizeArgv(inst.serial), 8_000).catch(() => null);
    const size = wm && wm.code === 0 ? parseWmSize(wm.stdout.toString("utf8")) : null;
    const orientation = size ? (size.width >= size.height ? "landscape" : "portrait") : null;
    return {
      avdName: inst.avdName,
      apiVersion: api && api.code === 0 ? api.stdout.toString("utf8").replace(/[\r\n]/g, "").trim() || null : null,
      buildFingerprint: fp && fp.code === 0 ? fp.stdout.toString("utf8").replace(/[\r\n]/g, "").trim() || null : null,
      resolution: size,
      orientation,
      apkSha256: null,
    };
  }

  private async executeTest(inst: Instance, run: DeviceTestRun, test: DeviceTestCase, generation: number, controller: AbortController): Promise<void> {
    const deadline = setTimeout(() => controller.abort("timeout"), DEVICE_TEST_TOTAL_TIMEOUT_MS);
    deadline.unref();
    const finish = async (state: DeviceTestRun["state"], note: string | null): Promise<void> => {
      let artifact: DeviceTestRun["artifact"] = null;
      const shot = await this.runAdb(adbScreencapArgv(inst.serial), 15_000).catch(() => null);
      if (shot && shot.code === 0 && shot.stdout.length > 0 && shot.stdout.length <= DEVICE_FRAME_MAX_BYTES) {
        const name = `${run.id}.png`;
        writeFileSync(join(this.dataDir, "artifacts", name), shot.stdout);
        artifact = { name, bytes: shot.stdout.length };
        this.pruneArtifacts();
      }
      this.journalTest({ ...run, state, finishedAt: now(), artifact, note });
    };
    try {
      for (let i = 0; i < test.steps.length; i++) {
        if (controller.signal.aborted) {
          await finish(controller.signal.reason === "timeout" ? "failed" : "aborted", controller.signal.reason === "timeout" ? "Gesamtzeit überschritten" : "Abgebrochen");
          return;
        }
        const step = test.steps[i]!;
        const res = await this.runStep(inst, step);
        run.steps.push({ index: i, type: step.type, ok: res === null, detail: res });
        if (res !== null) {
          await finish("failed", null);
          return;
        }
      }
      await finish("passed", null);
    } catch (err) {
      await finish("failed", clip(err instanceof Error ? err.message : String(err), 300)).catch(() => undefined);
    } finally {
      clearTimeout(deadline);
    }
  }

  private async runStep(inst: Instance, step: DeviceTestStep): Promise<string | null> {
    const timeout = step.type === "wait" ? DEVICE_INPUT_TIMEOUT_MS : Math.min(step.timeoutMs ?? 8_000, DEVICE_STEP_TIMEOUT_MAX_MS);
    try {
      switch (step.type) {
        case "openUrl": {
          const url = checkDeviceUrl(step.url);
          if (!url.ok) return url.reason;
          await this.runAdbChecked(adbOpenUrlArgv(inst.serial, url.url), timeout, "URL öffnen");
          return null;
        }
        case "tap":
        case "swipe":
        case "text":
        case "key":
        case "rotate":
          await this.execAction(inst, step, timeout);
          return null;
        case "wait":
          await new Promise((r) => setTimeout(r, step.ms));
          return null;
        case "expectText": {
          const start = Date.now();
          while (Date.now() - start < (step.timeoutMs ?? 8_000)) {
            const tree = await this.tree(inst.serial).catch(() => null);
            if (tree && (tree.xml.includes(step.text) || tree.xml.includes(escapeXml(step.text)))) return null;
            await new Promise((r) => setTimeout(r, 1_000));
          }
          return `Text „${clip(step.text, 80)}“ nicht im Accessibility-Baum gefunden`;
        }
      }
    } catch (err) {
      if (err instanceof DeviceError) return err.message;
      return clip(err instanceof Error ? err.message : String(err), 300);
    }
  }

  private pruneArtifacts(): void {
    const dir = join(this.dataDir, "artifacts");
    const files = readdirSync(dir).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of files.slice(20)) unlinkSync(join(dir, old.f));
  }

  // ---- Reaper: Lease-Ruhe, tote Emulatoren, tote Sessions -----------------------------------------------------------
  private startReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      for (const inst of [...this.instances.values()]) {
        if (inst.state === "stopped") continue;
        if (inst.lease) {
          const idle = Date.now() - inst.lease.lastSeenAt;
          if (idle > this.leaseIdleMs) {
            this.releaseLease(inst.serial, inst.lease.generation, "Lease ruht (Stream getrennt)");
            continue;
          }
          if (inst.lease.sessionId && !this.isActive(inst.lease.sessionId)) {
            this.releaseLease(inst.serial, inst.lease.generation, "Session beendet");
            continue;
          }
        }
        void this.exec
          .exited(inst.pid)
          .then(async (gone) => {
            if (!gone) return;
            const stillOurs = await this.exec.ownedAlive(inst.pid, inst.marker).catch(() => false);
            if (stillOurs) return; // pid lebt unter anderem Nutzer? unklar — nichts töten
            this.clearWatcher(inst);
            inst.state = "stopped";
            this.journal({ t: "stopped", at: now(), serial: inst.serial, reason: "Emulator-Prozess beendet" });
            this.instances.delete(inst.serial);
            for (const key of [...this.tests.keys()]) if (key.startsWith(`${inst.serial}:`)) this.tests.get(key)!.controller.abort();
          })
          .catch(() => undefined);
      }
    }, this.reapIntervalMs);
    this.reaper.unref();
  }

  /** Testnähe: Zugriff auf Instanzen für Assertions. */
  instanceCount(): number {
    return this.instances.size;
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

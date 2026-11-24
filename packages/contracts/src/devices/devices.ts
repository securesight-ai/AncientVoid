import { z } from "zod";

/**
 * EPIC-P42 (ADR-0067): Android-Testgeräte. AV-eigene Emulatoren (AVDs) werden über feste adb-/emulator-argv-Templates
 * gestartet und bedient — es gibt keine freie `adb shell`-Route. Standbilder, Logs und Accessibility-Bäume sind Bytes
 * mit harten Grenzen und landen nie im Eventstrom (K5). Der Zustand ist aus dem Journal rekonstruierbar (K7).
 * Physische/fremde Geräte werden angezeigt, aber nie gesteuert oder beendet.
 */

/** Eigentumsmarker im Prozess-Environment (Muster wie WORKSPACE_OWNERSHIP_ENV, ADR-0067 §Ownership). */
export const DEVICE_OWNERSHIP_ENV = "ANCIENTVOID_DEVICE_OWNER";

/** K5/K8: harte Grenzen — Frames/Logs/Bäume sind Byte-Antworten, nie Events. */
export const DEVICE_MAX_EMULATORS = 1;
export const DEVICE_FRAME_MIN_INTERVAL_MS = 400;
export const DEVICE_FRAME_MAX_BYTES = 2 * 1024 * 1024;
export const DEVICE_LOGCAT_DEFAULT_BYTES = 32 * 1024;
export const DEVICE_LOGCAT_MAX_BYTES = 128 * 1024;
export const DEVICE_TREE_MAX_BYTES = 512 * 1024;
export const DEVICE_INPUT_TIMEOUT_MS = 10_000;
export const DEVICE_INSTALL_TIMEOUT_MS = 120_000;
export const DEVICE_EMU_BOOT_TIMEOUT_MS = 180_000;
export const DEVICE_EMU_STOP_GRACE_MS = 20_000;
/** Lease endet ohne Lebenszeichen (Frame-/Status-Poll) nach dieser Frist — „Stream-Disconnect stoppt Eingaben“. */
export const DEVICE_LEASE_IDLE_MS = 45_000;
export const DEVICE_TEXT_MAX_CHARS = 500;
export const DEVICE_URL_MAX_CHARS = 2048;
export const DEVICE_MAX_TEST_STEPS = 20;
export const DEVICE_TEST_TOTAL_TIMEOUT_MS = 240_000;
export const DEVICE_STEP_TIMEOUT_MAX_MS = 15_000;

/** adb-Zustände, die AV auswertet; alles andere bleibt sichtbar `unknown` (fail loud, nie gedroppt). */
export const ADB_KNOWN_STATES = ["device", "offline", "unauthorized", "bootloader", "recovery", "no permissions", "no-device"] as const;

export const AdbDeviceEntry = z.object({
  serial: z.string().min(1).max(120),
  state: z.enum(["device", "offline", "unauthorized", "bootloader", "recovery", "no permissions", "no-device", "unknown"]),
  /** Rohzustand, wenn AV ihn nicht einordnet — nie geraten. */
  rawState: z.string().nullable(),
  usb: z.boolean(),
  product: z.string().nullable(),
  model: z.string().nullable(),
  transportId: z.string().nullable(),
  /** AV-eigener Emulator (Eigentum belegt über pid + argv + Ownership-Marker). */
  owned: z.boolean(),
  /** `emulator-*`-Serial, der nicht AV-ownend ist — wird angezeigt, nie gesteuert/beendet. */
  foreignEmulator: z.boolean(),
  /** Angestecktes Gerät — außerhalb des Scopes (EPIC-P42 §2 Out), nur sichtbar. */
  physical: z.boolean(),
  /** Instanzdaten, wenn `owned` (Startzeit, AVD, Zustand der Beobachtung). */
  instance: z
    .object({
      instanceId: z.string(),
      avdName: z.string(),
      pid: z.number().int().positive(),
      startedAt: z.string(),
      state: z.enum(["starting", "booting", "ready", "stopping", "stopped", "unknown"]),
    })
    .nullable(),
});
export type AdbDeviceEntry = z.infer<typeof AdbDeviceEntry>;

/** Host-Fähigkeiten — fehlende Teile stehen mit Grund da, nie still (T42.1). */
export const DeviceCapabilities = z.object({
  ready: z.boolean(),
  sdkRoot: z.string().nullable(),
  adbPath: z.string().nullable(),
  emulatorPath: z.string().nullable(),
  kvm: z.object({ available: z.boolean(), reason: z.string().nullable() }),
  /** Jede fehlende Voraussetzung als eigene Zeile (sichtbar in PWA/hubctl). */
  reasons: z.array(z.string()),
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

export const AvdDescriptor = z.object({
  name: z.string().min(1).max(64),
  lcdWidth: z.number().int().positive().nullable(),
  lcdHeight: z.number().int().positive().nullable(),
  imageDir: z.string().nullable(),
  /** true = steht in der Config-Allowlist (devices.avdAllowlist); leere Allowlist = alle wählbar. */
  allowed: z.boolean(),
});
export type AvdDescriptor = z.infer<typeof AvdDescriptor>;

export const DeviceLeaseView = z.object({
  serial: z.string(),
  sessionId: z.string().nullable(),
  owner: z.string().max(120),
  generation: z.number().int().positive(),
  acquiredAt: z.string(),
  lastSeenAt: z.string(),
});
export type DeviceLeaseView = z.infer<typeof DeviceLeaseView>;

export const DeviceStatus = z.object({
  capabilities: DeviceCapabilities,
  devices: z.array(AdbDeviceEntry),
  avds: z.array(AvdDescriptor),
  leases: z.array(DeviceLeaseView),
});
export type DeviceStatus = z.infer<typeof DeviceStatus>;

const Coord = z.number().min(0).max(10_000);

/** Eingaben sind schema-validierte Aktionen mit fester argv-Vorlage — keine freien Shell-Strings. */
export const DeviceAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap"), x: Coord, y: Coord }),
  z.object({ type: z.literal("swipe"), x1: Coord, y1: Coord, x2: Coord, y2: Coord, durationMs: z.number().int().min(100).max(2_000).default(300) }),
  /** ASCII ohne Shell-Metazeichen; Leerzeichen werden gerätekonform als %s übertragen. */
  z.object({ type: z.literal("text"), text: z.string().min(1).max(DEVICE_TEXT_MAX_CHARS) }),
  z.object({
    type: z.literal("key"),
    key: z.enum(["back", "home", "app-switch", "enter", "del", "volume-up", "volume-down"]),
  }),
  z.object({ type: z.literal("rotate"), orientation: z.enum(["portrait", "landscape"]) }),
  /** http(s)-URL ohne Zeichen, die die Gerätesshell auswerten würde. */
  z.object({ type: z.literal("openUrl"), url: z.string().min(1).max(DEVICE_URL_MAX_CHARS) }),
  z.object({ type: z.literal("permission"), package: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Paketname"), permission: z.string().regex(/^android\.permission\.[A-Z][A-Z0-9_]+$/, "android.permission.*"), grant: z.boolean() }),
]);
export type DeviceAction = z.infer<typeof DeviceAction>;

/** Eingabe wird an Lease-Generation UND Geometrie-Version gebunden (Rotation verschiebt sonst den Tap-Punkt). */
export const DeviceActionInput = z.object({
  serial: z.string().min(1).max(120),
  generation: z.number().int().positive(),
  geometryVersion: z.number().int().positive(),
  action: DeviceAction,
});
export type DeviceActionInput = z.infer<typeof DeviceActionInput>;

export const DeviceFrameMeta = z.object({
  seq: z.number().int().positive(),
  geometryVersion: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  at: z.string(),
});
export type DeviceFrameMeta = z.infer<typeof DeviceFrameMeta>;

// ---- Testläufe (registrierte Schritte, kein freier Code — Muster wie BrowserTestStep) -----------------------------
const StepTimeout = z.number().int().min(200).max(DEVICE_STEP_TIMEOUT_MAX_MS).default(8_000);
export const DeviceTestStep = z.discriminatedUnion("type", [
  z.object({ type: z.literal("openUrl"), url: z.string().min(1).max(DEVICE_URL_MAX_CHARS), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("tap"), x: Coord, y: Coord, timeoutMs: StepTimeout }),
  z.object({ type: z.literal("swipe"), x1: Coord, y1: Coord, x2: Coord, y2: Coord, durationMs: z.number().int().min(100).max(2_000).default(300), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(DEVICE_TEXT_MAX_CHARS), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("key"), key: z.enum(["back", "home", "app-switch", "enter", "del", "volume-up", "volume-down"]), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("rotate"), orientation: z.enum(["portrait", "landscape"]), timeoutMs: StepTimeout }),
  /** Erwarteter Text im Accessibility-Baum (uiautomator) — das ist die PWA-/App-Seiten-Wirklichkeit. */
  z.object({ type: z.literal("expectText"), text: z.string().min(1).max(300), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(200).max(5_000) }),
]);
export type DeviceTestStep = z.infer<typeof DeviceTestStep>;

export const DeviceTestCase = z.object({
  name: z.string().min(1).max(120),
  serial: z.string().min(1).max(120),
  steps: z.array(DeviceTestStep).min(1).max(DEVICE_MAX_TEST_STEPS),
});
export type DeviceTestCase = z.infer<typeof DeviceTestCase>;

export const DEVICE_TEST_STATES = ["running", "passed", "failed", "aborted", "unknown"] as const;
export const DeviceTestState = z.enum(DEVICE_TEST_STATES);
export type DeviceTestState = z.infer<typeof DeviceTestState>;

export const DeviceStepResult = z.object({
  index: z.number().int().nonnegative(),
  type: z.string().max(40),
  ok: z.boolean(),
  detail: z.string().max(500).nullable(),
});
export type DeviceStepResult = z.infer<typeof DeviceStepResult>;

/** Reproduzierbarkeit: Image/API/Auflösung/Orientierung/Build am Lauf festhalten (EPIC-P42 §3.3). */
export const DeviceTestEnv = z.object({
  avdName: z.string().nullable(),
  apiVersion: z.string().nullable(),
  buildFingerprint: z.string().nullable(),
  resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
  orientation: z.enum(["portrait", "landscape", "unknown"]).nullable(),
  /** sha256 des installierten APK-Artefakts, falls der Lauf eines installiert hat. */
  apkSha256: z.string().nullable(),
});
export type DeviceTestEnv = z.infer<typeof DeviceTestEnv>;

export const DeviceTestRun = z.object({
  id: z.string(),
  serial: z.string(),
  sessionId: z.string().nullable(),
  name: z.string(),
  state: DeviceTestState,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(DeviceStepResult),
  env: DeviceTestEnv,
  artifact: z.object({ name: z.string(), bytes: z.number().int().nonnegative() }).nullable(),
  note: z.string().nullable(),
});
export type DeviceTestRun = z.infer<typeof DeviceTestRun>;

// ---- In-App-Setup (2026-11-24): JDK, cmdline-tools, Lizenzen, Pakete — der komplette
// Simulator-Setup-Ablauf läuft in der PWA, ohne manuelle CLI-Schritte. Downloads nur auf
// ausdrücklichen Klick (EPIC-P42 §2 „ungefragte Downloads“ bleibt Out-of-Scope). --------

/** Angepinnte Download-Quellen; Config-Override (`devices.setup.*`) erlaubt Spiegel/Offline-Installationen. */
export const DEVICE_SETUP_TOOLS_URL = "https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip";
export const DEVICE_SETUP_JDK_URL = "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse";
export const DEVICE_SETUP_PACKAGES = ["platform-tools", "emulator", "system-images;android-35;google_apis;x86_64"] as const;
/** Standard-System-Image und Geräteprofil für neue AVDs (ADR-0067: API 35, Pixel-6-Profil). */
export const DEVICE_DEFAULT_IMAGE = "system-images;android-35;google_apis;x86_64";
export const DEVICE_DEFAULT_PROFILE = "pixel_6";
export const DEVICE_AVD_PROFILES = ["pixel_6", "pixel_7", "pixel_tablet"] as const;

/** K5: Status-Antwort bleibt klein — der Log-Schwanz ist gekappt, nie ein Event. */
export const DEVICE_SETUP_TAIL_MAX_CHARS = 4_000;
export const DEVICE_SETUP_DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
export const DEVICE_SETUP_STEP_TIMEOUT_MS = 15 * 60_000;

export const DEVICE_SETUP_PHASES = ["jdk", "tools", "licenses", "packages"] as const;
export type DeviceSetupPhase = (typeof DEVICE_SETUP_PHASES)[number];

export const DeviceSetupStatus = z.object({
  state: z.enum(["idle", "running", "done", "failed"]),
  /** Aktueller (running) oder zuletzt gelaufener Schritt; `none` = noch nie gelaufen. */
  phase: z.enum([...DEVICE_SETUP_PHASES, "none"]),
  sdkRoot: z.string().nullable(),
  /** Vorschlag für das Eingabefeld (AV-eigenes Verzeichnis unter dem Datenverzeichnis). */
  suggestedSdkRoot: z.string(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  /** fail loud: Grund im Zustand, nie still. */
  reason: z.string().nullable(),
  tail: z.string().max(DEVICE_SETUP_TAIL_MAX_CHARS),
});
export type DeviceSetupStatus = z.infer<typeof DeviceSetupStatus>;

/** Neuer AVD aus der PWA: Name, installiertes System-Image, Geräteprofil — feste argv-Vorlage. */
export const DeviceAvdCreateInput = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/, "AVD-Name: klein beginnend, dann a-z, 0-9, -, _ (2–32 Zeichen)"),
  image: z.string().min(3).max(120),
  profile: z.string().min(2).max(64),
});
export type DeviceAvdCreateInput = z.infer<typeof DeviceAvdCreateInput>;

/** Installierte System-Images (Verzeichnisliste unter <sdkRoot>/system-images). */
export const DeviceImageList = z.object({ images: z.array(z.string().min(3).max(120)) });
export type DeviceImageList = z.infer<typeof DeviceImageList>;

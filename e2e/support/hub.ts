import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { standIn } from "./stand-in.ts";

export const repoRoot = resolve(import.meta.dirname, "../..");
/**
 * BUG-0183: das E2E-Eigene — nicht `apps/pwa/dist`. Der laufende Hub auf Kais
 * Rechner servt genau dieses Verzeichnis; jedes Test-Lager hat sein Bündel
 * überschrieben, auch von einem anderen Zweig aus. Ergebnis: am Handy waren
 * gerade erst gemachte Korrekturen wieder weg, ohne dass jemand etwas gebaut hätte.
 */
export const E2E_PWA_DIST = resolve(repoRoot, "apps/pwa/dist-e2e");
const binDir = resolve(import.meta.dirname, "bin");

export interface HubOptions {
  /** "process" (default) or "tmux" — the tmux runner gets a private tmux server. */
  runner?: "process" | "tmux";
  interruptedDummy?: { resume: boolean; auto?: boolean; failResume?: boolean };
  /** ADR-0076 Nachtrag: der Dummy stirbt im ersten Zug am Kontingent —
   * Suite für die Limit-Wiederaufnahme (e2e/specs/limit-auto-resume.spec.ts). */
  limitDummy?: boolean;
  /** Factory-Tests: maki über den lokalen ACP-Prozess registrieren. */
  maki?: boolean;
  /** Park steer prompts behind the approval queue (T2.4). */
  requireStepApprovals?: boolean;
  /** Dummy adapter: events per turn before it stops generating (0 = endless). */
  dummyAutoStop?: number;
  /** P43.5 K2: explicit event rate for rendering measurements. */
  dummyEventsPerSecond?: number;
  /** ADR-0083: echtes Streaming im Fixture-Hub (Frames + spaeter Block). */
  dummyLiveFrames?: boolean;
  dummyBlockLeadMs?: number;
  /** ADR-0083: Frames auch fuer thinking — fuer Tests an der Live-Darstellung des Denkens. */
  dummyLiveThinkingFrames?: boolean;
  /** BUG-0207: langer verteilter Live-Stream (Frames pro Block, Abstand in ms). */
  dummyLiveChunks?: number;
  dummyLiveChunkDelayMs?: number;
  /** BUG-0208: false = der Dummy sendet nur assistant-Bloecke (ein Zug, ein Block). */
  dummyCycleTypes?: boolean;
  /** EPIC-P6: this hub's host id in the fleet. */
  hostId?: string;
  /** 2026-10-26: readable fleet label (config hostLabel) — two hubs on one
   * machine would otherwise both answer with the same hostname. */
  label?: string;
  /** T10.2: a whisper-compatible `/inference` URL for local STT. */
  sttUrl?: string;
  /** T12.10: a local PCM16 streaming-ASR WebSocket endpoint. */
  sttStreamingUrl?: string;
  /** T9/P10.5: an OpenAI-compatible model URL (…/v1) for commands and video summaries. */
  assistantUrl?: string;
  /** EPIC-P17 T17.4: the hub's steer wait (config field steerWaitMs). */
  steerWaitMs?: number;
  /** EPIC-P39: zusätzliche Test-Origins für den Browser-Arbeitsplatz (Config browserOrigins). */
  browserOrigins?: string[];
  /** EPIC-P39: false = sichtbares Fenster (nur mit Anzeige; in E2E nicht genutzt). */
  browserHeadless?: boolean;
  /** EPIC-P42 (ADR-0067): echte Android-Abnahme — SDK-/AVD-Pfade; nur aktiv mit env ANCIENTVOID_E2E_ANDROID=1.
   * In-App-Setup (2026-11-24): lokale Spiegel-URLs für JDK/cmdline-tools — kein Cloud-Egress im Test.
   * kvmPath: KVM-Stand-in (z. B. /dev/null) — Hosted-Runner haben kein /dev/kvm. */
  devices?: { sdkRoot?: string; avdHome?: string; avd?: string; kvmPath?: string; setup?: { jdkUrl: string; toolsUrl: string } };
  /** Echte Abnahme (P37 T37.6): absoluter Pfad zum echten glab statt Stub. */
  forgeCommand?: string;
  /** EPIC-P59 (ADR-0078): aiMetrics-Abschnitt für die Hub-Config (Test-Server, Intervall). */
  aiMetrics?: Record<string, unknown>;
  /** EPIC-P79 (ADR-0102): inference-Abschnitt für die Hub-Config (Engine-Stand-ins). */
  inference?: Record<string, unknown>;
  /** EPIC-P80 (ADR-0118): pentest-Abschnitt für die Hub-Config (Deck-Fassade im Prozess). */
  pentest?: Record<string, unknown>;
  /** ADR-0087: Allowlist für den PWA-Terminal-Tab. */
  terminals?: Array<{ id: string; label: string; ssh?: string; local?: boolean; shell?: string }>;
  /** ADR-0087 Nachtrag 2026-11-23: Auto-Erkennung der Host-Shells (Default: an). */
  terminalAutodetect?: boolean;
  /** EPIC-P54 (ADR-0110): registriert den hub-getriebenen Ralph-Loop mit Stand-in-CLI. */
  ralphHub?: boolean;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

class PortTaken extends Error {
  constructor() {
    super("port answered by another hub");
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolvePort(port));
    });
  });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeProject(root: string, name: string, readme: string, extra: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), readme);
  for (const [path, content] of Object.entries(extra)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "--local", "user.email", "e2e@ancientvoid.local");
  git(dir, "config", "--local", "user.name", "e2e");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

/**
 * One real hub process (apps/hub/src/main.ts) on its own data dir,
 * port, projects, token and — for the tmux runner — its own tmux server.
 * Provider CLIs are the stand-ins in e2e/support/bin; nothing reaches a
 * cloud provider or the user's own hub, tmux sessions, qmd index or
 * ~/.claude.
 */
export class TestHub {
  readonly root: string;
  readonly dataDir: string;
  readonly projectsDir: string;
  readonly alpha: string;
  readonly beta: string;
  readonly logPath: string;
  token = "";
  port = 0;
  private child: ChildProcess | undefined;
  private readonly tmuxDir: string;
  private readonly configPath: string;
  private readonly options: HubOptions;

  private constructor(options: HubOptions) {
    this.options = options;
    // Short prefix: tmux socket paths are limited to ~100 bytes.
    this.root = mkdtempSync(join(tmpdir(), "ancientvoid-e2e-"));
    this.dataDir = join(this.root, "data");
    this.projectsDir = join(this.root, "projects");
    this.tmuxDir = join(this.root, "tmux");
    this.logPath = join(this.root, "hub.log");
    this.configPath = join(this.root, "hub.config.json");
    mkdirSync(this.tmuxDir, { recursive: true });
    mkdirSync(join(this.root, "claude", "projects"), { recursive: true });
    mkdirSync(join(this.root, "cursor"), { recursive: true });
    this.alpha = makeProject(this.projectsDir, "alpha", "# Alpha\n\nDas Handbuch beschreibt den Handoff zwischen PC und Handy.\n", {
      ".claude/skills/neon/SKILL.md":
        "---\nname: neon\ndescription: Neon-Styling für die Oberfläche\nextends: task\n---\nNutze Neonfarben.\n",
      // T7.6: code to search in (a known function in .ts and .py).
      "src/auth.ts": "import { z } from \"zod\";\n\n/** Prüft einen Token. */\nexport function parseToken(raw: string): string {\n  return raw.trim();\n}\n",
      "tools/check.py": "import sys\n\n\ndef parse_token(raw):\n    return raw.strip()\n",
    });
    this.beta = makeProject(this.projectsDir, "beta", "# Beta\n\nZweites Projekt.\n");
  }

  static async start(options: HubOptions = {}): Promise<TestHub> {
    const hub = new TestHub(options);
    hub.issueToken();
    // freePort() can race with a parallel worker's hub — retry on a new port.
    for (let attempt = 1; ; attempt++) {
      hub.port = await freePort();
      hub.writeConfig();
      try {
        await hub.boot();
        break;
      } catch (err) {
        if (!(err instanceof PortTaken) || attempt >= 5) throw err;
      }
    }
    return hub;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private writeConfig(): void {
    // 79928f3: the opencode discovery source defaults to the REAL
    // ~/.local/share/opencode — isolate it with a valid but empty store,
    // so the source runs (zero rows) without leaking host sessions in.
    const odb = new DatabaseSync(join(this.root, "opencode.db"));
    odb.exec("CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)");
    odb.close();
    const config = {
      dataDir: this.dataDir,
      autoResumeInterrupted: this.options.interruptedDummy?.auto ?? false,
      ...(this.options.hostId ? { hostId: this.options.hostId } : {}),
      ...(this.options.label ? { hostLabel: this.options.label } : {}),
      workerRunner: this.options.runner ?? "process",
      projectRoots: [this.projectsDir],
      requireStepApprovals: this.options.requireStepApprovals ?? false,
      ...(this.options.steerWaitMs !== undefined ? { steerWaitMs: this.options.steerWaitMs } : {}),
      ...(this.options.browserOrigins ? { browserOrigins: this.options.browserOrigins } : {}),
      ...(this.options.devices
        ? { devices: { ...(this.options.devices.sdkRoot ? { sdkRoot: this.options.devices.sdkRoot } : {}), avdHome: this.options.devices.avdHome, avdAllowlist: this.options.devices.avd ? [this.options.devices.avd] : [], ...(this.options.devices.kvmPath ? { kvmPath: this.options.devices.kvmPath } : {}), ...(this.options.devices.setup ? { setup: this.options.devices.setup } : {}) } }
        : {}),
      ...(this.options.sttUrl ? { stt: {
        url: this.options.sttUrl,
        engine: "whisper-e2e",
        ...(this.options.sttStreamingUrl ? { streaming: { url: this.options.sttStreamingUrl } } : {}),
      } } : {}),
      ...(this.options.assistantUrl ? { assistant: { model: { url: this.options.assistantUrl, model: "e2e-model" } } } : {}),
      ...(this.options.aiMetrics ? { aiMetrics: this.options.aiMetrics } : {}),
      ...(this.options.inference ? { inference: this.options.inference } : {}),
      ...(this.options.pentest ? { pentest: this.options.pentest } : {}),
      ...(this.options.terminals ? { terminals: this.options.terminals } : {}),
      ...(this.options.terminalAutodetect === false ? { terminalAutodetect: false } : {}),
      media: { ytDlp: standIn("yt-dlp") },
      forge: { gitlab: { command: this.options.forgeCommand ?? standIn("glab") } },
      server: { host: "127.0.0.1", port: this.port, pwaDir: E2E_PWA_DIST },
      discovery: { claudeDir: join(this.root, "claude"), claudeCommand: standIn("claude"), cursorUserDir: join(this.root, "cursor"), opencodeDataDir: this.root, piDir: join(this.root, "pi-sessions"), ompDir: join(this.root, "omp-sessions"), makiDir: join(this.root, "maki-sessions"), codexDir: join(this.root, "codex-sessions"), hermesDir: join(this.root, "hermes-home") },
      // EPIC-P19: ein deterministischer Loop ohne Fremdsystem (Fake aus dem Testkit).
      loops: [
        { id: "fake-loop", module: "@ancientvoid/adapter-testkit/fake-loop" },
        { id: "securesight-factory", module: "@ancientvoid/loop-securesight-factory", config: { pollMs: 500, factory: standIn("factory") } },
        // EPIC-P54: hub-getriebener Ralph mit einer Stand-in-CLI (echte Agenten bleiben der Menschenabnahme).
        ...(this.options.ralphHub ? [{ id: "ralph-hub", module: "@ancientvoid/loop-ralph-hub", config: { stateDir: ".ralph", turnTimeoutMs: 60_000, maxTurns: 10 } }] : []),
      ],
      adapters: [
        {
          id: "dummy",
          module: this.options.interruptedDummy ? join(repoRoot, "e2e/support/interrupted-dummy.ts") : this.options.limitDummy ? join(repoRoot, "e2e/support/limit-dummy.ts") : "@ancientvoid/adapter-dummy",
          config: { hubResume: this.options.interruptedDummy?.resume ?? this.options.limitDummy === true, failResume: this.options.interruptedDummy?.failResume ?? false, eventsPerSecond: this.options.dummyEventsPerSecond ?? 20, autoStopAfterEvents: this.options.dummyAutoStop ?? 14, liveFrames: this.options.dummyLiveFrames ?? false, blockLeadMs: this.options.dummyBlockLeadMs ?? 0, liveThinkingFrames: this.options.dummyLiveThinkingFrames ?? false, liveChunks: this.options.dummyLiveChunks ?? 2, liveChunkDelayMs: this.options.dummyLiveChunkDelayMs ?? 0, cycleTypes: this.options.dummyCycleTypes ?? true },
        },
        {
          // BUG-0061: dsh via ACP (ADR-0018) under a free-form id, like a
          // real hub.config.json — the enhance one-shot runs the dsh
          // stand-in from PATH. No spec starts a session on it (the
          // stand-in speaks headless, not ACP).
          id: "deepseek",
          module: "@ancientvoid/adapter-acp",
          config: { preset: "dsh" },
        },
        {
          id: "opencode",
          module: "@ancientvoid/adapter-opencode",
          config: { command: standIn("opencode"), model: "e2e/fake-model" },
        },
        {
          // T7.8: a stand-in claude CLI with the real stream-json shapes.
          id: "claude",
          module: "@ancientvoid/adapter-claude",
          config: { command: standIn("claude"), claudeDir: join(this.root, "claude") },
        },
        {
          // T7.2: codex in app-server mode (stand-in, real v2 protocol).
          id: "codex",
          module: "@ancientvoid/adapter-codex",
          config: { command: standIn("codex") },
        },
        {
          // T7.5: an observer — reads Claude transcripts, cannot steer.
          id: "claude-clip",
          module: "@ancientvoid/adapter-claude-clip",
          config: { claudeDir: join(this.root, "claude"), pollIntervalMs: 200 },
        },
        {
          // cursor-agent CLI stand-in: claude-style stream-json, --resume,
          // --list-models (adapter-cursor).
          id: "cursor",
          module: "@ancientvoid/adapter-cursor",
          config: { command: standIn("cursor-agent"), model: "auto" },
        },
        {
          // BUG-0065/0066: pi coding agent stand-in (`pi -p --mode json`).
          id: "pi",
          module: "@ancientvoid/adapter-pi",
          config: { command: standIn("pi"), model: "evo/qwen-e2e", contextWindowTokens: 131072 },
        },
        ...(this.options.maki ? [{
          id: "maki",
          module: "@ancientvoid/adapter-acp",
          config: {
            preset: "maki",
            command: [standIn("acp-agent")],
            model: "lokal/klein",
            modelsCommand: [process.execPath, "-e", "process.stdout.write('lokal/klein\\nlokal/glm-5.3\\n')"],
          },
        }] : []),
        {
          // T7.2: an ACP harness (stand-in agent, real protocol) — with the
          // Factory pattern: a configured default model plus a listing
          // command, so the start form shows a dropdown with the default.
          id: "acp",
          module: "@ancientvoid/adapter-acp",
          config: {
            command: [standIn("acp-agent")],
            label: "ACP-Agent",
            contextWindowTokens: 200,
            model: "lokal/klein",
            modelsCommand: [process.execPath, "-e", "process.stdout.write('cloud/gross\\nlokal/klein\\n')"],
          },
        },
      ],
    };
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /** Another token with its own label (e.g. `companion:e2e`) — works while the hub runs (same SQLite file). */
  extraToken(label: string): string {
    const out = execFileSync(process.execPath, [join(repoRoot, "apps/hubctl/src/cli.ts"), "token", "issue", label, "--db", join(this.dataDir, "hub.db")], { encoding: "utf8" });
    const token = out.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"));
    if (!token) throw new Error(`hubctl token issue gave no token:\n${out}`);
    return token;
  }

  /** EPIC-P42: Binär-Antworten (PNG-Frames) mit Headern — `api` parst nur JSON. */
  apiRaw(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    return new Promise((resolveApi, reject) => {
      const req = request(
        `${this.origin}${path}`,
        {
          method: init.method ?? (payload === undefined ? "GET" : "POST"),
          agent: false,
          headers: {
            authorization: `Bearer ${init.token ?? this.token}`,
            ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolveApi({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  private issueToken(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "apps/hubctl/src/cli.ts"), "token", "issue", "e2e", "--db", join(this.dataDir, "hub.db")],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const token = out.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"));
    if (!token) throw new Error(`hubctl token issue gave no token:\n${out}`);
    this.token = token;
  }

  private async boot(): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANCIENTVOID_CONFIG: this.configPath,
      ANCIENTVOID_LOG: "warn",
      // Die Attrappen über den PATH: der Ordner liegt im PATH, gestartet wird über
      // spawnArgv (Windows: Node vor den Skriptpfad, keine Shell-Schicht).
      PATH: [binDir, process.env.PATH ?? ""].join(delimiter),
      TMUX_TMPDIR: this.tmuxDir,
      QMD_E2E_STATE: join(this.root, "qmd-state.json"),
      // ADR-0060: „Endpunkt anlegen“ schreibt in pi's models.json — nie in die echte des Nutzers.
      PI_CODING_AGENT_DIR: join(this.root, "pi-agent"),
    };
    delete env.TMUX;
    // Hosted-Runner setzen ANDROID_SDK_ROOT auf ein SDK ohne emulator-Binary — die
    // Geräte-Fähigkeiten würden danach über das Host-SDK urteilen statt „Kein SDK
    // konfiguriert“ zu melden. Echte Abnahme übergibt sdkRoot per hubOptions.
    delete env.ANDROID_SDK_ROOT;
    delete env.ANDROID_HOME;
    const log = createWriteStream(this.logPath, { flags: "a" });
    const child = spawn(process.execPath, [join(repoRoot, "apps/hub/src/main.ts")], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    this.child = child;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`hub exited with ${child.exitCode}, see ${this.logPath}`);
      try {
        const res = await this.api("/api/ready");
        if (res.status === 200) {
          // /api/ready is public: a parallel test's hub on the same port
          // answers it too. Only our own token proves it is our hub.
          if ((await this.api("/api/sessions")).status === 200) return;
          child.kill("SIGKILL");
          throw new PortTaken();
        }
      } catch (err) {
        if (err instanceof PortTaken) throw err;
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`hub not ready within 20 s, see ${this.logPath}`);
  }

  /** Hard kill (K7 drill) or clean stop. */
  async kill(signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill(signal);
    if (signal !== "SIGKILL") {
      // BUG-0106/0107 (auth-Flake): Unter Host-Last übersteigt der
      // SIGTERM-Shutdown (Sessions sauber stoppen, fsync) die Restzeit
      // des Test-Timeouts — „Tearing down hub exceeded …". Begrenzter
      // Grace (5 s), dann hart beenden: Test-Hub, keine Produkt-Semantik.
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    } else {
      await exited;
    }
    this.child = undefined;
  }

  /** Same data dir, port and token — what a phone sees after a hub crash. */
  async restart(signal: NodeJS.Signals = "SIGKILL"): Promise<number> {
    await this.kill(signal);
    const t0 = Date.now();
    await this.boot();
    return Date.now() - t0;
  }

  async stop(): Promise<void> {
    await this.kill("SIGTERM");
    try {
      execFileSync("tmux", ["kill-server"], { env: { ...process.env, TMUX_TMPDIR: this.tmuxDir, TMUX: "" }, stdio: "ignore" });
    } catch {
      // no tmux server was started
    }
    // BUG-0179: seit die Windows-Attrappen wirklich starten, halten ihre Kind-Prozesse
    // (cmd.exe + node) das Temp-Root manchmal noch einen Moment — rmSync gibt dann EPERM.
    // Begrenzt nachsehen statt den Test an der Raumuestzung scheitern zu lassen: hier steht
    // ein Test-Hub, keine Produktsemantik.
    for (let versuch = 1; versuch <= 5; versuch++) {
      try {
        rmSync(this.root, { recursive: true, force: true });
        return;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (versuch === 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY")) throw err;
        await new Promise((r) => setTimeout(r, 400 * versuch));
      }
    }
  }

  /** node:http without keep-alive: Node 26's fetch (undici 8.9) stalls for
   * seconds when it reuses an idle keep-alive socket — even against a bare
   * http.createServer. The browser and hubctl are not affected. */
  api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    return new Promise((resolveApi, reject) => {
      const req = request(
        `${this.origin}${path}`,
        {
          method: init.method ?? (payload === undefined ? "GET" : "POST"),
          agent: false,
          headers: {
            authorization: `Bearer ${this.token}`,
            ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (text += chunk));
          res.on("end", () => resolveApi({ status: res.statusCode ?? 0, body: (text ? JSON.parse(text) : null) as T }));
        },
      );
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  /** Session ids created through the API, newest first. */
  async sessions(): Promise<{ id: string; adapter: string; status: string; nativeSessionId: string | null }[]> {
    return (await this.api<{ id: string; adapter: string; status: string; nativeSessionId: string | null }[]>("/api/sessions")).body;
  }

  async createSession(spec: { adapter: string; project?: string; prompt?: string; model?: string; args?: Record<string, unknown>; budgetUsd?: number; workspaceMode?: "worktree" | "direct"; confirmDirty?: boolean; confirmSharedFolder?: boolean; adoptNativeSessionId?: string }): Promise<string> {
    const res = await this.api<{ id?: string; error?: string }>("/api/sessions", {
      body: { project: this.alpha, ...spec },
    });
    if (res.status !== 201 || !res.body.id) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  async events(sessionId: string): Promise<{ seq: number; ts: string; type: string; summary: string; payload: Record<string, unknown> }[]> {
    return (await this.api<{ seq: number; ts: string; type: string; summary: string; payload: Record<string, unknown> }[]>(
      `/api/sessions/${sessionId}/events?limit=2000`,
    )).body;
  }

  /** Poll until `check` is true — no fixed sleeps (write-tests rule). */
  async until(check: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for: ${what}`);
  }
}

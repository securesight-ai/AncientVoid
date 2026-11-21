#!/usr/bin/env node
import { createHubTeam } from "./modules/team/index.ts";
import { sttModuleConfig } from "./modules/voice/stt-wiring.ts";
/**
 * AncientVoid hub daemon entry.
 *
 *   ANCIENTVOID_CONFIG=./hub.config.json node src/main.ts
 *
 * Boot order (P0): config → db → adapters → recovery (K7) → HTTP/WS → PWA.
 */
import { chmodSync, mkdirSync, existsSync } from "node:fs";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { homedir, hostname, loadavg, cpus, totalmem, freemem } from "node:os";
import { toHostId, sessionMainSyncPath } from "@ancientvoid/contracts";
import { projectName } from "@ancientvoid/core";
import { resolve } from "node:path";
import type { WorkerRunner, DiscoverySource } from "@ancientvoid/contracts";
import {
  Gatekeeper,
  PushService,
  AttachmentStore,
  MediaJobs,
  DesktopService,
  SettingsStore,
  AdapterRegistry,
  ApprovalService,
  EventStore,
  HubDatabase,
  acquireHubPidLock,
  SessionManager,
  TokenService,
  WebAuthnStore,
  WorktreeManager,
  createJsonLogger,
  watchMemory,
  LoopRegistry,
  loadLoops,
  loopAsAdapter,
  InMemoryMetrics,
  ReviewStore,
  ProjectTrustStore,
  BrowserService,
  DeviceService,
  loadConfig,
  loadReportingSinks,
  ClaudeLive,
  claudeDiscoverySource,
  cursorDiscoverySource,
  defaultClaudeDir,
  defaultCursorUserDir,
  codexDiscoverySource,
  defaultCodexDir,
  defaultCopilotDir,
  copilotDiscoverySource,
  defaultHermesDir,
  defaultMakiDir,
  hermesDiscoverySource,
  defaultOmpDir,
  defaultOpencodeDataDir,
  defaultPiDir,
  makiDiscoverySource,
  opencodeDiscoverySource,
  piFamilyDiscoverySource,
  type HubConfig,
  MainSyncSettingsService,
  MainSyncScheduler,
  GitHubClient,
  IssueBridgeJournal,
  IssueSessionBridge,
  isProjectPathAllowed,
  resolveGitHubTokenFile,
} from "@ancientvoid/core";
import { TmuxRunner, ProcessRunner } from "@ancientvoid/workers";
import type { AdapterFactory } from "@ancientvoid/contracts";
import { createHubApp } from "./app.ts";
import { ForgeService } from "./modules/forge/forge-service.ts";
import { createHubAutomationService } from "./modules/automations/automations-service.ts";
import { ExternalJobsService } from "./modules/automations/external-jobs.ts";
import { createAiMetricsSampler, createInferenceTracker, type AiMetricsSamplerServer, type InferenceEngineConfig, type InferenceTracker } from "@ancientvoid/core";
import { StatisticsService } from "./modules/statistics/statistics.service.ts";
import { createPermissionBridge } from "./modules/approvals/permission-bridge.ts";

// `dummy` used to be hardcoded here, always visible in every real hub's
// adapter list/status rows regardless of whether anyone wanted it — real
// user feedback (2026-09-19): looks like test clutter next to genuine
// providers. It's a completely normal adapter otherwise (@ancientvoid/adapter-dummy,
// same registration path as claude/codex/etc.) — add it to
// hub.config.json's own `adapters` array, same as any other adapter, when
// you actually want it for local testing.
const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {};
let releaseHubPidLock: (() => Promise<void>) | undefined;

function discoverySources(config: HubConfig, claudeLive: ClaudeLive): DiscoverySource[] {
  const sources: DiscoverySource[] = [];
  const claudeDir = config.discovery.claudeDir ? resolve(config.discovery.claudeDir) : defaultClaudeDir();
  const cursorUserDir = config.discovery.cursorUserDir ? resolve(config.discovery.cursorUserDir) : defaultCursorUserDir();
  if (config.discovery.claudeDir || existsSync(claudeDir)) sources.push(claudeDiscoverySource(claudeDir, config.projectRoots, claudeLive));
  if (config.discovery.cursorUserDir || existsSync(cursorUserDir)) sources.push(cursorDiscoverySource(cursorUserDir));
  const opencodeDataDir = config.discovery.opencodeDataDir ? resolve(config.discovery.opencodeDataDir) : defaultOpencodeDataDir();
  if (config.discovery.opencodeDataDir || existsSync(opencodeDataDir)) sources.push(opencodeDiscoverySource(opencodeDataDir, config.projectRoots));
  // ADR-0041: pi, oh-my-pi and maki — each only when its store exists (or is configured).
  const piDir = config.discovery.piDir ? resolve(config.discovery.piDir) : defaultPiDir();
  if (config.discovery.piDir || existsSync(piDir)) sources.push(piFamilyDiscoverySource("pi", piDir, config.projectRoots));
  const ompDir = config.discovery.ompDir ? resolve(config.discovery.ompDir) : defaultOmpDir();
  if (config.discovery.ompDir || existsSync(ompDir)) sources.push(piFamilyDiscoverySource("omp", ompDir, config.projectRoots));
  const makiDir = config.discovery.makiDir ? resolve(config.discovery.makiDir) : defaultMakiDir();
  if (config.discovery.makiDir || existsSync(makiDir)) sources.push(makiDiscoverySource(makiDir, config.projectRoots));
  // EPIC-P34 T34.8: Codex und Hermes, ebenfalls nur lesend.
  const codexDir = config.discovery.codexDir ? resolve(config.discovery.codexDir) : defaultCodexDir();
  if (config.discovery.codexDir || existsSync(codexDir)) sources.push(codexDiscoverySource(codexDir, config.projectRoots));
  const hermesDir = config.discovery.hermesDir ? resolve(config.discovery.hermesDir) : defaultHermesDir();
  if (config.discovery.hermesDir || existsSync(hermesDir)) sources.push(hermesDiscoverySource(hermesDir, config.projectRoots));
  // EPIC-P35 T35.5: Copilot-Store, ebenfalls nur lesend.
  const copilotDir = config.discovery.copilotDir ? resolve(config.discovery.copilotDir) : defaultCopilotDir();
  if (config.discovery.copilotDir || existsSync(copilotDir)) sources.push(copilotDiscoverySource(copilotDir, config.projectRoots));
  return sources;
}

async function main(): Promise<void> {
  // Hub data includes local credentials and user content; future files,
  // WAL/SHM sidecars, worker logs and attachment directories stay private.
  process.umask(0o077);
  const configPath = resolve(process.env.ANCIENTVOID_CONFIG ?? "hub.config.json");
  const { config } = await loadConfig(configPath);
  const sttConfig = sttModuleConfig(config.stt);
  const claudeLive = new ClaudeLive(config.discovery.claudeCommand);
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  releaseHubPidLock = await acquireHubPidLock(dataDir);

  // M-2 (red-team review, 2026-09-18, T4.10): an empty projectRoots is a
  // real, honestly-documented default (isProjectPathAllowed() then
  // accepts any path — packages/core/src/projects.ts), but it was silent
  // at startup, unlike every other security-relevant default this hub
  // already warns about (ANCIENTVOID_EXPOSE, WebAuthn's localhost-only rpId).
  const logger = createJsonLogger({ fields: { service: "ancientvoid-hub" } });
  const metrics = new InMemoryMetrics();
  const startedAt = Date.now();

  if (config.projectRoots.length === 0) {
    logger.warn(
      "projectRoots is empty — any authenticated device can start a session against ANY filesystem path the hub process can read. Set projectRoots in hub.config.json to restrict this.",
    );
  }

  const db = new HubDatabase(resolve(dataDir, "hub.db"));
  const store = new EventStore(dataDir);
  const tokens = new TokenService(db);

  // Worker runner: config.workerRunner, with a process fallback when tmux
  // is asked for but missing.
  let runner: WorkerRunner =
    config.workerRunner === "process"
      ? new ProcessRunner()
      : new TmuxRunner(resolve(dataDir, "workers"), undefined, (level, msg, fields) => logger[level](msg, fields));
  if (!(await runner.isAvailable())) {
    logger.warn("tmux not available — falling back to process runner (no attach, no survival across restarts)");
    runner = new ProcessRunner();
  }

  // Adapter registry: built-ins + config modules (own providers/endpoints).
  const registry = new AdapterRegistry();
  for (const [id, factory] of Object.entries(BUILTIN_ADAPTERS)) {
    registry.register(id, factory);
  }
  if (config.adapters.length > 0) {
    await registry.loadAll(config.adapters, configPath);
  }
  // EPIC-P19: Loops / Dark Factories. Jeder geladene Connector wird als interner Adapter `loop:<id>` registriert.
  const loops = new LoopRegistry();
  if (config.loops.length > 0) {
    for (const error of await loadLoops(loops, config.loops, configPath)) logger.warn("loop not loaded", { error });
  }
  for (const info of loops.list()) {
    const connector = loops.connector(info.id);
    if (connector) registry.register(`loop:${connector.id}`, () => loopAsAdapter(connector, { stateDir: resolve(dataDir, "loops") }), undefined, `loop:${connector.id}`);
  }
  logger.info("adapters loaded", {
    adapters: registry.list().map((a) => `${a.id}@${a.adapter.version}`).join(", ") || "(none)",
  });

  // T2.1: real per-session git worktree isolation (EPIC-P2). Projects that
  // aren't a git repo fall back to running in-place — see
  // WorktreeManager's own doc comment for why that's a named fallback, not
  // a silent gap.
  const worktrees = new WorktreeManager(resolve(dataDir, "worktrees"));
  // T2.4: the queue + its REST routes are always real and reachable
  // (config.requireStepApprovals only controls whether SessionManager
  // actually gates steer(prompt) behind it) — see HubConfig's own doc
  // comment for why the gate itself defaults off.
  const approvals = new ApprovalService(db);
  // T4.1/ADR-0009: empty by default (HubConfig.reportingSinks.default([])) —
  // no digests, no new network egress unless an operator explicitly
  // configures a sink module.
  const reportingSinks = await loadReportingSinks(config.reportingSinks, configPath);
  if (reportingSinks.length > 0) {
    logger.info("reporting sinks configured", { count: reportingSinks.length });
  }
  // ADR-0011 Erweiterung: mirror sessions read the same store the
  // discovery scan uses — one resolved path, two features.
  const opencodeDataDir = config.discovery.opencodeDataDir ? resolve(config.discovery.opencodeDataDir) : defaultOpencodeDataDir();
  // T7.10 + EPIC-P67 T67.3: Settings müssen vor dem SessionManager stehen —
  // dessen Main-Sync-Resolver (Stufe 1, ADR-0088) liest sie je Session-Start.
  const settings = new SettingsStore(db);
  const mainSyncService = new MainSyncSettingsService(settings);
  const sessions = new SessionManager(
    db,
    store,
    registry,
    runner,
    undefined,
    worktrees,
    config.requireStepApprovals ? approvals : undefined,
    config.dailyCapUsd,
    reportingSinks,
    // T17.4: the steer wait travels with the rest of the observability bag.
    { logger: logger.child({ component: "sessions" }), metrics, autoResumeInterrupted: config.autoResumeInterrupted, steerWaitMs: config.steerWaitMs },
    opencodeDataDir,
    config.defaultPermissionMode,
    // EPIC-P67 Stufe 1: Basis neuer Worktrees ist origin/<Hauptbranch>, nach
    // effektiven Einstellungen (global + Projekt-Override, ADR-0088).
    mainSyncService.resolver(),
  );
  // EPIC-P29 / ADR-0051 §2: die Manifest-Freigabe braucht die Queue IMMER —
  // `requireStepApprovals` steuert nur das steer.prompt-Gate, nicht ob ein
  // Workspace überhaupt startet (gleiche Figur wie enableToolPermissions).
  sessions.enableWorkspaceApprovals(approvals);

  // T7.2 / ADR-0018 §3: providers ask before a tool runs — always through
  // the approval queue, independent of requireStepApprovals.
  const loopHost = config.server.host === "0.0.0.0" ? "127.0.0.1" : config.server.host;
  // T7.9 (ADR-0024): every tool request is labelled before it is shown.
  const gk = config.gatekeeper;
  const gatekeeperKey = gk.model?.apiKeyFile ? (await readFile(resolve(gk.model.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  if (gk.model?.apiKeyFile && !gatekeeperKey) logger.warn("gatekeeper key file unreadable — model calls will fail (fail-closed)", { file: gk.model.apiKeyFile });
  const gatekeeper = gk.enabled
    ? new Gatekeeper({
        ...(gk.model ? { model: { url: gk.model.url, model: gk.model.model, ...(gatekeeperKey ? { apiKey: gatekeeperKey } : {}) } } : {}),
        timeoutMs: gk.timeoutMs,
        minConfidence: gk.minConfidence,
      })
    : undefined;
  // T9.2: the same local model serves text commands unless one is set apart.
  const assistantCfg = config.assistant.model ?? gk.model;
  const assistantKey = assistantCfg?.apiKeyFile ? (await readFile(resolve(assistantCfg.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  const assistantModel = assistantCfg ? { url: assistantCfg.url, model: assistantCfg.model, ...(assistantKey ? { apiKey: assistantKey } : {}) } : undefined;
  sessions.enableAiTitles(assistantModel);
  sessions.enableToolPermissions({
    approvals,
    timeoutMs: config.toolApprovalTimeoutMs,
    ...(config.toolApprovals === "auto" ? { autoApprove: true } : {}),
    bridge: createPermissionBridge({ tokens, hubUrl: `http://${loopHost}:${config.server.port}`, dir: resolve(dataDir, "bridges") }),
    ...(gatekeeper ? { gatekeeper } : {}),
  });

  // T7.10 (ADR-0022): uploaded files, local extraction first, Gemini only
  // with a key the user set in the PWA settings.
  // T8.3 (ADR-0026): Web Push — off until a person turns it on.
  const push = new PushService(db, settings, { hostId: config.hostId ?? toHostId(hostname()), subject: config.push.subject });
  sessions.onNotification((n) => push.notify(n));
  // BUG-0074/0075: der Hub starb an Heap-OOM ohne Vorwarnung — Stufenwechsel stehen jetzt im Log und in /api/health.
  watchMemory((check, previous) =>
    logger[check.level === "critical" ? "error" : check.level === "warn" ? "warn" : "info"](`hub heap ${previous} → ${check.level}`, {
      heapUsedMb: check.heapUsedMb,
      heapLimitMb: check.heapLimitMb,
      rssMb: check.rssMb,
    }),
  );
  const tessdataDir = config.ocr.tessdataDir ? resolve(config.ocr.tessdataDir) : undefined;
  const attachments = new AttachmentStore(db, resolve(dataDir, "attachments"), () => ({ gemini: settings.gemini(), ...(tessdataDir ? { tessdataDir } : {}) }));

  // EPIC-P10.5 (ADR-0030): video analysis — local services first, Gemini
  // only for jobs that allow the cloud.
  const mc = config.media;
  const visionKey = mc.vision?.apiKeyFile ? (await readFile(resolve(mc.vision.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  const media = mc.enabled
    ? new MediaJobs(db, {
        dir: resolve(dataDir, "media"),
        attachments,
        ...(config.stt ? { stt: { url: config.stt.url, timeoutMs: 15 * 60_000 } } : {}),
        ...(assistantModel ? { summaryModel: { ...assistantModel, timeoutMs: 10 * 60_000 } } : {}),
        ...(mc.vision ? { vision: { url: mc.vision.url, model: mc.vision.model, ...(visionKey ? { apiKey: visionKey } : {}) } } : {}),
        gemini: () => settings.gemini(),
        ytDlp: mc.ytDlp,
        keepSource: mc.keepSource,
        limits: { maxDurationSec: mc.maxDurationSec, maxBytes: mc.maxBytes, maxFrames: mc.maxFrames },
        tessdataDir,
        log: (message, meta) => logger.warn(message, meta ?? {}),
      })
    : undefined;

  // K7: recover sessions from JSONL + snapshots before accepting traffic.
  const recovery = await sessions.recoverAll();
  logger.info("recovery finished", {
    recovered: recovery.recovered,
    failed: recovery.failed,
    reaped: recovery.reaped.length,
  });
  // K7 für Zug-Messwerte: fehlende Zeilen aus dem JSONL nachbauen, ohne den Start zu blockieren.
  void sessions
    .backfillTurnMetrics()
    .then((n) => logger.info("turn metrics backfilled", { sessions: n }))
    .catch((err) => logger.warn("turn metrics backfill failed", { err: err instanceof Error ? err.message : String(err) }));

  // EPIC-P39 / ADR-0059: Browser-Arbeitsplatz. Ziele = Loopback-Ports der laufenden Workspace-Services der Session
  // plus config.browserOrigins; Contexts beendeter/archivierter Sessions räumt der Dienst selbst ab.
  const browser = new BrowserService({
    dataDir,
    extraOrigins: config.browserOrigins,
    headless: config.browserHeadless,
    portsFor: async (id) => ((await sessions.workspaceStatus(id).catch(() => null))?.services ?? []).filter((s) => s.state === "ready" && s.port !== null).map((s) => s.port as number),
    isActive: (id) => {
      const rec = sessions.get(id);
      return Boolean(rec) && !rec!.archived && !["stopped", "error"].includes(rec!.status);
    },
  });

  // EPIC-P42 / ADR-0067: Android-Testgeräte. AV-eigene Emulatoren laufen mit Ownership-Marker und überleben einen
  // Hub-Neustart (Adoption nur mit belegtem Eigentum); ohne SDK/KVM meldet der Dienst ehrlich „nicht verfügbar“.
  const devices = new DeviceService({
    dataDir,
    ...(config.devices.sdkRoot ? { sdkRoot: config.devices.sdkRoot } : {}),
    ...(config.devices.avdHome ? { avdHome: config.devices.avdHome } : {}),
    avdAllowlist: config.devices.avdAllowlist,
    maxEmulators: config.devices.maxEmulators,
    isActive: (id) => {
      const rec = sessions.get(id);
      return Boolean(rec) && !rec!.archived && !["stopped", "error"].includes(rec!.status);
    },
  });

  const team = createHubTeam({ sessions, dataDir });
  await team.ready;
  const automations = createHubAutomationService({
    team,
    actions: config.actions,
    dataDir,
    hostId: config.hostId ?? toHostId(hostname()),
    sessions,
    projectRoots: config.projectRoots.map((root) => resolve(root)),
    log: (line) => logger.info(`automations: ${line}`),
  });

  // EPIC-P73 (ADR-0094): Issue-Session-Bridge — outbound, Label als Freigabe-
  // Gate. Ohne `issues`-Sektion bleibt alles beim alten Zustand; ein Projekt
  // außerhalb der projectRoots lässt die Bridge nicht starten (fail loud).
  // GitHub-Token: issues.tokenFile, sonst die Forge-Verknüpfung forge.github.
  let issueBridge: IssueSessionBridge | undefined;
  let issueClient: GitHubClient | undefined;
  const ghTokenFile = resolveGitHubTokenFile(config.issues, config.forge);
  if (config.issues) {
    const allowed = await isProjectPathAllowed(config.issues.project, config.projectRoots.map((root) => resolve(root)));
    if (!allowed) {
      logger.warn(`issues: Projekt ${config.issues.project} liegt außerhalb der projectRoots — Issue-Session-Bridge startet nicht`);
    } else if (!ghTokenFile) {
      logger.warn("issues: kein GitHub-Token (issues.tokenFile oder forge.github.tokenFile fehlt) — Issue-Session-Bridge startet nicht");
    } else {
      issueClient = new GitHubClient(config.issues.repo, ghTokenFile);
      issueBridge = new IssueSessionBridge(
        {
          repo: config.issues.repo,
          ...(config.issues.tokenFile ? { tokenFile: config.issues.tokenFile } : {}),
          triggerLabel: config.issues.triggerLabel,
          adapter: config.issues.adapter,
          project: config.issues.project,
          pollIntervalMs: config.issues.pollIntervalMs,
          ...(config.issues.model ? { model: config.issues.model } : {}),
        },
        {
          client: issueClient,
          journal: new IssueBridgeJournal(resolve(dataDir, "issues")),
          sessions,
          log: (line) => logger.info(`issue-bridge: ${line}`),
        },
      );
    }
  }
  const externalJobs = new ExternalJobsService({
    ...(issueClient ? { actions: issueClient } : {}),
    ...(issueBridge ? { bridge: issueBridge } : {}),
  });

  // EPIC-P59 (ADR-0078): Metrik-Sampler — nur konfigurierte Quellen plus die
  // dem Hub bekannten Modell-Server; Secrets nur als Dateireferenz (ADR-0011).
  const keyFile = (file: string | undefined) => (file ? resolve(file.replace(/^~(?=\/)/, homedir())) : undefined);
  let aimetrics: ReturnType<typeof createAiMetricsSampler> | undefined;
  let inference: InferenceTracker | undefined;
  if (config.aiMetrics) {
    const servers: AiMetricsSamplerServer[] = config.aiMetrics.servers.map((s) => ({
      url: s.url,
      ...(s.label ? { label: s.label } : {}),
      ...(s.apiKeyFile ? { apiKeyFile: keyFile(s.apiKeyFile)! } : {}),
      ...(s.halogenLog ? { halogenLog: keyFile(s.halogenLog)! } : {}),
    }));
    if (config.aiMetrics.probeKnown) {
      const seen = new Set(servers.map((s) => s.url));
      const isLocalProbe = (url: string): boolean => {
        try {
          const host = new URL(url).hostname;
          return (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host.endsWith(".ts.net") ||
            host.startsWith("100.") ||
            host.startsWith("10.") ||
            host.startsWith("192.168.")
          );
        } catch {
          return false;
        }
      };
      for (const m of [config.assistant.model, config.media.vision, config.gatekeeper.model]) {
        if (!m || seen.has(m.url) || !isLocalProbe(m.url)) continue;
        seen.add(m.url);
        servers.push({ url: m.url, ...(m.apiKeyFile ? { apiKeyFile: keyFile(m.apiKeyFile)! } : {}) });
      }
    }
    aimetrics = createAiMetricsSampler({
      intervalSec: config.aiMetrics.intervalSec,
      windowSec: config.aiMetrics.windowSec,
      retentionSamples: config.aiMetrics.retentionSamples,
      hostProbe: config.aiMetrics.hostProbe,
      servers,
      selfLabel: config.hostLabel ?? hostname(),
      deps: {
        fetch: (url, init) => fetch(url, init),
        readFile: async (path) => readFile(path, "utf8").catch(() => null),
        readdir: async (dir) => readdir(dir).catch(() => []),
        os: { loadavg, cpus: () => cpus(), totalmem, freemem },
        now: () => new Date(),
        logger,
      },
    });
  }

  const app = await createHubApp({
    sessions,
    browser,
    devices,
    tokens,
    registry,
    // EPIC-P36 / ADR-0055: Review-Notizen — Journal+Snapshot unter dataDir/reviews.
    reviews: new ReviewStore(resolve(dataDir, "reviews")),
    // EPIC-P46 / ADR-0058 §9: Freigaben für Diagnose-Prüfer, die Projektcode starten.
    trust: new ProjectTrustStore(db),
    // EPIC-P37 / ADR-0056: Forge (GitLab) — Kommando aus der Config (E2E: Stub);
    // tokenFile-Fehler failen laut beim Boot, nie still.
    forge: new ForgeService({
      dataRoot: dataDir,
      command: config.forge.gitlab.command,
      ...(config.forge.gitlab.host ? { host: config.forge.gitlab.host } : {}),
      ...(config.forge.gitlab.tokenFile ? { tokenFile: config.forge.gitlab.tokenFile } : {}),
    }),
    auth: {
      tokens,
      enforceTailnetIdentity: config.server.enforceTailnetIdentity,
    },
    ...(config.server.pwaDir ? { pwaDir: resolve(config.server.pwaDir) } : {}),
    projectRoots: config.projectRoots.map((root) => resolve(root)),
    actions: config.actions,
    loops,
    ...(assistantModel ? { assistantModel } : {}),
    ...(sttConfig ? { stt: sttConfig } : {}),
    // EPIC-P11 (ADR-0031): the desktop companion's queue — always there; a
    // PC appears once a companion with a `companion:` token reports in.
    desktop: new DesktopService(db),
    ...(media ? { media: { media, ytDlp: mc.ytDlp, capabilities: { stt: Boolean(config.stt), summary: Boolean(assistantModel), vision: Boolean(mc.vision) } } } : {}),
    approvals,
    attachments,
    settings,
    mainSync: mainSyncService,
    push,
    dataDir,
    workerRunnerKind: runner.kind,
    store,
    metrics,
    startedAt,
    // T2.5: always real and reachable, same reasoning as `approvals`
    // above — see HubConfig.webauthn's doc comment for why the shipped
    // rpId/origin defaults only work for local dev.
    webauthn: { store: new WebAuthnStore(db), config: config.webauthn },
    discoverySources: discoverySources(config, claudeLive),
    claudeLive,
    hostId: config.hostId ?? toHostId(hostname()),
    hostLabel: config.hostLabel ?? hostname(),
    automations,
    externalJobs,
    forgeTokens: {
      ...(ghTokenFile ? { githubTokenFile: ghTokenFile } : {}),
    },
    team,
    ...(aimetrics ? { aimetrics, aimetricsMergePeers: config.aiMetrics?.mergePeers !== false } : {}),
    ...(inference ? { inference } : {}),
    // EPIC-P56 T56.3: Statistik-Rollup — hält die Fakten-Caches frisch und
    // liest sie für die Statistik-Seite (Journal bleibt Wahrheit, K7).
    statistics: new StatisticsService(db, sessions, team),
    terminals: config.terminals.map((t) => ({
      id: t.id,
      label: t.label,
      ...(t.ssh ? { ssh: t.ssh } : {}),
      ...(t.local ? { local: true as const } : {}),
    })),
  });

  const listen = config.server.host === "127.0.0.1" && process.env.ANCIENTVOID_EXPOSE === "1"
    ? "0.0.0.0"
    : config.server.host;
  await app.listen({ port: config.server.port, host: listen });
  automations.start();
  issueBridge?.start();
  if (config.inference && config.inference.engines.length > 0) {
    const engines: InferenceEngineConfig[] = config.inference.engines.map((e) => ({
      ...(e.id ? { id: e.id } : {}),
      kind: e.kind,
      url: e.url,
      ...(e.label ? { label: e.label } : {}),
      ...(e.apiKeyFile ? { apiKeyFile: resolve(e.apiKeyFile.replace(/^~(?=\/)/, homedir())) } : {}),
    }));
    inference = createInferenceTracker(
      {
        fetch: (url, init) => fetch(url, init),
        readFile: async (path) => readFile(path, "utf8").catch(() => null),
        appendFile: async (path, data) => {
          await appendFile(path, data, "utf8");
        },
        now: () => new Date(),
        logger: {
          info: (m) => logger.info(`inference: ${m}`),
          warn: (m) => logger.warn(`inference: ${m}`),
          error: (m) => logger.error(`inference: ${m}`),
        },
      },
      engines,
      {
        intervalSec: config.inference.intervalSec,
        windowHours: config.inference.windowHours,
        minReadPrefill: config.inference.minReadPrefill,
        storeFile: resolve(dataDir, "inference-requests.jsonl"),
      },
    );
    inference.start();
    logger.info(`inference: ${engines.length} Engine-Quellen (${engines.map((e) => e.kind).join(", ")})`);
  }
  aimetrics?.start();
  // EPIC-P67 T67.5/T67.6: laufende Main-Synchronisation — ein Fetch je Projekt
  // je Takt (K8). Meldungen werden persistente Benachrichtigungen (mit
  // Aktionsknopf im ask-Modus) und gehen über onNotification an Web-Push.
  const mainSyncScheduler = new MainSyncScheduler({
    settingsFor: (projectPath) => mainSyncService.effective(projectPath),
    candidates: () => sessions.mainSyncCandidates(),
    apply: (sessionId) => sessions.mainSyncApply(sessionId, { skipFetch: true }),
    notice: (n) => {
      if (n.kind === "behind") {
        void (
          sessions.pushNotification(
            n.sessionId,
            {
              level: "warning",
              title: `${projectName(n.projectPath)} · ${n.behind} ${n.behind === 1 ? "Commit" : "Commits"} hinter main`,
              // BUG-0224: je Projekt und Stand eine Meldung — wie viele Sessions
              // hinterherlaufen, steht im Detail (vorher: eine Row je Session).
              detail:
                n.sessions > 1
                  ? `origin/${n.branch} ist vorgerückt — ${n.sessions} Sessions laufen hinterher.`
                  : `origin/${n.branch} ist vorgerückt — aktualisieren, wenn die Session wartet.`,
              // ask-Modus = Rückfrage: eigener Kind, damit Glow/Sound die Aktions-Taxonomie trifft (P64/P65)
              kind: n.mode === "ask" ? "mainsync.behind_ask" : "mainsync.behind",
            },
            n.mode === "ask" ? { label: "Jetzt aktualisieren", method: "POST", path: sessionMainSyncPath(n.sessionId) } : null,
          ) ?? Promise.resolve(null)
        );
        return;
      }
      if (n.kind === "conflict") {
        void sessions.pushNotification(n.sessionId, {
          level: "warning",
          title: `${projectName(n.projectPath)} · Main-Sync-Konflikt`,
          detail: `Konflikt in ${n.files.join(", ") || "?"} — in der Session lösen, der Hub mischt nichts halb ein.`,
          kind: "mainsync.conflict",
        });
        return;
      }
      if (n.kind === "applied") {
        void sessions.pushNotification(n.sessionId, {
          level: "success",
          title: `${projectName(n.projectPath)} · main eingemischt`,
          detail: `origin/main ist jetzt Teil der Session (${n.result.to}).`,
          kind: "mainsync.applied",
        });
        return;
      }
      void sessions.pushNotification(n.sessionId, {
        level: "error",
        title: `${projectName(n.projectPath)} · Main-Sync gescheitert`,
        detail: n.detail ?? n.reason,
        kind: "mainsync.failed",
      });
    },
  });
  mainSyncScheduler.start();
  void mainSyncScheduler.tick(); // Nachholen beim Start (§3.4) — kein persistenter Timer-Zustand (K7)
  logger.info("listening", { host: config.server.host, port: config.server.port, dataDir });
  const resumed = media?.resume() ?? 0;
  if (resumed) logger.info("media jobs resumed", { count: resumed });
  if (config.server.host === "127.0.0.1" && !process.env.ANCIENTVOID_EXPOSE) {
    logger.info("bound to loopback — expose via tailscale serve, never via public bind");
  }

  const shutdown = async (sig: string) => {
    automations.stop();
    issueBridge?.stop();
    aimetrics?.stop();
  inference?.stop();
    mainSyncScheduler.stop();
    logger.info("shutting down", { signal: sig });
    // tmux workers outlive the hub: a planned restart keeps them running and
    // the next start takes them over instead of stopping every session.
    const keepWorkers = runner.kind === "tmux";
    logger.info("stopping hub", { keepWorkers });
    await browser.closeAll().catch(() => undefined);
    await sessions.shutdown({ keepWorkers }).catch(() => undefined);
    await app.close().catch(() => undefined);
    db.close();
    await releaseHubPidLock?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (err) => {
  await releaseHubPidLock?.();
  createJsonLogger({ fields: { service: "ancientvoid-hub" } }).error("fatal", {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

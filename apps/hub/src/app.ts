import type { HubTeam } from "./modules/team/index.ts";
import type { ActionDefinition } from "@ancientvoid/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ClaudeLive, DesktopService, AttachmentStore, PlannerModelConfig, PushService, SettingsStore, SessionManager, SessionTextIndex, TokenService, AdapterRegistry, LoopRegistry, ApprovalService, WebAuthnStore, HealthStore, ProbeRunner, ReviewStore, ProjectTrustStore, BrowserService, DeviceService, AutomationService, KnowledgeService, MainSyncSettingsService } from "@ancientvoid/core";
import type { ForgeService } from "./modules/forge/forge-service.ts";
import type { StatisticsService } from "./modules/statistics/statistics.service.ts";
import type { ExternalJobsService } from "./modules/automations/external-jobs.ts";
import { discoverProjects, FleetStore } from "@ancientvoid/core";
import type { HubMetrics, DiscoverySource } from "@ancientvoid/contracts";
import { REDACT_LOG_KEYS, DEFAULT_HOST_ID } from "@ancientvoid/contracts";
import type { WebAuthnConfig } from "./modules/identity/webauthn.ts";
import { authHook, type AuthOptions } from "./platform/auth.ts";
import { registerRoutes } from "./routes.ts";
import { registerAttachmentRoutes } from "./modules/attachments/attachments.routes.ts";
import { registerPushRoutes } from "./modules/push/push.routes.ts";
import { registerSttRoutes, type SttConfig } from "./modules/voice/stt.routes.ts";
import { registerTtsRoutes } from "./modules/voice/tts.routes.ts";
import { registerTerminalRoutes, type TerminalConfigEntry } from "./modules/terminal/terminal.routes.ts";
import { registerMediaRoutes, type MediaRouteDeps } from "./modules/media/media.routes.ts";
import { registerDesktopRoutes } from "./modules/desktop/desktop.routes.ts";
import { policyHook } from "./platform/policy.ts";
import { registerWs } from "./modules/sessions/ws.ts";
import { registerFleetRoutes } from "./modules/fleet/fleet.routes.ts";
import { registerFleetProxy } from "./modules/fleet/fleet-proxy.ts";

export interface HubAppDeps {
  /** T7.10: attachments and hub settings (Gemini key). */
  attachments?: AttachmentStore;
  settings?: SettingsStore;
  /** EPIC-P67 T67.3: Main-Sync-Einstellungen (config-Tabelle) — ohne Angabe 501 auf der Settings-Route. */
  mainSync?: MainSyncSettingsService;
  /** EPIC-P41 (ADR-0064): Automationen — ohne Angabe ehrliche Abschaltung (501). */
  automations?: AutomationService;
  /** EPIC-P73 (ADR-0094): Forge-Token-Dateien aus der Config — die PWA darf
   * Tokens eintragen (Datei schreiben), sie aber nie zurücklesen. */
  forgeTokens?: { githubTokenFile?: string };
  /** EPIC-P74 (ADR-0096): Wissensquellen (Tests injizieren hier ein fetch). */
  knowledge?: KnowledgeService;
  /** EPIC-P73 (ADR-0094): externe Auto-Jobs (GitHub-Actions, Issue-Bridge). */
  externalJobs?: ExternalJobsService;
  team?: HubTeam;
  sessions: SessionManager;
  tokens: TokenService;
  registry: AdapterRegistry;
  auth: AuthOptions;
  pwaDir?: string;
  /** T1.5-4: host paths to scan for git repos, offered as session projects. */
  projectRoots?: string[];
  /** T8.3: Web Push (optional — off unless a person enables it). */
  push?: PushService;
  /** T10.2: local speech-to-text (ADR-0028). */
  stt?: SttConfig;
  /** EPIC-P75: fetch für die TTS-Routen — Tests injizieren hier einen Attrappen-Dienst. */
  ttsFetch?: typeof fetch;
  /** ADR-0087: Allowlist für den PWA-Terminal-Tab. */
  terminals?: readonly TerminalConfigEntry[];
  /** EPIC-P11: desktop companion (ADR-0031). */
  desktop?: DesktopService;
  /** EPIC-P10.5: video analysis (ADR-0030). */
  media?: Omit<MediaRouteDeps, "settings">;
  /** T9.2: local model for text commands (ADR-0027). */
  assistantModel?: PlannerModelConfig;
  /** T7.6: registered actions from the config. */
  actions?: ActionDefinition[];
  /** EPIC-P19: Loops / Dark Factories (optional: ohne Angabe nur der gesperrte Katalog). */
  loops?: LoopRegistry;
  /** EPIC-P36: Review-Notizen (Journal+Snapshot, ADR-0055). Ohne Angabe
   * bleiben die Review-Routen aus (501-Muster wie Approvals/WebAuthn). */
  reviews?: ReviewStore;
  /** EPIC-P46 (ADR-0058 §9): Projekt-Freigaben für Diagnose-Prüfer. */
  trust?: ProjectTrustStore;
  /** EPIC-P39 (ADR-0059): Browser-Arbeitsplatz. */
  browser?: BrowserService;
  /** EPIC-P42 (ADR-0067): Android-Testgeräte — ohne Angabe ehrliche Abschaltung (501). */
  devices?: DeviceService;
  /** EPIC-P37 (ADR-0056): Forge-Dienst — ohne Angabe ehrliche Abschaltung. */
  forge?: ForgeService;
  /** T2.4: optional, mirrors SessionManager's own optional approvals —
   * omitting it disables the /api/approvals routes (501), not a crash. */
  approvals?: ApprovalService;
  /** T2.5: optional — omitting it disables the /api/webauthn/* and
   * /api/approvals/:id/webauthn/* routes (501, not a crash). */
  webauthn?: { store: WebAuthnStore; config: WebAuthnConfig };
  /** T3.9: local-only storage root for the prompt-optimizer learning-loop
   * feedback file. Omitting it disables POST /api/prompt-optimizer/
   * feedback (501) — same optional pattern as approvals/webauthn above. */
  dataDir?: string;
  /** Real user request (2026-09-19): "same session on the phone and my
   * desktop terminal" — already true today for every tmux-backed worker
   * (ADR-P0-3: workers run in tmux specifically so they're attachable),
   * just never surfaced. `WorkerRunner.kind` ("tmux" | "process") decides
   * whether `GET /api/sessions[/:id]` includes a real `attachCmd` —
   * omitting it (or a non-tmux runner) simply omits the field, never a
   * fabricated command for a runner that has no attachable pane. */
  workerRunnerKind?: string;
  /** ADR-0010: EventStore probe for /api/health and /api/ready. */
  store?: HealthStore;
  metrics?: HubMetrics;
  startedAt?: number;
  discoverySources?: DiscoverySource[];
  /** EPIC-P15 T15.4: which Claude sessions are open at the PC. */
  claudeLive?: ClaudeLive;
  probeRunner?: ProbeRunner;
  /** EPIC-P6: this hub's host id in the fleet (default "local"). */
  hostId?: string;
  /** 2026-10-26: readable host name for fleet views (defaults to hostname). */
  hostLabel?: string;
  /** EPIC-P6: invites and paired peers (default: in the token database). */
  fleet?: FleetStore;
  /** EPIC-P56 T56.3: Statistik-Rollup der Statistik-Seite (ohne Angabe 501). */
  statistics?: StatisticsService;
  /** Suche (Nachschärfe 2026-11-22): Volltextindex über die Sessiontexte.
   * Ohne Angabe antwortet die Session-Suche 501 statt so zu tun, als gäbe es
   * nichts zu finden. */
  search?: { transcript: SessionTextIndex };
  /** Tests only: where the request log goes (default stdout). */
  logStream?: { write(message: string): void };
}

/** Masks credentials carried in a URL's query string. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|access_token|ticket)=)[^&#]*/gi, "$1[redacted]");
}

export async function createHubApp(deps: HubAppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.ANCIENTVOID_LOG ?? "info",
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      // BUG-0028: WebSocket clients authenticate with ?token= — the default
      // request serializer logged it verbatim.
      serializers: {
        req: (req: FastifyRequest) => ({
          method: req.method,
          url: redactUrl(req.url ?? ""),
          host: req.hostname,
          remoteAddress: req.ip,
        }),
      },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          ...REDACT_LOG_KEYS.map((key) => `*.${key}`),
        ],
      },
    },
  });
  await app.register(fastifyWebsocket);

  // BUG-0115-Klasse: ein JSON-Content-Type ohne Body (DELETE/POST ohne Nutzlast) ist kein 400,
  // sondern „kein Body“ — sonst scheitern Aktionen still im Client.
  const defaultJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = body.toString();
    if (text === "") return done(null, undefined);
    defaultJson(req, text, done);
  });

  app.addHook("onRequest", authHook(deps.auth));
  // T7.4: after body parsing — a steer's kind decides park vs. prompt.
  app.addHook("preHandler", policyHook(deps.tokens));

  const projectRoots = deps.projectRoots ?? [];
  if (projectRoots.length > 0) {
    // BUG-0009's lesson applied here too: a misconfigured root must not
    // silently degrade to an empty project list — warn at startup, once,
    // with the exact path that failed.
    const { warnings } = await discoverProjects(projectRoots);
    for (const w of warnings) app.log.warn(w);
  }
  const fleet = deps.fleet ?? new FleetStore(deps.tokens.database, deps.tokens);
  const hostId = deps.hostId ?? DEFAULT_HOST_ID;
  registerRoutes(app, { ...deps, projectRoots, fleet });
  if (deps.attachments && deps.settings) registerAttachmentRoutes(app, { attachments: deps.attachments, settings: deps.settings });
  if (deps.push) registerPushRoutes(app, { push: deps.push, tokens: deps.tokens });
  if (deps.desktop) registerDesktopRoutes(app, { desktop: deps.desktop, tokens: deps.tokens });
  if (deps.media) registerMediaRoutes(app, { ...deps.media, settings: deps.settings });
  registerSttRoutes(app, deps.stt, async () => (await discoverProjects(projectRoots)).projects.map((p) => p.path));
  if (deps.settings) registerTtsRoutes(app, { settings: deps.settings, ...(deps.ttsFetch ? { fetch: deps.ttsFetch } : {}) });
  registerTerminalRoutes(app, deps.terminals ?? []);
  registerFleetRoutes(app, { fleet, tokens: deps.tokens, hostId, ...(deps.hostLabel ? { hostLabel: deps.hostLabel } : {}) });
  registerFleetProxy(app, { fleet, hostId, sessions: deps.sessions, tokens: deps.tokens, ...(deps.metrics ? { metrics: deps.metrics } : {}) });
  registerWs(app, deps.sessions, deps.metrics, deps.tokens);

  if (deps.pwaDir) {
    const resolvedPwaDir = resolve(deps.pwaDir);
    if (existsSync(resolvedPwaDir)) {
      await app.register(fastifyStatic, {
        root: resolvedPwaDir,
        prefix: "/",
        decorateReply: true,
      });
      app.setNotFoundHandler(async (req, reply) => {
        if (req.url.startsWith("/api/")) {
          return reply.code(404).send({ error: "not found" });
        }
        return reply.sendFile("index.html");
      });
    } else {
      // BUG-0009: this used to fail silently — configured but resolved to
      // a directory that doesn't exist (e.g. a relative pwaDir combined
      // with a different CWD than whoever wrote the config assumed), and
      // every non-/api/ request just got a bare 404 with no clue why.
      app.log.warn(
        `pwaDir "${deps.pwaDir}" resolved to "${resolvedPwaDir}", which does not exist — ` +
          "the PWA will not be served (only /api/* routes are registered). " +
          "Check hub.config.json's pwaDir is relative to the directory main.ts is run from.",
      );
    }
  }

  return app;
}

export { WS_PROTOCOL_VERSION } from "@ancientvoid/contracts";

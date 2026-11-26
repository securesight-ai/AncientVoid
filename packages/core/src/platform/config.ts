import { ActionDefinition, InferenceGateConfig } from "@ancientvoid/contracts";
import { z } from "zod";
import type { AdapterFactory, ReportingSink } from "@ancientvoid/contracts";

export const AdapterRegistration = z.object({
  /** Adapter id as referenced by SessionSpec.adapter. */
  id: z.string().min(1),
  /**
   * Module specifier resolving to an adapter factory:
   *  - package name: "@ancientvoid/adapter-claude" or any npm package
   *  - relative path: "./adapters/my-provider/index.ts" (relative to config file)
   *  - absolute path: "/opt/ancientvoid/adapters/custom.mjs"
   */
  module: z.string().min(1),
  /** Adapter-specific config passed to the factory. */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Disable without removing the registration. */
  enabled: z.boolean().default(true),
});
export type AdapterRegistration = z.infer<typeof AdapterRegistration>;

/** EPIC-P19: ein Loop (Dark Factory); das Modul exportiert `createLoopConnector(config?)`. */
export const LoopRegistration = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  module: z.string().min(1),
  /** Connector-eigene Konfiguration; Schlüssel nur als Datei (`passwordFile`), nie als Wert. */
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
});
export type LoopRegistration = z.infer<typeof LoopRegistration>;

/** T4.1/ADR-0009: same module-specifier shape as AdapterRegistration
 * (package name / relative / absolute path), resolved through the same
 * resolveAdapterModule() — but the module exports `createSink(config?) =>
 * ReportingSink` instead of `createAdapter`. No `id`: sinks are never
 * looked up by name at runtime, only iterated. */
export const ReportingSinkRegistration = z.object({
  module: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
});
export type ReportingSinkRegistration = z.infer<typeof ReportingSinkRegistration>;

export const HubConfig = z.object({
  dataDir: z.string().default("./data"),
  /** EPIC-P6: this hub's name in the fleet. Default: the machine's
   * hostname as a slug (see toHostId). */
  hostId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
  /** 2026-10-26: readable host name reported in fleet hello/views —
   * defaults to the machine's hostname(). */
  hostLabel: z.string().min(1).max(63).optional(),
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().default(7373),
      /**
       * Reject requests without Tailscale identity headers when served via
       * `tailscale serve`. Requires requests to come through the tailnet.
       */
      enforceTailnetIdentity: z.boolean().default(false),
      /** Directory containing the built PWA (served as static root). */
      pwaDir: z.string().optional(),
    })
    .prefault({}),
  adapters: z.array(AdapterRegistration).default([]),
  /** EPIC-P19: Loops / Dark Factories (Connector-Module). */
  loops: z.array(LoopRegistration).default([]),
  /** Worker runner kind: "tmux" (default) | "process". */
  workerRunner: z.enum(["tmux", "process"]).default("tmux"),
  /** T1.5-4: host paths to scan (depth 1) for git repos to offer as
   * session projects — see @ancientvoid/core's discoverProjects(). Empty means
   * unconfigured: the PWA falls back to a free-text path (BUG-0006
   * lesson — don't make a fresh hub unusable), and POST /api/sessions
   * accepts any project path (pre-T1.5-4 behavior, unchanged). */
  projectRoots: z.array(z.string()).default([]),
  /** T2.4 (EPIC-P2 §3): gate every steer(prompt) behind the write-class
   * approval queue instead of forwarding it immediately. Defaults to
   * `false` — the service and its REST routes/PWA page are always real
   * and reachable regardless, but flipping the hub's core chat
   * interaction into a two-step approve-then-send flow is a deliberate
   * operator choice, not a silent default change to how every existing
   * session already behaves. */
  requireStepApprovals: z.boolean().default(false),
  /** ADR-0033: the permission mode new sessions start in, for every adapter
   * that offers it (claude: "auto"). "manual" restores asking on the phone. */
  defaultPermissionMode: z.string().min(1).default("auto"),
  /** T7.2: how long a provider's tool request or question waits for the
   * phone before it is denied (never run on timeout). */
  toolApprovalTimeoutMs: z.number().int().min(10_000).default(10 * 60_000),
  /** "auto": every tool request of a provider is allowed at once (and shown in the history as
   * "Automatisch erlaubt"); "ask" (default) sends each one to the phone. Questions to the person
   * are always asked. Only for a hub you trust the agents on. */
  toolApprovals: z.enum(["ask", "auto"]).default("ask"),
  /** EPIC-P17 T17.4: how long the hub waits for an adapter to take a
   * steer before answering "outcome unknown" (event session.steer_timeout).
   * A timeout never triggers a second submission of the same input id. */
  /** ADR-0074: default on; also requires the adapter resume.auto declaration. */
  autoResumeInterrupted: z.boolean().default(true),
  steerWaitMs: z.number().int().min(100).max(600_000).default(30_000),
  /** EPIC-P39 (ADR-0059): zusätzliche Test-Origins für den Browser-Arbeitsplatz (z. B. "http://127.0.0.1:5173");
   * Standardziele sind nur die registrierten Workspace-Services der Session. */
  browserOrigins: z.array(z.string().url()).max(20).default([]),
  /** EPIC-P39: false = sichtbares Chromium-Fenster auf dem Host (braucht eine Anzeige); die PWA zeigt weiter das Bild. */
  browserHeadless: z.boolean().default(true),
  /** EPIC-P42 (ADR-0067): Android-Testgeräte. sdkRoot/avdHome zeigen auf die SDK-/AVD-Installation
   * (z. B. /mnt/data/toolchain/android-sdk); ohne sdkRoot (auch keine env ANDROID_SDK_ROOT)
   * meldet der Dienst ehrlich „nicht verfügbar“. Leere Allowlist = alle AVDs des AVD-Home wählbar. */
  devices: z
    .object({
      sdkRoot: z.string().optional(),
      avdHome: z.string().optional(),
      avdAllowlist: z.array(z.string().min(1).max(64)).max(10).default([]),
      maxEmulators: z.number().int().min(1).max(2).default(1),
      /** KVM-Gerät der Bereitschaftsprüfung (Standard /dev/kvm) — Override für Umgebungen
       * ohne KVM (Container/CI): z. B. auf ein Dummy-Gerät zeigen, wenn nur Fake-Emulatoren laufen. */
      kvmPath: z.string().optional(),
      /** In-App-Setup (2026-11-24): Download-Quellen und Paketliste — Overrides für
       * Spiegel/Offline-Installationen; ohne Angabe gelten die angepinnten Defaults. */
      setup: z
        .object({
          jdkUrl: z.string().url().optional(),
          toolsUrl: z.string().url().optional(),
          packages: z.array(z.string().min(1).max(120)).max(8).optional(),
        })
        .default({}),
    })
    .default({ avdAllowlist: [], maxEmulators: 1, setup: {} }),
  /** T7.10: local OCR — a tessdata dir with extra languages (e.g. deu),
   * set up by scripts/setup-ocr.sh without root. */
  ocr: z.object({ tessdataDir: z.string().optional() }).default({}),
  /** T7.6: registered actions (tests, tools) offered in every session,
   * next to the built-in git reads and the project's own test command. */
  actions: z.array(ActionDefinition).default([]),
  /** EPIC-P37 (ADR-0056): GitLab im Session-Kontext. Default: lokales glab
   * des Betriebsnutzers; E2E setzt `command` auf einen Stub. */
  forge: z
   .object({
     gitlab: z
       .object({
         command: z.string().min(1).default("glab"),
         /** Default-Host, wenn ein Remote nicht eindeutig ist (selten). */
         host: z.string().min(3).max(253).optional(),
         /** Token als Dateireferenz (erste Zeile) — nie in der Config selbst. */
         tokenFile: z.string().min(1).optional(),
       })
       .default({ command: "glab" }),
      /** EPIC-P73 (ADR-0094): GitHub als zweiter Forge neben GitLab — beide
       * parallel möglich. Der Token speist die Issue-Session-Bridge und die
       * GitHub-Actions-Anzeige; ein volles ForgePanel für GitHub-Remotes ist
       * bewusst nicht Teil davon (Out, siehe ADR-0094 Abgewogen). */
      github: z
        .object({
          /** GitHub-Token (Issues lesen/schreiben, Actions lesen) als
           * Dateireferenz (erste Zeile) — nie in der Config selbst. */
          tokenFile: z.string().min(1).optional(),
        })
        .default({}),
   })
   .default({ gitlab: { command: "glab" }, github: {} }),
  /** EPIC-P73 (ADR-0094): Issue-Session-Bridge — der Hub pollt outbound nach
   * gelabelten Issues und startet dafür je eine Session. Ohne Sektion bleibt
   * alles beim alten Zustand; das Label ist das Freigabe-Gate (PRD §8.5). */
  issues: z.object({
    repo: z.string().regex(/^[^\s/]+\/[^\s/]+$/, "repo muss owner/name sein"),
    /** GitHub-Token als Dateireferenz (erste Zeile) — nie in der Config
     * selbst. Optional: fehlt die Angabe, greift forge.github.tokenFile
     * (parallele Forge-Verknüpfung, ADR-0094). */
    tokenFile: z.string().min(1).optional(),
    triggerLabel: z.string().min(1).max(64).default("session"),
    adapter: z.string().min(1),
    project: z.string().min(1),
    model: z.string().optional(),
    pollIntervalMs: z.number().int().min(10_000).max(3_600_000).default(60_000),
  }).optional(),
  /** T9.2 (ADR-0027): local model for text commands and text edits;
   * absent → the gatekeeper's model, if any. Never a cloud fallback. */
  assistant: z
    .object({ model: z.object({ url: z.string().url(), model: z.string().min(1).default("qwen3-coder"), apiKeyFile: z.string().optional() }).optional() })
    .default({}),
  /** T10.2 (ADR-0028): local speech-to-text (whisper.cpp server on own
   * hardware). Absent → the PWA falls back to the browser's recognizer and
   * says that it is a cloud service. */
  stt: z
    .object({
      url: z.string().url(),
      engine: z.string().default("whisper.cpp large-v3-turbo"),
      language: z.string().default("de"),
      vocabulary: z
        .string()
        .max(1000)
        .default(
          "AncientVoid, Session, Codex, Claude, opencode, TypeScript, JavaScript, Vitest, pytest, npm, pnpm, Pull Request, Branch, main, Rebase, Merge, Commit, Push, Worktree, Git Status, Diff, Build, Deploy, Logs, Cache, Cloud, Adapter, Hub, Tailnet, PWA, API, WebSocket, Service Worker, Docker, Container, llama.cpp, Gatekeeper, Readme, Doku, Kontingent, Unit-Test, Bug, Refactoring.",
        ),
      timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
      /** T12.10 (ADR-0032): optional local PCM16 streaming endpoint. */
      streaming: z.object({
        url: z.string().url(),
        apiKeyFile: z.string().optional(),
        endpointingMs: z.number().int().min(100).max(5_000).default(800),
        /** Name der Streaming-Erkennung, damit das Endtranskript den richtigen
         *  Erkennungsnamen traegt (Default bleibt die bisherige Bezeichnung). */
        engine: z.string().max(120).optional(),
      }).optional(),
    })
    .optional(),
  /** EPIC-P10.5 (ADR-0030): video analysis. Speech uses `stt`, chapters and
   * summary the assistant model; `vision` is an optional local image model
   * (llama.cpp with mmproj, OpenAI API). Gemini only per job, when allowed. */
  media: z
    .object({
      enabled: z.boolean().default(true),
      ytDlp: z.string().default("yt-dlp"),
      /** Keep the downloaded/uploaded video after the analysis (default: delete). */
      keepSource: z.boolean().default(false),
      maxDurationSec: z.number().int().min(10).max(4 * 3600).default(30 * 60),
      maxBytes: z.number().int().min(1024 * 1024).max(4 * 1024 * 1024 * 1024).default(500 * 1024 * 1024),
      maxFrames: z.number().int().min(1).max(200).default(24),
      vision: z.object({ url: z.string().url(), model: z.string().min(1), apiKeyFile: z.string().optional() }).optional(),
    })
    .prefault({}),
  /** T8.3 (ADR-0026): VAPID contact the push services see. */
  push: z.object({ subject: z.string().regex(/^(mailto:|https:)/).default("mailto:ancientvoid@localhost") }).prefault({}),
  /** T7.9 (ADR-0024): System-1 gatekeeper for tool requests. The rules
   * always run; `model` adds a local llama.cpp judgement (OpenAI API). */
  gatekeeper: z
    .object({
      enabled: z.boolean().default(true),
      model: z
        .object({
          url: z.string().url(),
          model: z.string().min(1).default("qwen3-coder"),
          /** File with the API key (first line) — not in the config. */
          apiKeyFile: z.string().optional(),
        })
        .optional(),
      timeoutMs: z.number().int().min(500).max(60_000).default(8000),
      minConfidence: z.number().min(0).max(1).default(0.8),
    })
    .prefault({}),
  /** T2.5: WebAuthn relying-party identity for destructive approvals.
   * Defaults suit local dev only (`localhost` origin) — a real Tailscale
   * deployment MUST override `rpId`/`origin` to the actual MagicDNS
   * hostname (e.g. "my-machine.tailXXXX.ts.net"), or every real
   * registration/assertion will fail its origin check (by design: that
   * check is what WebAuthn phishing-resistance depends on). */
  webauthn: z
    .object({
      rpId: z.string().default("localhost"),
      rpName: z.string().default("AncientVoid"),
      origin: z.string().default("http://localhost:7373"),
    })
    .prefault({}),
  /** T2.7 (EPIC-P2 §3 "Tages-Cap pro Rechner"): sum of every session's
   * costUsd created since 00:00 UTC today, hub-wide, not per session —
   * protection against a runaway/looping agent regardless of any single
   * session's own budgetUsd. `null` (default) means no cap configured. */
  dailyCapUsd: z.number().positive().nullable().default(null),
  /** T4.1 (EPIC-P4 §3 "Brain-Digest") / ADR-0009: fire-and-forget digest
   * consumers, one call per completed session. Empty by default — no
   * digests, no new network egress unless explicitly configured (same
   * "default off" principle as the MCP gateway, OD-2). */
  reportingSinks: z.array(ReportingSinkRegistration).default([]),
  /**
   * T5.3 / ADR-0012: optional overrides for read-only session scans.
   * Omitted paths use ~/.claude and the Cursor user dir when those
   * directories exist. A set path that is missing stays visible as
   * unsupported-format instead of being skipped.
   */
  discovery: z
    .object({
      claudeDir: z.string().min(1).optional(),
      /** EPIC-P15 T15.4: the claude CLI whose `agents --json` says what is open at the PC. */
      claudeCommand: z.string().min(1).default("claude"),
      cursorUserDir: z.string().min(1).optional(),
      opencodeDataDir: z.string().min(1).optional(),
      /** ADR-0041: session stores of pi, oh-my-pi (omp) and maki; default = the tools' own locations. */
      piDir: z.string().min(1).optional(),
      ompDir: z.string().min(1).optional(),
      makiDir: z.string().min(1).optional(),
      /** EPIC-P34 T34.8: Codex-Rollouts (`~/.codex/sessions`) und Hermes (`~/.hermes`, darin `state.db`). */
      codexDir: z.string().min(1).optional(),
      hermesDir: z.string().min(1).optional(),
      /** EPIC-P35 T35.5: GitHub Copilot CLI (`~/.copilot`, darin `session-store.db`). */
      copilotDir: z.string().min(1).optional(),
    })
    .prefault({}),
  /** EPIC-P59 (ADR-0078): Metrik-Seite — Sampler im Hub, Poll nur konfiguierter
   * Quellen; ohne Abschnitt kein Sampler, aber ein leerer Report. */
  /**
   * EPIC-P81 (ADR-0117): Host-Monitoring. Ohne Abschnitt misst der Hub seinen
   * eigenen Host; `sshHosts` sind Hosts ohne Hub (z. B. ein NAS), deren Schlüssel
   * dort per `command=` auf das feste Lese-Kommando beschränkt ist.
   */
  hostMetrics: z
    .object({
      enabled: z.boolean().default(true),
      intervalSec: z.number().int().min(2).max(300).default(5),
      mergePeers: z.boolean().default(true),
      sshHosts: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
            label: z.string().min(1).max(60).optional(),
            /** `user@host` oder ein Alias; nie eine Option (kein führendes „-“). */
            target: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,200}$/),
            /** Pfad zum privaten Schlüssel, nie der Schlüssel selbst (ADR-0011). */
            identityFile: z.string().min(1).optional(),
            intervalSec: z.number().int().min(15).max(3600).default(60),
          }),
        )
        .max(16)
        .default([]),
    })
    .prefault({}),
  aiMetrics: z
    .object({
      intervalSec: z.number().int().min(2).max(3600).default(10),
      /** Fenster für p50/p95 (ADR-0078: eigene Samples, keine Histogramme). */
      windowSec: z.number().int().min(60).max(86_400).default(900),
      retentionSamples: z.number().int().min(60).max(50_000).default(5400),
      hostProbe: z.boolean().default(true),
      servers: z
        .array(
          z.object({
            url: z.string().url(),
            label: z.string().min(1).max(60).optional(),
            apiKeyFile: z.string().min(1).optional(),
            /** BUG-0278: Zähler-Endpunkt, wenn das Gateway hinter `url` kein `/metrics` durchreicht. */
            metricsUrl: z.string().url().optional(),
            /** Halogen-Serverlog für Prefill/Decode t/s (ADR-0078 Nachtrag). */
            halogenLog: z.string().min(1).optional(),
          }),
        )
        .max(20)
        .default([]),
      /**
       * Peer-Hub-Reports in GET /api/aimetrics mergen (Fleet, ADR-0078 Nachtrag).
       * Default an: jeder Hub misst lokal; Home-Hub zeigt auch Peer-Quellen.
       */
      mergePeers: z.boolean().default(true),
      /** Auch die dem Hub bekannten Modell-Server beproben (assistant.model, gatekeeper.models[], media.vision — ADR-0078). */
      probeKnown: z.boolean().default(true),
    })
    .optional(),
  /**
   * EPIC-P79 (ADR-0125): Token-Tempo der Inferenz-Engines fuer die Seite
   * "Inferenz". Eigene, engmaschigere Spur als `aiMetrics` (P59): Request-
   * Historie plus Verteilungen. Ohne Abschnitt: leere Quellen-Liste, die Seite
   * erklaert die Konfiguration. Schluessel nur als Dateireferenz (ADR-0011).
   */
  inference: z
    .object({
      intervalSec: z.number().int().min(1).max(300).default(2),
      /** Aufbewahrungs- und Berechnungsfenster der Request-Historie (K7: JSONL). */
      windowHours: z.number().int().min(1).max(720).default(72),
      /** Prefill-Perzentile rechnen nur ab dieser Zahl *gelesener* Token. */
      minReadPrefill: z.number().int().min(0).max(200_000).default(4_000),
      engines: z
        .array(
          z.object({
            id: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
              .optional(),
            kind: z.enum(["strata", "halogen", "llamacpp"]),
            url: z.string().url(),
            label: z.string().min(1).max(80).optional(),
            apiKeyFile: z.string().min(1).optional(),
          }),
        )
        .max(16)
        .default([]),
      /**
       * BUG-0272 (ADR-0116): Pforte pro Modell-Endpoint. Ein Einzelslot-Dienst wie
       * Strata teilt sich EINEN Kontext (hier 262 144 Token) mit allen Sitzungen;
       * ohne Pforte verdrängen sie sich gegenseitig im KV und melden
       * Kontextüberlauf. Nur gelistete Endpoints werden gedeckelt — Cloud-Provider
       * haben das Problem nicht und bleiben ungedeckelt.
       */
      gate: InferenceGateConfig.optional(),
    })
    .optional(),
  /**
   * EPIC-P80 (ADR-0118): Pentest-Scan — Anbindung ans SiLenT-Deck
   * (Übergang: HTTP-API, Ziel: MCP-Fassade). Ohne Abschnitt oder ohne
   * backendUrl: die Seite erklärt sichtbar die Konfigurationslosigkeit (K10),
   * sie wird nicht still tot. Secrets nur als Dateireferenz (ADR-0011).
   */
  pentest: z
    .object({
      enabled: z.boolean().default(true),
      /** Backend-URL (https?://host:port ohne Pfad); fehlt sie: Grund sichtbar. */
      backendUrl: z.string().url().optional(),
      /** Datei mit `user:pass` für die Basic-Auth des Decks (ADR-0011). */
      credentialsFile: z.string().min(1).optional(),
      /** Prüfzyklus — K9: Ausfall muss binnen 60 s sichtbar sein. */
      probeIntervalMs: z.number().int().min(2_000).max(60_000).default(30_000),
      /** Hub-Job-Timeout: größer als das Backend-Timeout (300 s), sonst hängt der Job sichtbar statt still (K9). */
      jobTimeoutMs: z.number().int().min(1_000).max(600_000).default(310_000),
      /** Aufbewahrungsfenster der Scan-Historie (K7: JSONL+Snapshot). */
      windowHours: z.number().int().min(1).max(8_760).default(720),
      /** Ziel-Allowliste (D5): die Sicherheitsgrenze, nicht die UI. */
      targets: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            target: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,254}$/),
            kind: z.enum(["frei", "inventar"]).default("frei"),
          }),
        )
        .max(100)
        .default([]),
      /** Deklarierte Tools (D4); riskante laufen nur über die Freigabe. */
      tools: z
        .array(
          z.object({
            tool: z.enum(["nmap", "hydra", "sqlmap", "nuclei"]),
            risky: z.boolean().default(false),
          }),
        )
        .max(20)
        .default([{ tool: "nmap", risky: false }]),
    })
    .optional(),
  /**
   * ADR-0087: Allowlist für den PWA-Terminal-Tab.
   * Jedes Ziel: `ssh` (OpenSSH-Host/Alias) oder `local: true` (Hub-Host).
   * Lokale Ziele starten optional eine konkrete Shell (Pfad oder Name,
   * Default bash). Ohne Abschnitt: leere Liste — plus Auto-Erkennung
   * (terminalAutodetect, ADR-0087 Nachtrag 2026-11-23).
   */
  terminals: z
    .array(
      z
        .object({
          id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
          label: z.string().min(1).max(80),
          ssh: z.string().min(1).max(200).optional(),
          local: z.boolean().optional(),
          shell: z.string().min(1).max(64).regex(/^[A-Za-z0-9/._-]+$/).optional(),
        })
        .superRefine((v, ctx) => {
          const hasSsh = Boolean(v.ssh);
          const hasLocal = v.local === true;
          if (hasSsh === hasLocal) {
            ctx.addIssue({ code: "custom", message: "terminals[]: genau eines von ssh | local=true" });
          }
          if (v.shell && !hasLocal) {
            ctx.addIssue({ code: "custom", message: "terminals[]: shell nur für local=true" });
          }
        }),
    )
    .max(20)
    .default([]),
  /**
   * EPIC-P83 (ADR-0118 §3, Feinkonzept §1.2): Team-Kopplung. Standard `null`
   * — ohne `listen` ist kein Team-Socket offen; die Instanz kann trotzdem
   * wählen. Erlaubte Adressen: Loopback, RFC 1918, 100.64.0.0/10, fc00::/7;
   * Wildcard/öffentlich = Startfehler (prüfung in main, unabhängig von
   * server.host). `pairPort` lauscht nur im offenen Kopplungsfenster (T83.3).
   */
  team: z
    .object({
      listen: z
        .object({
          address: z.string().min(1).max(253),
          port: z.number().int().min(1).max(65535),
          pairPort: z.number().int().min(1).max(65535),
        })
        .nullable()
        .default(null),
      dialTimeoutMs: z.number().int().min(1000).max(120_000).default(10_000),
      maxTeams: z.number().int().min(1).max(8).default(8),
    })
    .prefault({}),
  /** ADR-0087 Nachtrag 2026-11-23: installierte Shells des Hub-Hosts automatisch als lokale Terminal-Ziele anbieten. */
  terminalAutodetect: z.boolean().default(true),
});
export type HubConfig = z.infer<typeof HubConfig>;

export const DEFAULT_CONFIG: HubConfig = HubConfig.parse({});

export interface LoadedConfig {
  config: HubConfig;
  /** Absolute path of the config file (module resolution base). */
  path: string;
}

export async function loadConfig(
  path: string,
  overrides?: Partial<HubConfig>,
): Promise<LoadedConfig> {
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    raw = "{}";
  }
  const parsed = HubConfig.parse(JSON.parse(raw));
  const config = overrides ? HubConfig.parse({ ...parsed, ...overrides }) : parsed;
  return { config, path };
}

/**
 * Resolve a module specifier from an adapter registration into something
 * `import()` understands. Relative paths resolve against the config file.
 */
export async function resolveAdapterModule(
  specifier: string,
  configPath: string,
): Promise<string> {
  const { isAbsolute, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const base = isAbsolute(specifier) ? specifier : resolve(configPath, "..", specifier);
    return pathToFileURL(base).href;
  }
  return specifier;
}

/** Built-in adapter factories shipped with the hub (wired by the server entry). */
export type BuiltinAdapters = Map<string, AdapterFactory>;

/** T4.1: loads every enabled reporting-sink module and calls its
 * `createSink(config?)` factory. A misbehaving sink module fails loud at
 * startup (same as a misconfigured adapter) rather than silently
 * producing zero sinks — the operator explicitly opted into this via
 * config, so a typo'd module path should be visible immediately, not
 * discovered later as "digests never arrive". */
export async function loadReportingSinks(
  registrations: ReportingSinkRegistration[],
  configPath: string,
): Promise<ReportingSink[]> {
  const sinks: ReportingSink[] = [];
  for (const reg of registrations) {
    if (!reg.enabled) continue;
    const spec = await resolveAdapterModule(reg.module, configPath);
    const mod = (await import(spec)) as { createSink?: (config?: Record<string, unknown>) => ReportingSink };
    if (typeof mod.createSink !== "function") {
      throw new Error(`reporting sink module "${reg.module}" does not export createSink(config?) => ReportingSink`);
    }
    sinks.push(mod.createSink(reg.config));
  }
  return sinks;
}

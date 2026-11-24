# Referenz: Hub-Config-Felder

**Art:** referenz

> Generiert von `scripts/gen-reference.mjs` (`npm run docs:reference`) aus dem zod-Schema `HubConfig` in `packages/core/src/platform/config.ts`.
> Nicht von Hand bearbeiten — `npm run check:context` scheitert bei veraltetem Stand.

Felder von `hub.config.json`; Erklärung und Beispiele: [`configuration.md`](configuration.md). Typ und Default stammen aus dem Schema, **nicht** aus der Doku.

| Feld | Typ | Default |
|---|---|---|
| `dataDir` | string | "./data" |
| `hostId` | string | — |
| `hostLabel` | string | — |
| `server.host` | string | "127.0.0.1" |
| `server.port` | integer | 7373 |
| `server.enforceTailnetIdentity` | boolean | false |
| `server.pwaDir` | string | — |
| `adapters` | array<object> | [] |
| `loops` | array<object> | [] |
| `workerRunner` | "tmux" \\| "process" | "tmux" |
| `projectRoots` | array<string> | [] |
| `requireStepApprovals` | boolean | false |
| `defaultPermissionMode` | string | "auto" |
| `toolApprovalTimeoutMs` | integer | 600000 |
| `toolApprovals` | "ask" \\| "auto" | "ask" |
| `autoResumeInterrupted` | boolean | true |
| `steerWaitMs` | integer | 30000 |
| `browserOrigins` | array<string> | [] |
| `browserHeadless` | boolean | true |
| `devices.sdkRoot` | string | — |
| `devices.avdHome` | string | — |
| `devices.avdAllowlist` | array<string> | [] |
| `devices.maxEmulators` | integer | 1 |
| `devices.setup.jdkUrl` | string | — |
| `devices.setup.toolsUrl` | string | — |
| `devices.setup.packages` | array<string> | — |
| `ocr.tessdataDir` | string | — |
| `actions` | array<object> | [] |
| `forge.gitlab.command` | string | "glab" |
| `forge.gitlab.host` | string | — |
| `forge.gitlab.tokenFile` | string | — |
| `forge.github.tokenFile` | string | — |
| `issues.repo` | string | — |
| `issues.tokenFile` | string | — |
| `issues.triggerLabel` | string | "session" |
| `issues.adapter` | string | — |
| `issues.project` | string | — |
| `issues.model` | string | — |
| `issues.pollIntervalMs` | integer | 60000 |
| `assistant.model.url` | string | — |
| `assistant.model.model` | string | "qwen3-coder" |
| `assistant.model.apiKeyFile` | string | — |
| `stt.url` | string | — |
| `stt.engine` | string | "whisper.cpp large-v3-turbo" |
| `stt.language` | string | "de" |
| `stt.vocabulary` | string | "AncientVoid, Session, Codex, Claude, opencode, TypeScrip… |
| `stt.timeoutMs` | integer | 30000 |
| `stt.streaming.url` | string | — |
| `stt.streaming.apiKeyFile` | string | — |
| `stt.streaming.endpointingMs` | integer | 800 |
| `stt.streaming.engine` | string | — |
| `media.enabled` | boolean | true |
| `media.ytDlp` | string | "yt-dlp" |
| `media.keepSource` | boolean | false |
| `media.maxDurationSec` | integer | 1800 |
| `media.maxBytes` | integer | 524288000 |
| `media.maxFrames` | integer | 24 |
| `media.vision.url` | string | — |
| `media.vision.model` | string | — |
| `media.vision.apiKeyFile` | string | — |
| `push.subject` | string | "mailto:ancientvoid@localhost" |
| `gatekeeper.enabled` | boolean | true |
| `gatekeeper.model.url` | string | — |
| `gatekeeper.model.model` | string | "qwen3-coder" |
| `gatekeeper.model.apiKeyFile` | string | — |
| `gatekeeper.timeoutMs` | integer | 8000 |
| `gatekeeper.minConfidence` | number | 0.8 |
| `webauthn.rpId` | string | "localhost" |
| `webauthn.rpName` | string | "AncientVoid" |
| `webauthn.origin` | string | "http://localhost:7373" |
| `dailyCapUsd` | number \\| null | null |
| `reportingSinks` | array<object> | [] |
| `discovery.claudeDir` | string | — |
| `discovery.claudeCommand` | string | "claude" |
| `discovery.cursorUserDir` | string | — |
| `discovery.opencodeDataDir` | string | — |
| `discovery.piDir` | string | — |
| `discovery.ompDir` | string | — |
| `discovery.makiDir` | string | — |
| `discovery.codexDir` | string | — |
| `discovery.hermesDir` | string | — |
| `discovery.copilotDir` | string | — |
| `hostMetrics.enabled` | boolean | true |
| `hostMetrics.intervalSec` | integer | 5 |
| `hostMetrics.mergePeers` | boolean | true |
| `hostMetrics.sshHosts` | array<object> | [] |
| `aiMetrics.intervalSec` | integer | 10 |
| `aiMetrics.windowSec` | integer | 900 |
| `aiMetrics.retentionSamples` | integer | 5400 |
| `aiMetrics.hostProbe` | boolean | true |
| `aiMetrics.servers` | array<object> | [] |
| `aiMetrics.mergePeers` | boolean | true |
| `aiMetrics.probeKnown` | boolean | true |
| `inference.intervalSec` | integer | 2 |
| `inference.windowHours` | integer | 72 |
| `inference.minReadPrefill` | integer | 4000 |
| `inference.engines` | array<object> | [] |
| `inference.gate.engines` | array<object> | [] |
| `terminals` | array<object> | [] |
| `terminalAutodetect` | boolean | true |

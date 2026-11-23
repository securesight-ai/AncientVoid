<div align="center">

# AncientVoid

**Run Claude Code, Codex, pi and every other coding agent on your own machines, and steer them from your phone, tablet or PC.**

Self-hosted · open source · no cloud: the only server is yours.

[![CI](https://github.com/securesight-ai/AncientVoid/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/securesight-ai/AncientVoid/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-34d399)](LICENSE)
[![Node 22.18+](https://img.shields.io/badge/node-22.18%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Hub: Linux · Windows](https://img.shields.io/badge/hub-Linux%20%C2%B7%20Windows-4b5563)](#platform-support)
[![Client: any browser (PWA)](https://img.shields.io/badge/client-any%20browser%20(PWA)-7c3aed)](docs/guide/README.md)

<picture>
  <source media="(max-width: 700px)" srcset="apps/site/assets/demo-02.webp">
  <img src="apps/site/assets/demo-01.webp" width="100%" alt="Animated demo: an agent asks to run a shell command, it is approved with one tap on the phone, and the desktop updates live while the agent continues">
</picture>

<sub>Real recording from a demo hub with a stand-in agent, no real data
(<a href="scripts/readme-demo.mjs">reproducible</a>). The UI is German today;
an English UI is <a href="epics/EPIC-P61-mehrsprachigkeit-englisch.md">in progress</a>.</sub>

[Quick start](#quick-start) · [Why](#why-ancientvoid) · [Features](#what-you-can-do) · [Agents](#works-with-the-agents-you-already-use) · [Security](#security-model) · [FAQ](#faq) · [User guide](docs/guide/README.md)

</div>

## Why AncientVoid

Coding agents work on their own for half an hour, then stop for one question
or one risky command. Away from your desk, the work stalls. AncientVoid puts every
session from all your machines into **one queue on your phone**: you answer,
approve or redirect, and the *running* agent continues.

- **Your code stays home.** The hub runs on your machine, reachable only
  through your private network ([Tailscale](https://tailscale.com)). There is
  no AncientVoid cloud or account, and no telemetry.
- **One app for every screen.** An installable PWA, so there is no app store,
  with layouts for phone, foldable, tablet and a four-tile desktop.
- **Any agent, your subscriptions.** Claude Code, Codex, pi, opencode, Copilot
  CLI, Cursor, Hermes, aider, any [ACP](https://agentclientprotocol.com) agent
  and local models. It is a control plane, not another bill.
- **Take over terminal sessions.** *Discovery* finds agent sessions you
  started in a terminal. Preview them, take them over or fork a copy.
- **Approve safely from anywhere.** Destructive tool calls need your
  fingerprint or face (passkey). No answer means no.
- **Crash-proof.** Every session is an append-only event log, so after
  `kill -9` the hub is back in under 3 s.

## Quick start

You need Node `^22.18.0 || ^24 || >=26`, git and bash (on Windows, Git Bash).
tmux is optional (Linux), and you need [Tailscale](https://tailscale.com) for
phone access.

```bash
git clone https://github.com/securesight-ai/AncientVoid.git
cd AncientVoid
./setup.sh
```

The wizard checks Node and detects your installed agents (`claude`, `codex`,
`opencode`, `copilot`, `pi`, `hermes`, `dsh`). It then builds the PWA, issues a
device token and starts the hub on `http://127.0.0.1:7373`. If you don't have
an agent installed yet, `./setup.sh --adapter=dummy` gives you a synthetic
agent that needs no account. Re-running is safe; a missing prerequisite fails
loudly with an [exit code](docs/referenz-wizard.md).

**On your phone**, in three steps:

1. Run `scripts/setup-tailscale-serve.sh`. It publishes the hub **inside your
   tailnet only** and prints `https://<machine>.<tailnet>.ts.net`.
2. Open that URL on your phone and choose *Add to Home Screen*.
3. Issue a token per device (`node apps/hubctl/src/cli.ts token issue my-phone --db data/hub.db`)
   and paste it once. It is shown once and stored only as a hash
   ([why there is no QR code](docs/adr/0073-handy-kopplung.md)).

<details>
<summary><b>Manual setup, wizard flags, running as a service</b></summary>

```bash
npm install
cp apps/hub/hub.config.example.json hub.config.json   # list your adapters
npm -w @ancientvoid/pwa run build
node apps/hub/src/main.ts                             # 127.0.0.1:7373, no build step
node apps/hubctl/src/cli.ts token issue "my-phone" --db data/hub.db
ANCIENTVOID_TOKEN=<token> node apps/hubctl/src/cli.ts sessions
```

Wizard flags: `--yes`, `--adapter=<id>`, `--base-url=<url>` and `--model=<id>`
(with `--adapter=openai`), `--port=<n>`, `--device-label=<name>`, `--no-pwa`,
`--no-start`, `--voidwarden` (extra read-only `agent:` and `display:` tokens
for the optional VoidWarden companion, a separate non-public project). Running
the hub as a systemd user service: [operations runbook](docs/operations-runbook.md).

</details>

Next: the [user guide](docs/guide/README.md) (English, a screenshot of every
page). Deeper docs are in German for now: [first 15 minutes](docs/tutorial-erste-schritte.md) ·
[configuration](docs/configuration.md) · [multi-host fleet](docs/fleet.md) ·
[encrypted backup](docs/backup-restore.md) · [all docs](docs/uebersicht.md).

## What you can do

| | |
|---|---|
| **Monitor** | One live queue for every session on every machine, with the ones that need you first. Web push when an agent waits. The last state stays readable offline. |
| **Steer** | Send follow-ups to the *running* agent, answer its questions, line up the next prompt, attach files and images, or dictate via your own speech-to-text endpoint. Pause, stop and resume. |
| **Approve** | *read* / *write* / *destructive* classes, a passkey for destructive actions, fail-closed timeouts and a full audit trail. |
| **Review** | A git worktree per session, diffs by file and hunk, notes on diff lines sent back to the agent, code search and a file explorer. |
| **Scale out** | A multi-host fleet in one UI. Hand a session from PC to phone. Agent teams planned as a DAG with gates. Automations and external agent "factories" as loops. |
| **Integrate** | The `hubctl` CLI and an optional MCP gateway (off by default) for other agents. A desktop companion types your phone dictation into the focused PC window (Wayland). |

Every feature with its end-to-end test: [feature inventory](docs/funktionsinventar.md) (German).

## Works with the agents you already use

- **Native adapters:** Claude Code · Codex · pi · opencode · GitHub Copilot CLI · Cursor · Hermes · aider
- **Any ACP harness** through presets, with no adapter needed: Copilot `--acp`, opencode `acp`, DeepSeek `dsh`, maki, …
- **Local and API models:** any OpenAI-compatible endpoint, such as llama.cpp, LM Studio, Ollama, vLLM or DeepSeek
- **Observe only:** `claude-clip` and `cursor-clip` follow sessions you run yourself, without steering them

<details>
<summary><b>Capability matrix, checked against the real code in CI</b></summary>

What each harness supports in detail (follow-up, interrupt, tool approval,
questions, model choice, attachments) is listed in the
[harness matrix](docs/harness-matrix.md) ([ADR-0018](docs/adr/0018-harness-features-and-native-gates.md)).

| Adapter | Integration | Reasoning | Tools | Cost | Steer | Quota | Status | Resume ([ADR-0036](docs/adr/0036-resume-referenzen-im-adapter-contract.md)) |
|---|---|---|---|---|---|---|---|---|
| `dummy` | synthetic | ✓ | ✓ | — | ✓ | — | proven | — |
| `claude` | CLI (stream-json) | ✓ | ✓ | ✓ | ✓ | ✓ | proven | `claude --resume <id>` |
| `codex` | CLI (`app-server` JSON-RPC) | ✓ | ✓ | ~ | ✓ | ✓ | proven | `codex resume <id>` |
| `opencode` | CLI (`--format json`) | ✓ | ✓ | ✓ | ✓ | — | proven | `opencode --session <id>` |
| `copilot` | CLI (`--output-format json`) | — | ✓ | — | ✓ | — | proven (Copilot CLI 1.0.86, live captures) | — |
| `pi` | CLI (`pi -p`, JSON events) | ✓ | ✓ | — | ✓ | — | proven (headless `pi -p` live) | — |
| `cursor` | CLI (`cursor-agent`, stream-json) | ✓ | ✓ | — | ✓ | — | built (capabilities live-checked) | `cursor-agent --resume <id>` |
| `hermes` | CLI (`chat -q`, plaintext) | — | ✓ | — | ✓ | — | built + smoke (resume live-verified) | `hermes --resume <id>` |
| `aider` | CLI (`--message`, plaintext) | — | ✓ | — | ✓ | — | built, unproven (no real LLM turn yet) | — |
| `local-llm` | OpenAI-compatible | ✓ | — | — | ✓ | — | template (no local instance verified) | — |
| `deepseek` | OpenAI-compatible (`api.deepseek.com`) | ✓ | — | — | ✓ | — | template (no API key verified) | — |
| `cursor-clip` | `state.vscdb` (read-only) | ✓ | ✓ | — | **no** | — | proven, may break by design (K9) | — |
| `claude-clip` | transcript JSONL (read-only) | ✓ | ✓ | — | **no** | — | proven, observes only (K9) | — |

Legend: ✓ supported · — verified absent · `~` partial. Quota means
`capabilities().usage`, an account-level quota window
([ADR-0004](docs/adr/0004-account-level-usage-quota.md)) that is never guessed.
**Honesty clause:** an adapter only becomes "proven" after its contract tests
pass. `npm run check:adapter-matrix` checks the Reasoning to Quota columns
against each adapter's real `capabilities()` and checks the harness matrix
for feature declarations and command scopes.

</details>

<details>
<summary><b>Bring your own endpoint, no fork needed</b></summary>

An adapter is a module that exports `createAdapter(config)`, either a local
file or an npm package. Register it in `hub.config.json`:

```json
{
  "adapters": [{
    "id": "local-llm",
    "module": "./examples/adapters/openai-compat/adapter.ts",
    "config": { "baseUrl": "http://127.0.0.1:8080/v1", "model": "qwen2.5-coder" }
  }]
}
```

Template: [`examples/adapters/openai-compat/`](examples/adapters/openai-compat/) ·
guide: [`docs/adapters.md`](docs/adapters.md) · contract test kit:
`@ancientvoid/adapter-testkit` (green means the adapter can be integrated into the hub).

</details>

## Knowledge backends (second brain)

The hub speaks MCP, so any MCP knowledge server plugs in as a *source* —
no adapter code, just URL and token ([ADR-0096](docs/adr/0096-knowledge-source-mcp-client.md),
[EPIC-P74](epics/EPIC-P74-knowledge-mcp-brick.md)):

- **In the app:** Settings → *Wissensquellen* → add URL + token (bearer,
  custom header, or none). Search, read and explore the graph from the
  *Wissen* tab of the notes area, with retrieval parameters (topK, fusion,
  minScore) visible, not hidden. Writing a note always goes through the
  approval queue — for humans and agents alike.
- **For your agents:** the same sources are reachable through the MCP gateway
  (`hub_search knowledge`) — read-only search/read, and `knowledge.add` as a
  write that waits for your approval.
- **Your own backend:** expose `kb_overview`, `kb_search`, `kb_read`
  (optionally `kb_graph`, `kb_add`) over Streamable HTTP and any AncientVoid
  hub can use it. The same URL + token works in Claude Code, Cursor or Codex
  as an MCP server — the interface is the contract, not the client.

Retrieved content is displayed as data, never executed as instructions, and
every response is capped (`topK` ≤ 20, snippets ≤ 600 chars) with a visible
`truncated` marker.

## How it works

<picture>
  <source media="(max-width: 700px)" srcset="apps/site/assets/architecture-02.webp">
  <img src="apps/site/assets/architecture-01.webp" width="100%" alt="Architecture: phones, tablets and desktop browsers reach the AncientVoid hub only through your tailnet. The hub keeps an event log, approvals, git worktrees and push, and drives your agent CLIs through adapters. More hubs join as a fleet. Everything stays inside your machines and network; only the agents' own API calls go out to their model providers.">
</picture>

- **One hub per machine** runs your agent CLIs as supervised workers (tmux or
  child processes). It records every session as an append-only event log in
  JSONL, SQLite (`node:sqlite`, no native modules) and blobs.
- **Contracts first:** adapters only see a narrow `AdapterContext` and never
  hub internals. Boundaries are enforced in CI (`npm run check:arch`), and
  contract changes need an ADR. Details: [architecture](docs/architecture.md),
  [ADR-0020](docs/adr/0020-modular-monolith-structure.md).
- **No build step for the server:** Node runs the TypeScript directly. The PWA
  is Preact and Vite.

Measured quality bars, not adjectives ([PRD §9](epics/2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)):

| ID | Bar | How it is enforced |
|---|---|---|
| K5 | Event payload ≤ 4 KB, everything larger goes to blobs | EventStore capping + `blob_ref`, property-tested |
| K7 | `kill -9` → 100 % state restored in < 3 s | JSONL replay + snapshot + `adapter.recover()` |
| K8 | 20 sessions × 30 events/s without loss | `npm run loadtest` (green: 605 ev/s aggregate) |
| K10 | PWA offline shows last state + timestamp | service worker with `X-AncientVoid-Cached-At` |

## Security model

- **No public port.** The hub binds `127.0.0.1`, and phones reach it through
  `tailscale serve` inside your tailnet. Any other binding needs an explicit
  opt-in (`ANCIENTVOID_EXPOSE=1`, at your own risk).
- **Device tokens** are shown once and stored only as SHA-256 hashes. Tailscale
  identity can optionally be enforced. Scoped `agent:` and `display:` tokens
  give integrations least privilege.
- **Approval classes** have fail-closed timeouts, destructive actions need a
  passkey, and every decision is part of the audit trail.
- **Prompt-injection boundary:** agent output is *data* for the UI, never an
  instruction. There is no free shell from the phone, only registered adapter
  operations.
- **No telemetry, no analytics, no phoning home.**

Details and known gaps: [`docs/security.md`](docs/security.md) (German).
Report vulnerabilities privately via [`SECURITY.md`](SECURITY.md).

## Platform support

| Where | Status |
|---|---|
| **Linux** | Primary. Used daily, with the hub as a systemd user service ([runbook](docs/operations-runbook.md)). |
| **Windows** | Native, no WSL needed. Run the setup in Git Bash; workers run as child processes (tmux is Linux-only). |
| **macOS** | Untested. The hub is plain Node, so it may well work. Reports and PRs are welcome. |
| **Clients** | Any modern browser as an installable PWA, with layouts for phone, foldable, tablet and desktop. Developed on Android/Chromium and desktop browsers; iOS Safari is not regularly tested. |

The desktop companion needs Wayland (Hyprland or sway).

## FAQ

**How is this different from vendor remote controls (for example Claude Code
remote control, or Codex in the ChatGPT app)?** Those steer one vendor's agent
through that vendor's cloud. AncientVoid steers all your agents side by side,
and nothing passes through a service of ours, because there isn't one.

**And from relay-based mobile apps?** Those route your sessions through a relay
server (usually end-to-end encrypted) and need a native app. AncientVoid talks
to your own hub over your private network and runs in the browser.

**Why not just SSH + tmux on my phone?** You get structured turns, one-tap
approvals, diffs, push notifications and offline state instead of a terminal on
a phone keyboard. On Linux, your sessions can still run in tmux.

**Does it need API keys or cost anything?** No. It drives the CLIs you are
already logged into. For local models, point it at your own endpoint.

**Is it ready?** It is pre-1.0 and used daily by its author. It has 300+ test
files, 100+ Playwright specs against a real hub, a load test and 80+ ADRs.
Expect rough edges, and an English UI soon.

## Contributing

Contributions are welcome. The easiest first one is an adapter for your
favourite agent ([guide](docs/adapters.md)), or a look at the
[good first issues](https://github.com/securesight-ai/AncientVoid/labels/good%20first%20issue).
Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Coding agents working in this repo
follow [`AGENTS.md`](AGENTS.md) and the skills in `.claude/skills/`.

## License

AncientVoid is open source under the [GNU AGPL-3.0-only](LICENSE). You may use,
self-host, modify and share it freely, at work too. If you run a **modified**
version as a network service for others, you must publish your changes under
the same license.

**Commercial license:** if the AGPL does not fit your use (for example closed
modifications or embedding in a proprietary product), the copyright holder
offers a separate commercial license. Contact
[jan.pfrommer@securesight.ai](mailto:jan.pfrommer@securesight.ai)
([ADR-0086](docs/adr/0086-lizenz-agpl-mit-kauflizenz.md)).

Copyright © 2026 SiLenT_Tz (Jan Pfrommer) and contributors.

# AncientVoid — User Guide

**Art:** how-to

**Stand:** 2026-11-16 (EPIC-P62 T62.4) · **Screenshots:** generated deterministically
from the demo hub (`npm run demo:seed`, `npm run guide:shots`) — never from a
live setup (rules: [demo-media.md](../demo-media.md)). · **Surface contract:**
[inventory.md](inventory.md) — every section below maps to an inventory ID;
the CI test keeps both in sync.

AncientVoid is a local-first hub for monitoring and steering coding agents
from your phone, tablet or PC. This guide walks through every surface of the
app. Each section names the e2e spec that pins its behavior — if the app and
this guide ever disagree, the spec is the tiebreaker.

**First steps:** run `./setup.sh` (or `npm run setup`), pair your phone via
the device token, and you are on the overview. The German first-steps
tutorial with verified commands lives in
[`docs/tutorial-erste-schritte.md`](../tutorial-erste-schritte.md).

## Pages

### page:dashboard — Overview

![Overview with session cards and view tabs](assets/overview-01.png)

The start page (`#/`). Session cards show project, last activity and status;
tabs switch between **Sessions**, **Projects**, **Hosts** and **Discovery**.
A card tap opens the session, the card fold-out shows details. Order is
"your turn first, then working, then quiet" — approvals and questions
surface at the top.

Spec: [overview-shell.spec.ts](../../e2e/specs/overview-shell.spec.ts)

### page:new — New session

![New session form with project, adapter and prompt](assets/new-01.png)

`#/neu`. Pick the project first — the path follows the selection and stays
overridable. Choose the adapter (or a loop), type the start prompt, pick the
workplace mode (worktree or direct folder) and press **Starten**. A second
session in a non-git folder asks for explicit confirmation before writing in
parallel.

Spec: [session.spec.ts](../../e2e/specs/session.spec.ts)

### page:settings — Settings

![Settings page with appearance and provider options](assets/settings-01.png)

`#/einstellungen`. Appearance (accent color, fonts, presets), branding,
providers and language — per device where it makes sense, shared where the
hub owns it. The keyboard shortcut cheat sheet (`?`) is reachable from here.

Spec: [settings-layout.spec.ts](../../e2e/specs/settings-layout.spec.ts)

### page:approvals — Approvals

![Approval queue with an agent request](assets/approvals-01.png)

`#/freigaben`. Agent requests that need a human decision: starts, prompts,
tool permissions. Approve, reject or answer inline; every decision is
attributed to the device that made it. Pending approvals survive a hub crash
and run exactly once.

Spec: [quick-confirm.spec.ts](../../e2e/specs/quick-confirm.spec.ts)

### page:status — System status

![Hub system status page](assets/status-01.png)

`#/status`. Hub health at a glance: uptime, memory, workers, adapters and
the recovery state. What is unknown is said out loud — never a green guess.

Spec: [tool-pane.spec.ts](../../e2e/specs/tool-pane.spec.ts)

### page:media — Media

![Media library with an uploaded item](assets/media-01.png)

`#/medien`. Uploads and video analyses: transcripts, key frames, chapters,
summaries as session material. Local models first; cloud only when a job
explicitly allows it.

Spec: [media.spec.ts](../../e2e/specs/media.spec.ts)

### page:pc — PC workspace

![PC workspace with session tiles](assets/pc-01.png)

`#/pc`. Up to four sessions as tiles (layouts 1 / 2 / 1+2 / 2×2) on a wide
screen, keyboard-first like a tiling window manager, layout persisted per
device.

Spec: [desktop.spec.ts](../../e2e/specs/desktop.spec.ts)

### page:vault — Notes

![Notes vault with folder picker and editor](assets/vault-01.png)

`#/notizen`. Your project notes: pick any folder as the vault, edit
Markdown, open notes as their own window. Edits guard against losing your
text (revision guard).

Spec: [vault.spec.ts](../../e2e/specs/vault.spec.ts)

### page:teams — Agent teams

![Team detail with worker cards](assets/teams-01.png)

`#/teams`. Plan work as a team of agents: a card per running worker, DAG
dependencies, model allowlist per task, gates and deliveries. Only humans
start, answer or stop a team.

Spec: [team.spec.ts](../../e2e/specs/team.spec.ts)

### page:automationen — Automations

![Automations list with a weekly audit plan](assets/automationen-01.png)

`#/automationen`. Scheduled runs (e.g. a weekly audit): time plan, prechecks,
run history, recovery on failure.

Spec: [automations.spec.ts](../../e2e/specs/automations.spec.ts)

### page:statistics — Analyse: Statistiken, Metriken, Inferenz

`#/statistik` (BUG-0257: one page, three tabs — deep links `#/statistik/metriken`
and `#/statistik/inferenz`; the old page links redirect permanently).

![AI server metrics page](assets/aimetrics-01.png)

**Tab Statistik** (EPIC-P56/P66): the one metrics hub — system and AI server
sections from the unchanged aimetrics report, consolidated session,
turn/token, gate, tool and team numbers from the rollup cache — p50/p90/p95
with n, small-sample marks, end-reason distribution, sliced by period,
project, host and harness. Sections collapse; the state and the slice
survive reloads. Describing, not ranking.

**Tab Metriken** (EPIC-P59): direct samples from your local AI server:
CPU/GPU, tokens/s, prefill/decode, KV cache.
Spec: [ki-server-metriken.spec.ts](../../e2e/specs/ki-server-metriken.spec.ts)

**Tab Inferenz** (EPIC-P79): per engine decode/prefill tokens/s, time to
first token, KV reuse and the request distribution (p10/median/p90/peak,
outliers called out). Counter-only engines (llama.cpp, Halogen) refuse a
distribution and say why; a failed probe stays visible.
Spec: [inference-tempo.spec.ts](../../e2e/specs/inference-tempo.spec.ts)

Spec: [statistik.spec.ts](../../e2e/specs/statistik.spec.ts)


### page:terminal — Terminal

`#/terminal`. Connect to allowlisted hosts (`terminals[]` in hub config):
OpenSSH targets or a local shell on the hub. For operators who need a
manual shell without leaving AncientVoid (ADR-0087).

Spec: [terminal.spec.ts](../../e2e/specs/terminal.spec.ts)

### page:releasenotes — Release notes

`#/releasenotes`. Merged pull requests of a project, straight from the local
git history (no network, ADR-0093): each PR as one line — risk, intent,
area and summary from the commit notation, PR number, date, files and
±lines. Expand for the why (PR description) and the what (branch commits
with their own notation and reasoning, changed files). Subjects without
notation stay visible, raw and marked.

Spec: [release-notes.spec.ts](../../e2e/specs/release-notes.spec.ts)

## Views

### view:list — The list shell

Every page renders in the list column; on the PC the dock lives here, tool
pages fill the detail column. Deep links (`#/…`) work everywhere and browser
back goes back.

Spec: [navigation.spec.ts](../../e2e/specs/navigation.spec.ts)

### view:tail — A session

![Session detail with chat, turn fold and tabs](assets/session-01.png)

Chat in turns: each turn folds its steps, the status line shows only what
was measured, tabs expose **Changes** (diff), **Report**, files and graph.
Steer with the composer — answers, stops and resumes reach the agent; a
double-tap never starts two turns.

Spec: [session.spec.ts](../../e2e/specs/session.spec.ts)

### view:devices — Devices

`#/geraete`. Pair a phone or tablet, rotate and revoke device tokens. A
device token is shown exactly once at pairing (prefix `avt_`).

Spec: [auth.spec.ts](../../e2e/specs/auth.spec.ts)

### view:filetree — File tree

`#/dateibaum`. The project explorer: full file tree, viewers for text,
Markdown, JSON, CSV, notebooks, archives; language diagnostics mark broken
files.

Spec: [dateibaum-epic-status.spec.ts](../../e2e/specs/dateibaum-epic-status.spec.ts)

## Layers (session panel)

### layer:files — Files

Quick access to the project's files from within a session, with the same
viewers as the file tree.

Spec: [file-viewers.spec.ts](../../e2e/specs/file-viewers.spec.ts)

### layer:browser — Browser

A hosted Chromium for browser testing: navigate, run test assertions,
measure latency, pick designs.

Spec: [browser-workspace.spec.ts](../../e2e/specs/browser-workspace.spec.ts)

### layer:devices — Devices

Connected devices hub-side: which phones are linked, tokens and their last
use.

Spec: [auth.spec.ts](../../e2e/specs/auth.spec.ts)

## Features


### feature:approvals

Approve, reject or answer requests — see [page:approvals](#pageapprovals--approvals). Spec: [quick-confirm.spec.ts](../../e2e/specs/quick-confirm.spec.ts)

### feature:attachments

Attach files to prompts; the hub extracts content where it can and says so
when it cannot. Spec: [attachments.spec.ts](../../e2e/specs/attachments.spec.ts)

### feature:automations

Scheduled work — see [page:automationen](#pageautomationen--automations). Spec: [automations.spec.ts](../../e2e/specs/automations.spec.ts)

### feature:browser

The hosted browser test workspace — see [layer:browser](#layerbrowser--browser). Spec: [browser-workspace.spec.ts](../../e2e/specs/browser-workspace.spec.ts)

### feature:clipboard

Multi-level clipboard shelf in the browser: up to six pasteable stages
(dictation, selection, command, entry, id). Tokens stay out of the shelf.
Opens from the composer shelf button. Spec: [clipboard-shelf.spec.ts](../../e2e/specs/clipboard-shelf.spec.ts)

### feature:code

Search code, run registered actions in the worktree, open files with line
anchors — also from chat mentions. Spec: [code.spec.ts](../../e2e/specs/code.spec.ts)

### feature:commands

Slash commands (`/compact`, …) with scope-filtered autocomplete; what the
adapter does not support is said, not silently dropped. Spec: [befehle.spec.ts](../../e2e/specs/befehle.spec.ts)

### feature:composer

The prompt composer: enhance, recommendation, skills and agents, source
chips, presets — one field, honest suggestions. Spec: [workspace.spec.ts](../../e2e/specs/workspace.spec.ts)

### feature:desktop

Desktop workspace and companion — see [page:pc](#pagepc--pc-workspace). Spec: [desktop.spec.ts](../../e2e/specs/desktop.spec.ts)

### feature:devices

Device pairing and token management — see [view:devices](#viewdevices--devices). Spec: [auth.spec.ts](../../e2e/specs/auth.spec.ts)

### feature:discovery

Sessions found on disk (claude, codex, opencode, pi, …): preview, take over
without a prompt or as a copy; "runs elsewhere" is shown. Spec: [discovery.spec.ts](../../e2e/specs/discovery.spec.ts)

### feature:files

File viewers and diagnostics — see [layer:files](#layerfiles--files). Spec: [file-viewers.spec.ts](../../e2e/specs/file-viewers.spec.ts)

### feature:fleet

Multiple hosts in one surface: host chips, steering across hosts, handoff
between devices. Spec: [fleet.spec.ts](../../e2e/specs/fleet.spec.ts)

### feature:forge

Forge context (GitLab/GitHub): issues, reviews, CI results and feeding
review feedback back. Spec: [forge-review.spec.ts](../../e2e/specs/forge-review.spec.ts)

### feature:git-graph

The git history as a graph, in the session tab „Git“ (the former global
Git-Struktur layer is removed). Spec: [git-graph.spec.ts](../../e2e/specs/git-graph.spec.ts)

### feature:graph

The repository graph: a pulsing network of files and references, with the
galaxy view for orientation. Spec: [repo-graph.spec.ts](../../e2e/specs/repo-graph.spec.ts)

### feature:knowledge

Knowledge sources (Settings → Wissensquellen): connect an MCP knowledge server such as the HiveMind Librarian with URL and token (bearer, custom header or none; the token is write-only). "Prüfen" shows a status per source — reachable, unreachable, access denied, protocol error, source error. Search results and documents are shown as plain text, never as instructions. Spec: [knowledge-sources.spec.ts](../../e2e/specs/knowledge-sources.spec.ts)

### feature:loops

Loop connectors (factory, orchestrators) as steer-able sessions. Spec: [loops.spec.ts](../../e2e/specs/loops.spec.ts)

### feature:media

Media analysis — see [page:media](#pagemedia--media). Spec: [media.spec.ts](../../e2e/specs/media.spec.ts)

### feature:new-session

The new-session form — see [page:new](#pagenew--new-session). Spec: [session.spec.ts](../../e2e/specs/session.spec.ts)

### feature:notifications

The notification bell (corner of the window on the PC) and the
notification center; background pushes reach a locked phone. Spec: [notifications.spec.ts](../../e2e/specs/notifications.spec.ts)

### feature:nyx

Nyx, the in-app assistant: the sheet holds the conversation, the FAB opens
it from anywhere. Spec: [nyx-blatt.spec.ts](../../e2e/specs/nyx-blatt.spec.ts)

### feature:overview

Overview lists and the view switch — see [page:dashboard](#pagedashboard--overview). Spec: [overview-shell.spec.ts](../../e2e/specs/overview-shell.spec.ts)

### feature:release-notes

Release notes list with per-PR collapsible details — see [page:releasenotes](#pagereleasenotes--release-notes). Spec: [release-notes.spec.ts](../../e2e/specs/release-notes.spec.ts)

### feature:search

Quick search across inventory and files — `Strg+K` from anywhere. Spec: [schnellsuche.spec.ts](../../e2e/specs/schnellsuche.spec.ts)

### feature:session

Chat, steering, turns and tabs — see [view:tail](#viewtail--a-session). Spec: [session.spec.ts](../../e2e/specs/session.spec.ts)

### feature:settings

Settings views — see [page:settings](#pagesettings--settings). Spec: [settings-layout.spec.ts](../../e2e/specs/settings-layout.spec.ts)

### feature:shell

App shell: dock, layout, frame — the parts every page shares. Spec: [layout.spec.ts](../../e2e/specs/layout.spec.ts)

### feature:status

The status line shows only measured values; the unknown moves to the
report. Spec: [zustandssprache.spec.ts](../../e2e/specs/zustandssprache.spec.ts)

### feature:statistics

Session, turn, gate, tool and team statistics with time/project/host/harness
slices — see [page:statistics](#pagestatistics--statistiken). Spec: [statistik.spec.ts](../../e2e/specs/statistik.spec.ts)

### feature:stt

Dictation: local speech-to-text fills the composer (Nyx FAB). Spec: [voice-local.spec.ts](../../e2e/specs/voice-local.spec.ts)

### feature:team

Teams — see [page:teams](#pageteams--agent-teams). Spec: [team.spec.ts](../../e2e/specs/team.spec.ts)

### feature:terminal

Allowlisted SSH/local shell — see [page:terminal](#pageterminal--terminal). Spec: [terminal.spec.ts](../../e2e/specs/terminal.spec.ts)

### feature:vault

Notes — see [page:vault](#pagevault--notes). Spec: [vault.spec.ts](../../e2e/specs/vault.spec.ts)

### feature:windows

Popout windows: session, graph, file or vault as their own window; targets
survive reloads. Spec: [windows.spec.ts](../../e2e/specs/windows.spec.ts)

### feature:workspace

Archive, approvals flow, budget, composer flows around a session. Spec: [workspace.spec.ts](../../e2e/specs/workspace.spec.ts)

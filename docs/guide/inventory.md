# Guide-Inventar der PWA-Oberfläche (EN)

**Art:** referenz

**Stand:** 2026-11-16 (EPIC-P62 T62.1) · **Zweck:** verbindliche Flächenliste für
Guide (T62.4), Videos (T62.5) und Promo-Feature-Grid (T62.6). · **Gate:**
`apps/pwa/test/guide-inventory.test.ts` — neue Seite/Layer/Feature ohne
Eintrag ist rot (AC-P62-1, Fail loud).

Diese Datei inventarisiert die **Struktur** der Oberfläche (Seiten, Views,
Layer, Feature-Ordner). Wege und Interaktionen inventarisiert das deutsche
[Funktionsinventar](../funktionsinventar.md) (eigenes E2E-Gate); beide
Dateien verweisen auf dieselben e2e-Specs und ändern sich im selben Commit.

Regeln:

- Jede Zeile: `ID | english description | route/target | e2e spec`. Die
  Spec-Spalte nennt eine existierende Spec-Datei unter `e2e/specs/`
  (ohne `.spec.ts`).
- Neue Seite (`PAGE_SLUG` in `apps/pwa/src/app/route.ts`), neuer Layer
  (`LayerKind` in `apps/pwa/src/shared/layers.ts`) oder neuer Feature-Ordner
  unter `apps/pwa/src/features/` ohne zugehörige Zeile → roter Test.
- Entfernte Einträge ohne Ersatz → roter Test (Drift in beide Richtungen).

## Pages (Liste/Werkzeugseiten — `PAGE_SLUG`)

| ID | English description | Route | e2e spec |
|---|---|---|---|
| page:dashboard | Overview: sessions, projects and hosts at a glance | `#/` | overview-shell |
| page:new | Create a new session: project, adapter, prompt | `#/neu` | session |
| page:settings | Settings: appearance, branding, providers, language | `#/einstellungen` | settings-layout |
| page:approvals | Approval queue for agent requests | `#/freigaben` | quick-confirm |
| page:status | Hub system status and health | `#/status` | tool-pane |
| page:media | Media library: uploads and video analyses | `#/medien` | media |
| page:pc | PC workspace: session tiles and layouts | `#/pc` | desktop |
| page:vault | Notes vault with folder picker | `#/notizen` | vault |
| page:swarms | Agent swarms: plan, dispatch, gates, deliveries | `#/swarms` | swarm |
| page:automationen | Automations: schedules and run history | `#/automationen` | automations |
| page:statistics | One analysis page with tabs: session/turn/gate/tool statistics, host monitoring, AI server metrics, inference token tempo | `#/statistik` (+`/hosts`, `/hosts/<id>`, `/metriken`, `/inferenz`) | statistik |
| page:terminal | Allowlisted SSH/local shell in the PWA | `#/terminal` | terminal |
| page:releasenotes | Release notes: merged PRs with what changed and why | `#/releasenotes` | release-notes |
| page:pentest | Pentest page: scan allowlisted targets through the attached pentest backend; profiles, findings, hub job history | `#/pentest` | pentest-seite |

## Views (Hauptansichten)

| ID | English description | Route/target | e2e spec |
|---|---|---|---|
| view:list | List shell — every page above renders in the list column | `#/<slug>` | navigation |
| view:tail | Session detail: chat, turns, tabs (chat/changes/report/files/graph) | `#/sessions/<id>` | session |
| view:devices | Devices and device tokens management | `#/geraete` | auth |
| view:filetree | Project file tree (explorer) | `#/dateibaum` | dateibaum-epic-status |

## Layer (rechtes Panel in der Session)

| ID | English description | Target | e2e spec |
|---|---|---|---|
| layer:files | Files layer: project file quick access and viewers | Session-Layer `files` | file-viewers |
| layer:browser | Browser layer: hosted Chromium test workspace | Session-Layer `browser` | browser-workspace |
| layer:devices | Devices layer: connected devices | Session-Layer `devices` | auth |

## Features (`apps/pwa/src/features/`)

| ID | English description | e2e spec |
|---|---|---|
| feature:approvals | Approve, reject or answer agent requests | quick-confirm |
| feature:attachments | Attach files to prompts | attachments |
| feature:automations | Automation plans: create, activate, history | automations |
| feature:browser | Hosted browser workspace for testing | browser-workspace |
| feature:clipboard | Multi-level clipboard shelf: six pasteable stages, tokens excluded | clipboard-shelf |
| feature:code | Code search, actions and file open with anchors | code |
| feature:commands | Slash commands with scope-filtered autocomplete | befehle |
| feature:composer | Prompt composer: enhance, recommend, skills | workspace |
| feature:desktop | Desktop workspace and companion surface | desktop |
| feature:devices | Device pairing and token management | auth |
| feature:discovery | Discovered sessions: preview and takeover | discovery |
| feature:files | File viewers and language diagnostics | file-viewers |
| feature:fleet | Multi-host fleet views and steering | fleet |
| feature:forge | Forge context: issues, reviews, CI | forge-review |
| feature:git-graph | Git history graph | git-graph |
| feature:graph | Repository graph (pulsing network) | repo-graph |
| feature:knowledge | Knowledge sources: connect an MCP knowledge server, check status, search and read | knowledge-sources |
| feature:loops | Loop connectors (factory, orchestrators) | loops |
| feature:media | Media uploads and video analysis | media |
| feature:new-session | New-session form: project choice, workplace, start | session |
| feature:notifications | Notification bell and center | notifications |
| feature:nyx | Nyx assistant: sheet and FAB | nyx-blatt |
| feature:overview | Overview lists and view switch (sessions/projects/hosts/discovery) | overview-shell |
| feature:pentest | Pentest scan form, status card, findings and hub job history for the attached pentest backend | pentest-seite |
| feature:release-notes | Release notes list with per-PR collapsible details | release-notes |
| feature:search | Quick search across inventory and files | schnellsuche |
| feature:session | Session chat, steering, turns and tabs | session |
| feature:settings | Settings views and choices | settings-layout |
| feature:shell | App shell: dock, layout, frame | layout |
| feature:status | Status line language (measured vs unknown) | zustandssprache |
| feature:statistics | One analysis page: metrics hub (system, AI server, sessions/turns/tools) plus inference token/tempo adapters with request history and percentiles | statistik |
| feature:stt | Speech-to-text dictation | voice-local |
| feature:swarm | Swarm cards, DAG view, model choice | swarm |
| feature:team | Team pairing across hubs: invite text, exporter codes, pins (EPIC-P83) | team-pairing |
| feature:terminal | Allowlisted hub SSH/local terminal (xterm) | terminal |
| feature:vault | Vault notes: editor, folders, popout | vault |
| feature:windows | Popout windows and window targets | windows |
| feature:workspace | Archive, approvals flow, budget, composer flows | workspace |

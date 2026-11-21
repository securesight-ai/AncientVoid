---
id: BUG-0248
slug: opencode-normalizer-ohne-shell-command
status: done
severity: S3
area: adapters
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/243"
epic: "EPIC-P72"
created: 2026-11-21
reporter: "EPIC-P72 §0 (Bestandsaufnahme 18.11.2026)"
---

# BUG-0248 — opencode-Normalizer: `shell`/`bash`-tool_use ohne `command`, nur `cwd`

## Fix

ACP UpdateMapper: opencode liefert `command` erst im Update nach `{cwd}`.

## Gesehen

Der opencode-Adapter normalisiert `shell`-/`bash`-`tool_use`-Events ohne
`command`-Feld — im Bestand (18.11.2026) 3 626 Aufrufe mit nur `cwd`. Der
ausgeführte Befehl ist im Eventstrom nicht mehr lesbar.

## Erwartet

Der Normalizer schreibt den ausgeführten Befehl ins `command`-Feld (wie bei
claude `Bash` 4 861/4 861). `cwd` darf zusätzlich bleiben.

## Repro

Voraussetzung: laufender Hub mit opencode-Adapter, eine Session mit ≥ 1
Shell-Aufruf (Bestandsmessung genügt als Beleg; Fixture unten).

1. opencode-Session öffnen, einen Befehl ausführen (z. B. `npm run lint`).
2. `events.jsonl` der Session betrachten: `tool_use` `name: "shell"`.

**Ergebnis nach Schritt 2:** `payload` trägt nur `cwd`, kein `command`.

**Häufigkeit:** immer (3 626/3 626 im Bestand)

## Umgebung

| Feld | Wert |
|---|---|
| Adapter | opencode |
| Bestand | 3 626 betroffene tool_use (18.11.2026) |

## Folge & Status quo

Skill-Kuratierung (EPIC-P72/ADR-0100) zählt diese Aufrufe als `unparsed`
(≈ 39 % aller Shell-Aufrufe zusammen mit BUG-0247), statt sie still zu
droppen — Auswertungen sind dadurch für opencode blind. Kein Ersatz aus `cwd`
(Prompt-Injection-Grenze, PRD §8.5). Fixture-Hinweis: anonymisierte
opencode-Fixture in `scripts/skill-regression/` bzw. den P72-Fixtures
(`shellWithoutCommand > 0`, AC-P72-4).

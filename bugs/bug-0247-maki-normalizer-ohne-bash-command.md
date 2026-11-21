---
id: BUG-0247
slug: maki-normalizer-ohne-bash-command
status: done
severity: S3
area: adapters
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/242"
epic: "EPIC-P72"
created: 2026-11-21
reporter: "EPIC-P72 §0 (Bestandsaufnahme 18.11.2026)"
---

# BUG-0247 — maki-Normalizer: `bash`-tool_use ohne `command`, nur `title`

## Fix

ACP UpdateMapper wartet auf `command` im `tool_call_update` (nicht `title`→command).

## Gesehen

Der maki-Adapter normalisiert `bash`-`tool_use`-Events ohne `command`-Feld —
im Bestand (18.11.2026) 3 553 Aufrufe mit nur `title`. Der ausgeführte
Befehl ist im Eventstrom nicht mehr lesbar.

## Erwartet

Der Normalizer schreibt den ausgeführten Befehl ins `command`-Feld (wie bei
claude `Bash` 4 861/4 861). `title` darf zusätzlich bleiben.

## Repro

Voraussetzung: laufender Hub mit maki-Adapter, eine Session mit ≥ 1
Shell-Aufruf (Bestandsmessung genügt als Beleg; Fixture unten).

1. maki-Session öffnen, einen Befehl ausführen (z. B. `npm run lint`).
2. `events.jsonl` der Session betrachten: `tool_use` `name: "bash"`.

**Ergebnis nach Schritt 2:** `payload` trägt nur `title`, kein `command`.

**Häufigkeit:** immer (3 553/3 553 im Bestand)

## Umgebung

| Feld | Wert |
|---|---|
| Adapter | maki |
| Bestand | 3 553 betroffene tool_use (18.11.2026) |

## Folge & Status quo

Skill-Kuratierung (EPIC-P72/ADR-0100) zählt diese Aufrufe als `unparsed`
(≈ 39 % aller Shell-Aufrufe zusammen mit BUG-0248), statt sie still zu
droppen — Auswertungen sind dadurch für maki blind. Kein Ersatz aus `title`
(Prompt-Injection-Grenze, PRD §8.5). Fixture-Hinweis: anonymisierte
maki-Fixture in `scripts/skill-regression/` bzw. den P72-Fixtures
(`shellWithoutCommand > 0`, AC-P72-4).

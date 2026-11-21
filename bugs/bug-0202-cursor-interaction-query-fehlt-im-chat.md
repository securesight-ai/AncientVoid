---
id: BUG-0202
slug: cursor-interaction-query-fehlt-im-chat
status: done
severity: S2
area: adapters
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/116"
epic: ""
created: 2026-11-17
reporter: silenttz
---

# BUG-0202 — Cursor-Fragen/Pläne nur im Verlauf, nicht im Chat

## Gesehen

In einer Cursor-Session erscheint eine vom Agenten gestellte
Architektur-Entscheidung (Plan-/Fragen-UI) **nur** im detaillierten Verlauf
als Systemzeile `cursor: unbehandelter stream-json-Typ "interaction_query"`.
Im Chat-Tab fehlt die Frage — der Nutzer sieht die Optionen nicht und muss
nachfragen. Dieselbe Session hat außerdem **172** Systemzeilen
`unbehandelter stream-json-Typ "tool_call"` und **null** `tool_use`/`tool_result`-Events.

## Erwartet

Nutzer-sichtbare Cursor-Interaktionen (`interaction_query`: Plan-Bestätigung,
Auswahlfragen) landen als Chat-Inhalt (z. B. `assistant`-Text oder ein
eigenes, in `showInChat` sichtbares Ereignis). Werkzeugaufrufe im neuen
`tool_call`-Stream erscheinen als `tool_use`/`tool_result` (Arbeitsschritte
im Chat), nicht nur als `cursor.unhandled` im Verlauf.

## Repro

Voraussetzung: Hub mit Adapter `cursor`, Session am Gerät (PWA-Chat-Tab
„Lesen“ / Dock „Chat“). Agent nutzt Cursor-Planmodus oder eine
Auswahlfrage (CreatePlan / SwitchMode / AskQuestion-Äquivalent).

1. Session starten, Agent eine Aufgabe geben, die eine Architekturwahl
   erzwingt (oder Planmodus).
2. Warten, bis der Agent eine Entscheidung/Plan-UI sendet.
3. Chat-Tab prüfen; danach Verlauf-Tab (Überwachen/Debuggen).

**Ergebnis nach Schritt 3 (ohne Fix):** Chat ohne die Frage; Verlauf zeigt
`cursor.unhandled` mit `type: "interaction_query"`.

**Häufigkeit:** immer, sobald Cursor `interaction_query` / `tool_call`
emittiert (neues stream-json gegenüber dem Claude-Code-Shape).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `918a57f4` (Repro) |
| Node-Version | v26.7.0 |
| Adapter | cursor |
| Repro-Weg | PWA (gesehen) + `events.jsonl` der Session |

## Ursache

`packages/adapters/cursor/src/normalize.ts` — unbekannte Typen wurden als
`cursor.unhandled` emittiert; Parser erwartete noch das Claude-Code-Shape
(`assistant` + Content-Blöcke `tool_use`). Chat-Filter zeigt `cursor.unhandled`
bewusst nicht.

Ground truth für die neuen Formen: Cursor CLI
[output-format](https://cursor.com/docs/cli/reference/output-format)
(`tool_call` started/completed) und harbor#1586 (`interaction_query`
request/response).

## Fix

- `tool_call` → `tool_use` (started) / `tool_result` (completed)
- `interaction_query` request → `assistant` mit Frage/Optionen (Chat-sichtbar)
- `interaction_query` response → `system` `cursor.interaction_response` (Verlauf)

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit | `packages/adapters/cursor/test/normalize.test.ts` (BUG-0202-Block) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue [#116](https://github.com/securesight-ai/AncientVoid/issues/116)
- [x] `bugfix`

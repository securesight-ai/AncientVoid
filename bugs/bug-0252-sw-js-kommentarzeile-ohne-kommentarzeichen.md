---
id: BUG-0252
slug: sw-js-kommentarzeile-ohne-kommentarzeichen
status: fixed
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: "EPIC-P61"
created: 2026-11-22
reporter: "T61.5-Verifikation (E2E-Vollaufbau)"
---

# BUG-0252 — sw.js: Kommentarfortsetzung ohne Kommentarzeichen — ServiceWorker Eval schlägt fehl

## Gesehen

Die zweite Zeile des EPIC-P61-Kommentars in `apps/pwa/public/sw.js`
(`und schickt sie mit; …`) trug kein `//` — die Datei ist damit syntaktisch
ungültig; die Browser-Konsole meldet `ServiceWorker script evaluation failed`,
auf Geräten mit registriertem ServiceWorker bleiben Push-Anzeigen tot.

## Erwartet

`sw.js` ist gültiges JavaScript; die Kommentarzeile ist Kommentar.

## Repro

1. PWA mit zugelassenem ServiceWorker laden (`e2e`-Projekt ohne
   `serviceWorkers: "block"`, oder echtes Gerät).
2. Konsolenausgabe betrachten.

**Ergebnis nach Schritt 2:** `Failed to register a ServiceWorker … script
evaluation failed`.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `38e656d7` (Zeile seit PR #247) |
| Node-Version | 26.13.1 |
| Adapter | — |
| Repro-Weg | e2e-Konsolenprüfung / Browser |

## Logs

```text
Failed to register a ServiceWorker for scope ('http://127.0.0.1:35567/') with
script ('http://127.0.0.1:35567/sw.js'): ServiceWorker script evaluation failed
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `node --check apps/pwa/public/sw.js` | rot (Syntaxfehler) |
| E2E | Projekte mit aktivem ServiceWorker (z. B. `automations-lifecycle`) | rot |

Welcher Test **müsste** ohne Fix rot sein? `node --check` auf `sw.js` als
Build-Härtung — Datei vorschlagen, nicht schreiben.

## Eingrenzung

`apps/pwa/public/sw.js:174` (vor dem Fix).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] Fix im Branch `feat/p61-migration-welle-2` (Commit mit `BUG-0252`)

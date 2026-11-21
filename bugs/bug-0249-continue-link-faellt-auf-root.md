---
id: BUG-0249
slug: continue-link-faellt-auf-root
status: done
severity: S3
area: pwa
instance: dev
commit: "019aa5da"
forge: "https://github.com/securesight-ai/AncientVoid/issues/251"
epic: ""
created: 2026-11-21
reporter: agent
---

# BUG-0249 — Continue-Link im Bericht fällt auf `#/` zurück

## Gesehen

Der Terminal-Fortsetzen-Block des Berichts zeigt als Link `http://<hub>/#/`
statt `http://<hub>/#/sessions/<id>`; der Kopierbefehl daneben stimmt.

## Erwartet

`continue-link` verlinkt auf die eigene Session (`#/sessions/<id>`), wie es
`deeplink.spec.ts` (T5.5) festhält.

## Repro

Voraussetzung: lokaler Test-Hub mit `opencode`-Adapter (E2E-Fixture),
Playwright-Chromium.

1. `npx playwright test e2e/specs/deeplink.spec.ts --project=desktop --grep "zwischen zwei Zügen"`
2. Test legt `opencode`-Session an, wartet auf `idle`, öffnet `#/sessions/<id>` → Reiter „Bericht“.

**Ergebnis nach Schritt 2:**
`expect(locator('[data-testid=continue-link]')).toHaveText("…/#/sessions/<id>")`
schlägt fehl — erhalten `…/#/` (24× stabil über 10 s).
**Häufigkeit:** immer unter `--project=desktop` (3/3, auch sauberer Baum); unter `--project=mobile` grün — timing-/umgebungsabhängig

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Test-Hub, 127.0.0.1) |
| Commit | `019aa5da` |
| Node-Version | v26.13.1 |
| Adapter | opencode |
| Repro-Weg | PWA (E2E) |

## Logs

```text
Error: expect(locator).toHaveText(expected) failed
Locator:  locator('[data-testid=continue-link]')
Expected: "http://127.0.0.1:33299/#/sessions/0a3ca17d-…"
Received: "http://127.0.0.1:33299/#/"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/deeplink.spec.ts:47` | rot (dieser Test) |

Der rote Test existiert bereits — eine neue Testdatei ist nicht nötig.

## Eingrenzung

`ContinueCard` las `location.href`. Am Desktop (`wide`) schreibt
`contentHash` für Tabs ohne rekonstruierbare Route (u. a. „Bericht“) `#/` in
die Adresszeile — der Continue-Link folgte dem und zeigte Root, während
`continue-open` die Session-ID aus dem Record korrekt trug.

## Fix

`continueSessionLink(sessionId, hostId)` baut den Deep-Link aus
`sessionHash`; `ContinueCard` nimmt `sessionId`/`hostId` statt `location.href`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue [#251](https://github.com/securesight-ai/AncientVoid/issues/251)
- [x] `bugfix`

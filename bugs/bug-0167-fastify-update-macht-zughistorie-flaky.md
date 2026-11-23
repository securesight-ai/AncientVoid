---
id: BUG-0167
slug: fastify-update-macht-zughistorie-flaky
status: done
severity: S3
area: server
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/5"
epic: ""
created: 2026-11-15
reporter: "Veröffentlichungs-Audit (docs/2026-11-15_public-release-audit.md)"
---

# BUG-0167 — fastify ≥ 5.12.6 macht „ohne Plan, mit Zughistorie“ flaky

## Gesehen

Nach `npm audit fix` (fastify 5.12.5 → 5.12.8, find-my-way 9.9.0 → 9.10.1,
@fastify/static 10.1.5 → 10.1.11) zeigt die PWA im dritten Zug einer Session
gelegentlich „Schätzung ab 5 Läufen (bisher 2)“ statt „Zug hier meist …
(2 gelaufen)“ — die PWA kennt dann weniger als zwei abgeschlossene Zugdauern,
obwohl der Hub zwei Läufe zählt.

## Erwartet

Wie mit fastify 5.12.5: die typische Zugdauer erscheint, sobald zwei Züge
abgeschlossen sind.

## Repro

1. `npm audit fix` auf `main` (oder `overrides.fastify` in `package.json` entfernen, `npm install`).
2. `npx playwright test e2e/specs/progress.spec.ts -g "Zughistorie" --repeat-each=30`

**Ergebnis nach Schritt 2:** 2–3 von 30 rot. Mit fastify 5.12.5: 0 von 104
(main 74/74, Branch mit Pin 30/30).

**Häufigkeit:** manchmal (~7–10 %)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Hub (`e2e/support/hub.ts`) |
| Node-Version | 24.22.3, macOS |
| Adapter | opencode (Fake-Binary) |
| Repro-Weg | Playwright |

## Logs

Playwright: `expect(locator('.run-progress')).toContainText(/Zug hier meist .+ \(2 gelaufen\)/)`
— erhalten: „läuft seit < 1 min · ohne Plan kein Fortschritt messbar · Schätzung ab 5 Läufen (bisher 2)“.

## Testlücke

Kein Unit-/Integrationstest prüft, dass die PWA nach einem Reload mitten im
dritten Zug alle abgeschlossenen Züge aus der Event-Historie kennt.

## Notlösung

Root-`package.json` pinnt `"overrides": { "fastify": "5.12.5" }`. Die dadurch
offene Advisory GHSA-389g-gv7q-r4x8 (Header-Validierung über
`propertyNames`) trifft den Hub nicht: keine Route definiert ein
Header-Schema (`git grep -n "headers:" apps packages`, 15.11.2026). Den Pin
entfernen, sobald die Ursache (vermutlich Antwort-/Event-Reihenfolge der
Historie beim Reload) gefixt ist.

## Repro-Versuch Linux (16.11.2026, Workstation `workstation`)

Mit ungebundenem Stand (fastify 5.12.8, find-my-way 9.10.1,
@fastify/static 10.1.11) auf dem Linux-Arbeitsplatz: **90/90 grün** —
30× `--repeat-each=30` im Direktlauf und 60× `--repeat-each=60
--workers=6` unter Last. Der Flake tritt auf dieser Maschine nicht auf;
er ist offenbar an die macOS-Umgebung des Erstbefunds gebunden (dort
~12 ms je fsync, Endpoint-Scanner). Ein Fix von dieser Maschine aus wäre
Spekulation ohne Repro — root-caused werden muss mit Playwright-Trace
(`--trace on`) auf dem macOS-Host (gpubox) im Repeat-Lauf. Pin bleibt
bis dahin Notlösung; Issue bleibt offen.

## Fix (2026-11-23) — Root cause war der Client, nicht fastify

Die fehlende Regression aus der Testlücke oben ergänzt und damit den Fall
**deterministisch auf Linux (und mit gepinntem 5.12.5!)** reproduziert:
Nach einem Reload mitten im dritten Zug fällt die Anzeige immer auf
„Schätzung ab 5 Läufen (bisher 2)“ zurück. Ursache: Der Client rechnete die
„Zug hier meist (n gelaufen)“-Mediane aus **seinem gekappten Ereignisfenster**
(TAIL_ROWS) — fehlt dort der älteste `session.prompt`, zählt der Zug nicht und
der Median kippt unter 2. Die fastify-Version bestimmte nur über Timing/
Fenstergrenze mit, ob es auffiel — daher der macOS-Flake ohne Reload und die
90/90 auf Linux.

Fix:

- `RunEstimate` (Contract, additiv-optional): `sessionMedianMs`,
  `sessionTurns` — Median/Zahl der eigenen erfolgreichen Züge, unabhängig
  von `MIN_TURNS_FOR_ESTIMATE` (Client-Regel ab 2), Median-Regel wie der
  Client (gerade Anzahl = Mittelwert).
- `TurnMetricStore.estimate()` hängt die Felder an jede Antwort mit
  Session-ID an; `SessionTail` zieht den Server-Median vor den
  Fenster-Median.
- Pin entfernt (`fastify` ^5.12.8, Overrides weg), Dependabot-Ignore weg.
  macOS/gpubox-Nachweis des entpinnten Standes (Repeat-Lauf
  „ohne Plan, mit Zughistorie“, bei Bedarf `--trace on`): **nach P000
  verschoben** (T000.32).

Rot ohne Fix: `e2e/specs/progress.spec.ts` „Zughistorie“-Reload-Schritt
(2 Läufe rot) und Unit `turn-metrics.test.ts` „BUG-0167“ (Felder fehlten).
Grün mit Fix: Unit runs 9/9; „Zughistorie“-E2E 5× sequenziell grün mit
fastify 5.12.8 (9,5–17,9 s je Lauf). Die Kontingent-/Kontextfenster-Fälle
der gleichen Datei flaken nur unter zwei parallelen Playwright-Instanzen —
nachgewiesen auch auf saubinem main ohne diesen Fix (Stash-Vergleich), also
fix-fremd. lint + typecheck grün.

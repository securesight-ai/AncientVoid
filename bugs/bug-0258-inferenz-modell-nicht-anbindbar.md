---
id: BUG-0258
slug: inferenz-modell-nicht-anbindbar
status: open
severity: S2
area: hub
instance: prod
commit: "2a7eab27"
forge: ""
epic: ""
created: 2026-11-22
reporter: Nutzermeldung 22.11.2026 (Modell-Inferenz ist nicht angelegt, obwohl die Grundintegration existiert)
---

# BUG-0258 — Inferenz-Modell nicht manuell anbindbar; keine Möglichkeit, das gebundene Modell zu befragen

## Gesehen

Die Inferenz-Grundintegration existiert (EPIC-P79/ADR-0102: Engine-Tracker,
Token-Tempo-Seite, `inference.engines` in der hub.config.json), aber:

1. Es gibt **keine manuelle Anbindungs-Option** — Engines stehen nur in der
   hub.config.json (`inference`-Abschnitt fehlte am Live-Hub komplett,
   `GET /api/inference/sources` → leere Liste), Änderungen brauchen einen
   Config-Edit plus Neustart.
2. Unser Modell „qwen3.8 halogen flash next"
   (`halogen-qwen3.8-flash-next-uncensored-iq4xs`, evox2 `:8100/v1`) ist
   **nicht angebunden** — kein Weg, Fragen zu stellen; die Inferenz-Seite
   zeigt nur „Keine Engines konfiguriert".

## Erwartet

Settings bieten eine manuelle Anbindung (URL, Modell, Schlüsseldatei —
runtime änderbar); das gebundene Modell ist im Inferenz-Tab sichtbar und
liefert auf Fragen Antworten über den Hub (Proxy wie TTS: eine Policy-Stelle,
Schlüssel nur als Dateireferenz).

## Repro

Live-Hub (`127.0.0.1:7373`, Commit 2a7eab27) + E2E-Harness:

1. `node -e '…hub.db… config'` → kein `inference.*`-Eintrag;
   `hub.config.json` hat keinen `inference`-Abschnitt.
2. PWA → Inferenz: „Keine Engines konfiguriert."
3. `curl -H "Authorization: Bearer $(cat ~/.config/ancientvoid/evox2.key)" \
     http://100.65.133.28:8100/v1/models` → Modell antwortet
   (`halogen-qwen3.8-flash-next-uncensored-iq4xs`, max_model_len 216064) —
   der Dienst erreichbar, nur nicht im Hub angebunden.

**Ergebnis nach Schritt 2/3:** Modell verfügbar, Hub bietet keinen Anbindungs- und keinen Frage-Weg.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | prod (127.0.0.1:7373) + E2E-Harness |
| Commit | `2a7eab27` |
| Node-Version | 26.13.1 |
| Adapter | — (REST) |
| Repro-Weg | PWA / curl / hubctl |

## Logs

Keine Fehler — die Funktion existiert nicht (still, daher S2: Kernfunktion
der Inferenz-Seite ohne Weg, sie zu nutzen).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit/Route | `apps/hub/test/modules/inference/inference-model.test.ts` | fehlte |
| E2E | `e2e/specs/inference-tempo.spec.ts` | grün — prüft Engine-Metriken, nicht die Modell-Anbindung |

Ohne Fix rot: die neue Route-Suite (6 Fälle: 501 ungebunden, PUT/GET-Roundtrip
mit echter Probe, ask→chat/completions mit Bearer aus der Datei, 502/leere
Antwort, 400er, null-Löschung). Gemessen rot-dann-grün via `git stash` der
Fix-Dateien.

## Eingrenzung

Fehlende Funktion: kein Settings-Store-Zugriff und keine Frage-Route in
`apps/hub/src/modules/inference/inference.routes.ts`; kein Settings-Abschnitt
in der PWA. Modell/URL/Key verifiziert: evox2 `http://100.65.133.28:8100/v1`,
`~/.config/ancientvoid/evox2.key` (existent, Bearer funktioniert).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen

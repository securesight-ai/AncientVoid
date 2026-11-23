---
id: BUG-0276
slug: ralph-stand-in-kennt-review-prompt-nicht
status: done
severity: S3
area: e2e
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/375"
epic: "EPIC-P54"
created: 2026-11-23
reporter: "Agent (Nightly-Aufarbeitung #104/#101)"
---

# BUG-0276 — der Ralph-Stand-in kennt den Review-Prompt nicht: Menschen-Gate-Meldung bleibt aus

## Gesehen

Die Ralph-Hub-E2E „Ralph-Loop im Start-Formular wählen, Grind läuft bis zum
Menschen-Gate wartend (AC-P54-1)“ läuft seit b50faeff auf das 30-s-Poll-
Timeout: `loop.notify` mit `status: "wartend"` kommt nie. Der Loop erreicht
„2 von 2 Aufgaben“, startet die Agent-Review-Session (ADR-0113) — und der
Stand-in `e2e/support/ralph-agent.mjs` versteht den Review-Prompt nicht
(`Review-State-Datei (Wahrheit über diesen Review)`, sein Regex sucht
`Wahrheit über Fortschritt`), beendet sich mit Exit 2 und schreibt die
Review-State-Datei nie. Der Arbeitslauf pollt die Review-Datei endlos.

## Erwartet

Der Stand-in bedient beide Rollen des Loops: Arbeitsturns (Aufgabe → done,
alle → wartend) und den Review-Turn (deterministisches Fazit → status
wartend), sodass `loop.notify` „Gate grün, Agent-Review grün — wartet auf
Abnahme“ emittiert wird — wie die Unit-Tests des Loops mit ihrem Fake-Agenten
(`packages/loops/ralph-hub/test/ralph-hub.test.ts`) es vorführen.

## Repro

`npx playwright test e2e/specs/ralph-hub.spec.ts:15 --project=mobile` — rot
auf main ohne Fix (Nightly 45169662498 beide Versuche, lokal 2 Läufe).
Screenshot: Loop-Panel „2 von 2 Aufgaben“, keine wartend-Meldung.

**Häufigkeit:** immer

## Eingrenzung

`e2e/support/ralph-agent.mjs` — nur der Arbeits-Prompt implementiert. Der
Review-Prompt existiert seit b50faeff (BUG-0259/ADR-0113); der PR-verify
läuft keine E2E, der Nightly lief als erster drauf.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/ralph-hub.spec.ts` „AC-P54-1“ | rot (4 Läufe: Nightly ×2, lokal ×2) |

## Fix (2026-11-23)

Stand-in kennt den Review-Prompt: Review-State-Datei lesen, `status:
"wartend"` + deterministisches Fazit in `notes` schreiben. E2E 2/2 grün
(AC-P54-1 und AC-P54-3), lint grün.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`

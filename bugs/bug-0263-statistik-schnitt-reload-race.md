---
id: BUG-0263
slug: statistik-schnitt-reload-race
status: fixed
severity: S3
area: pwa
instance: dev
commit: "530c6e2b"
forge: "https://github.com/securesight-ai/AncientVoid/issues/319"   # GitHub-Issue- oder PR-URL
epic: ""
created: 2026-11-23
reporter: "E2E T66.3 (mobile), solide rot seit Merge e046e54d (PR #298); davor flaky"
---

# BUG-0263 — Projekt-Schnitt überlebt ein sofortiges Reload nicht (Effekt-Rennen)

## Gesehen

Projekt-Filter in der Statistik wählen und **sofort** neu laden → der Schnitt ist weg,
der Projekt-Schlüssel steht wieder auf „alle Projekte“. Zeitraum (Woche) überlebt.

## Erwartet

Der Schnitt ist mit der Auswahl festgeschrieben (T66.3/AC-P66-3): auch ein Reload
eine Millisekunde später hält ihn.

## Repro

E2E `statistik.spec.ts` T66.3 (nur Projekt mobile rot; desktop besteht):

1. `#/statistik` öffnen, Zeitraum „Woche“ wählen.
2. Projekt wählen.
3. Sofort neu laden.

**Ergebnis nach Schritt 3:** `getByLabel("Projekt")` hat Wert `""`;
localStorage `ancientvoid.statistik.v1` enthielt bereits vor dem Reload
`"project":""` — der Schreib-Effekt lief nicht mehr.

Instrumentierte Scratch-Messung (mobile, 23.11.): direkt nach `selectOption`
ist `stored.project` noch `""`, erst ~1,5 s später steht der Pfad.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Testhub (process runner) |
| Commit | `530c6e2b` (solide), ab `e046e54d` (PR #298); davor `7dfb0f54` flaky |
| Repro-Weg | Playwright `--project=mobile` |

## Logs

```text
[scratch] direkt nach selectOption: dom=/tmp/.../projects/alpha stored={"period":"7d","project":"",...}
[scratch] nach 1.5s:                 dom=/tmp/.../projects/alpha stored={"period":"7d","project":"/tmp/.../projects/alpha",...}
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/statistik.spec.ts` T66.3 (mobile) | rot (solide seit e046e54d) |

## Eingrenzung

Zwei verzahnte Rennen in `apps/pwa/src/features/statistics/StatisticsPage.tsx`:

1. `writeState` hing an einem passiven `useEffect` — gewinnt ein sofortiges
   Reload die Race (Assertion wird am schon gerenderten Bericht sofort grün),
   war die letzte Auswahl nie gespeichert (Scratch-Messung: `stored.project`
   direkt nach der Auswahl noch `""`).
2. Der Filter-Effect tat `setReport(null)` — bei jedem Schnittwechsel nahm das
   `if (!report)` die ganze Seite vom Baum (Loading-Flackern). Im Remount
   traf die Auswahl veraltete Option-Knoten: das `change`-Event feuerte mit
   `value:""` (Capture-Sonde am document), Auswahl weg. PR #298 hat das
   Timing verschärft und aus dem Flake ein solides Rot gemacht.

## Fix

- `changeFilter` schreibt den Schnitt synchron mit der Änderung
  (Zeitraum/Projekt/Host/Harness/Zurücksetzen); der Effect gleicht ab.
- Der Filter-Effect hält den vorigen Report bis zum Eintreffen des neuen —
  kein Unmount/Flackern bei Schnittwechseln mehr.

## Verify

```text
npx playwright test e2e/specs/statistik.spec.ts                          # 9 passed (desktop+mobile)
npx playwright test e2e/specs/statistik.spec.ts -g T66.3 --project=mobile # 5/5 Läufe grün
npx vitest run apps/pwa/test/features/statistics-state.test.ts            # 3 passed
npm run typecheck && npm run lint                                         # ok
```

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt — [#319](https://github.com/securesight-ai/AncientVoid/issues/319)
- [x] `bugfix` angewiesen

<!-- CI-Trigger: echter Baumdelta-Push nach stummem Actions-Webhook (PR #320) -->

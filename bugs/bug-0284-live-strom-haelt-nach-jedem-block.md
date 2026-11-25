---
id: BUG-0284
slug: live-strom-haelt-nach-jedem-block
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/403"
epic: "P82"
created: 2026-11-25
reporter: "EPIC-P82 Abschlussprüfung (volle E2E-Suite)"
---

# BUG-0284 — Nach jedem fertigen Block läuft der Chat bis zu 8 s nicht mehr mit

## Gesehen

Der Live-Strom wächst unter den sichtbaren Rand, statt mitzulaufen (Rückfall von BUG-0207/0208 seit `ddb72f68`).

## Erwartet

Nur ein Sprung zu einer Suchfundstelle hält die Ansicht. Das Einrücken nach einem fertigen Strom hält und markiert nichts.

## Repro

Auf `09eb3eec`: `npx playwright test e2e/specs/live-streaming.spec.ts` — drei Fälle immer rot, lokal und im Nightly 45512916766.

## Tests

`e2e/specs/live-streaming.spec.ts` (`:209`, `:261`, `:309`): vor dem Fix rot, danach grün; Specs mit `/seq/`-Sprung bleiben grün.

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx`: `jumpSeqRef` dient Fundstelle und Strom-Ende, die Haltezeit `jumpHoldUntilRef` galt für beide. `jumpIsHitRef` trennt sie.

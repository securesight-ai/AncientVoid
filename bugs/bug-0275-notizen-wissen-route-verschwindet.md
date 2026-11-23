---
id: BUG-0275
slug: notizen-wissen-route-verschwindet
status: done
severity: S3
area: pwa
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/372"
epic: "EPIC-P74"
created: 2026-11-23
reporter: "Agent (Nightly-Aufarbeitung #104/#101)"
---

# BUG-0275 — `#/notizen/wissen` landet auf der Übersicht: der Wissen-Tab verschwindet nach ~0,5 s

## Gesehen

Nach dem Klick auf den Reiter „Wissen“ im Notizen-Bereich erscheint das Panel
kurz und verschwindet dann: Die Adresse `#/notizen/wissen` wird von
`parseAppHash` nicht mehr erkannt und fällt am Ende auf
`{ view: "list", page: "dashboard" }` zurück — die gerenderte Seite wechselt
auf die Übersicht, obwohl der Hash stehen bleibt. Beide Wissen-Tab-E2E-Tests
(„zwei Quellen: Fusion-Suche …“ und „Offline: gespeicherter Stand …“) laufen
seit 1ce6cf1f auf das 45-s-Timeout (`selectOption` — „element was detached
from the DOM“), Nightly 45169662498 (23.11.2026) beide Versuche rot.

## Erwartet

`#/notizen/wissen` öffnet die Notizen-Seite mit dem Wissen-Reiter
(`vaultTab: "wissen"`), wie mit bfc75cb8 gebaut und getestet.

## Repro

1. `npx playwright test e2e/specs/knowledge-sources.spec.ts --project=mobile`
   — auf main ohne Fix: beide Wissen-Tab-Tests rot (Element detached).
2. Diagnose-Probe (MutationObserver): Panel-Node wird nach ~0,5 s aus dem DOM
   entfernt, Hash bleibt `#/notizen/wissen`, `.vault-tabs` komplett weg.

**Häufigkeit:** immer

## Eingrenzung

`apps/pwa/src/app/route.ts` — `parseAppHash`: 1ce6cf1f (BUG-0257,
Analyse-Seite mit Reitern, 22.11.) ersetzte den
`#/notizen/wissen`-Zweig durch die `#/statistik/<tab>`-Zweige und ließ den
Wissen-Zweig weg. Regression per Teil-Rewrite; der Slug-Regex
`/^#\/([a-z]*)\/?$/` passt nicht auf Pfad-Segmente, also fällt der Hash
durch bis zum `dashboard`-Fallback.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/app/route.test.ts` „Wissen-Tab-Route (BUG-0275)“ | rot (`page: "dashboard"`) |
| E2E | `e2e/specs/knowledge-sources.spec.ts` beide Wissen-Tab-Tests | rot seit 1ce6cf1f |

## Fix (2026-11-23)

Zweig in `parseAppHash` wiederhergestellt (vor Vault-Datei- und Slug-Match),
kommentiert mit dem Verlust-Hinweis. Unit 18/18 grün, knowledge-sources-E2E
3/3 grün, lint + typecheck grün.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`

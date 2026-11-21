---
id: BUG-0250
slug: e2e-anker-chip-statusfilter-verwaist
status: open
severity: S3
area: pwa
instance: dev
commit: "019aa5da"
forge: "https://github.com/securesight-ai/AncientVoid/issues/252"
epic: ""
created: 2026-11-21
reporter: agent
---

# BUG-0250 — E2E-Anker `.chip.status-filter` verwaist nach Baustein-Migration

## Gesehen

Der Test „Host-Karte filtert die Session-Ansicht, Chip löst den Filter"
(`e2e/specs/overview-shell.spec.ts:121`) ist rot: Der Host-Filter-Chip wird
gerendert und funktioniert, aber der Locator `.chip.status-filter` findet ihn
nicht — der `Chip`-Baustein setzt `ui-chip`, nicht mehr `chip`, als Klasse.

## Erwartet

Die Statusfilter-Chips (Host-Filter, „nur wartende/aktive") bleiben über die
Baustein-Migration hinweg testbar; der Anker matcht das gerenderte Element.

## Repro

Voraussetzung: lokales Repo, Playwright-Chromium.

1. `npx playwright test e2e/specs/overview-shell.spec.ts --project=mobile --grep "Host-Karte"`

**Ergebnis nach Schritt 1:** rot — `locator('.chip.status-filter')` not found,
obwohl der Button „Host: omarchy ✕" sichtbar ist (A11y-Snapshot).

**Häufigkeit:** immer (auch auf sauberem Baum ohne lokale Änderungen, Commit
`019aa5da`)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Test-Hub) |
| Commit | `019aa5da` |
| Node-Version | v26.13.1 |
| Adapter | dummy |
| Repro-Weg | PWA (E2E) |

## Logs

```text
Error: expect(locator).toBeVisible() failed
Locator:  locator('.chip.status-filter').filter({ hasText: 'Host' })
Expected: visible, Timeout: 10000s
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/overview-shell.spec.ts:126` | rot (dieser Test) |

## Eingrenzung

`apps/pwa/src/shared/ui/Chip.tsx:20` — Klassenliste `ui-chip … active …`
seit der Baustein-Migration (EPIC-P63 T63.9, d70e9c8b). Betroffene Anker:
`.chip.status-filter` in `e2e/specs/overview-shell.spec.ts:126,358-Umfeld`
sowie der Statusfilter-Chip in `Dashboard.tsx` („nur wartende/aktive", selbe
Klasse). Nach T63.6-Regel („Anker werden data-testid") sollte der Fix den
Baustein-Anker über `data-testid` führen, nicht die alte Klasse reanimieren.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen

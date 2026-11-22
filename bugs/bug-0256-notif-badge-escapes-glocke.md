---
id: BUG-0256
slug: notif-badge-escapes-glocke
status: open
severity: S3
area: pwa
instance: dev
commit: "2a7eab27"
forge: ""
epic: ""
created: 2026-11-22
reporter: Nutzermeldung 22.11.2026 (Tablet: Badge-Zahl der Glocke unlesbar, hängt aus dem Bild)
---

# BUG-0256 — Badge-Zahl der Glocke hängt 227 px über der Glocke above dem Viewport-Rand

## Gesehen

Am Tablet (split, Glocke als Flusselement im Listenkopf) schwebt die rote
Zahl der ungelesenen Benachrichtigungen weit über der Glocke am oberen
Bildschirmrand und ist zur Hälfte abgeschnitten — nicht an der Glocke, wo
sie hingehört.

## Erwartet

Die Zahl sitzt **an der Glocke** (linker Rand, vollständig lesbar) und ist
vollständig im Viewport.

## Repro

E2E-Hub des Harness + PWA, Viewport 800×1280 (Tablet, Glocke im Flow-Modus
`.notif-bell.flow`). Ungelesene erzeugen (`createSession` mit
`Bitte KONTINGENT` → provider-error-Notification), dann Geometrie messen:

1. `createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" })`.
2. `.notif-bell` und `.notif-count` per `getBoundingClientRect()` lesen.

**Ergebnis (gemessen, vorher):**

| Element | x | y | Breite |
|---|---|---|---|
| `.notif-bell` (flow) | 227,5 | **222,8** | 44 |
| `.notif-count` („1“) | 257,6 | **−4** | 16 |

Die Zahl liegt 227 px über der Glocke und 4 px **über** der Viewport-Kante
(`top: −4`) — oben abgeschnitten, optisch „irgendwo am Bildschirmrand“.

**Häufigkeit:** immer (Tablet/PC mit sichtbarer Liste, flow-Glocke)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Harness-Hub, `layout-beweis`-Wegwerf-Spec) |
| Commit | `2a7eab27` |
| Node-Version | 26.13.1 |
| Adapter | opencode (Dummy, Magic-Prompt KONTINGENT) |
| Repro-Weg | PWA (Playwright, viewport 800×1280) |

## Logs

Keine Konsolenfehler — reines Positionierungs-Problem.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | — | CSS-Positionierung, ohne DOM nicht prüfbar |
| E2E | `e2e/specs/notifications.spec.ts` | grün — prüft Sichtbarkeit/Text, nicht Geometrie der Zahl |

Ohne Fix rot werden muss: eine E2E-Geometrie, die verlangt, dass die Zahl
an der Glocke hängt (`count.top ≥ bell.top − 8`) und vollständig im
Viewport liegt (`count.top ≥ 0`).

## Eingrenzung

`apps/pwa/src/app/styles/14-notifications.css` — `.notif-bell.flow` setzt
`position: static`; `.notif-count` ist `position: absolute; top: -4px` und
verankert damit am nächstgelegenen positionierten Vorfahren, dem sticky
`.topbar` (02-layout.css:140) — nicht an der Glocke.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen

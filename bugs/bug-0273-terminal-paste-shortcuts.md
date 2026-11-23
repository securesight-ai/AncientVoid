---
id: BUG-0273
slug: terminal-paste-shortcuts
status: in-progress
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/347"
epic: ""
created: 2026-11-23
reporter: Nutzer (mündlich, 23.11.2026)
---

# BUG-0273 — Terminal-Tab: Einfügen per Shortcode unmöglich

## Gesehen

Im Terminal-Tab der PWA lässt sich nichts aus der Zwischenablage einfügen:
Strg+V (und Strg+Umschalt+V) kommen nicht als Paste an, Win+V ebenfalls
nicht. Der Nutzer wollte ein Repo klonen und konnte die URL nicht einfügen.

## Erwartet

Strg/Cmd+V (± Umschalt) und Shift+Einfg fügen den Zwischenablagen-Text in
die laufende Shell ein; Kopieren geht per Strg+Umschalt+C / Strg+C mit
Markierung. Strg+C ohne Markierung bleibt SIGINT.

## Repro

Voraussetzung: Hub läuft, Terminal-Tab mit verbundenem lokalem Ziel
(bash). E2E-Repro (Chromium, Clipboard-Rechte gewährt):

1. `navigator.clipboard.writeText("echo paste-42")`
2. Terminal fokussieren, `Control+v`, dann `Enter`.

**Ergebnis:** Ohne Fix erscheint `paste-42` nie — xterm.js frisst Strg+V
als Tastendruck und sendet `^V` (readline quoted-insert) an die Shell; das
native paste-Event wird durch xterms preventDefault nie ausgelöst.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `853dce53` |
| Node-Version | 26.13.1 |
| Adapter | n/a (Terminal-Tab, ADR-0087) |
| Repro-Weg | PWA (E2E `e2e/specs/terminal.spec.ts`) |

## Logs

Keine — Client-seitiges Tastenrouting, keine Hub-Logzeile dazu.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/terminal/terminal-clipboard.test.ts` | nicht vorhanden |
| E2E | `e2e/specs/terminal.spec.ts` „Ctrl+V fügt ein und Enter führt aus“ | nicht vorhanden |

Rot-Beweis: E2E-Test gegen `HEAD` ohne Fix → failed; mit Fix grün.

## Eingrenzung

`apps/pwa/src/features/terminal/TerminalPage.tsx` — kein
`attachCustomKeyEventHandler`; xterm.js verhindert das native paste-Event.

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`

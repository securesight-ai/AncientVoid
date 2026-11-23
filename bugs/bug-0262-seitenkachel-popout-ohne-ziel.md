---
id: BUG-0262
slug: seitenkachel-popout-ohne-ziel
severity: S2
status: fixed
instance: dev
commit: "7dfb0f54"
forge: "https://github.com/securesight-ai/AncientVoid/issues/312"   # GitHub-Issue- oder PR-URL
epic: ""
created: 2026-11-23
reporter: "Jan (Nutzer)"
---

# BUG-0262 — Seiten-Kachel als eigenes Fenster zeigt „Dieses Fenster hat kein Ziel."

## Gesehen

„Notizen in ein eigenes Fenster ziehen" (⧉ der Kachel bzw. der Werkzeugseite)
öffnet ein Fenster, das nur „Dieses Fenster hat kein Ziel." zeigt — und die
Kachel verschwindet aus dem Raster.

## Erwartet

Jede Komponente lässt sich sauber als eigenes Fenster öffnen: die Notizen-
Kachel öffnet die Notizen-Seite im Fenster, die Kachel wechselt dorthin.

## Repro

Voraussetzung: Hub lokal, PWA am PC (≥ 1280 px, split-Layout).

1. Notizen öffnen (`#/notizen`) — die Seite erscheint als Kachel im Raster.
2. ⧉ („Open in own window") der Werkzeugseiten-Kachel klicken.
3. Es öffnet sich `/?window=1#/sessions/`.

**Ergebnis nach Schritt 3:** Fensterinhalt ist ausschließlich die Leerstelle
„This window has no target." / „Dieses Fenster hat kein Ziel."; im Hauptfenster
ist die Kachel abgelöst (`ancientvoid.workspace.detached` wächst um den
Seiten-Ref).

**Häufigkeit:** immer — betrifft jede Seiten-/Werkzeug-Kachel (Notizen,
Einstellungen, Status, Teams, …), nicht nur Notizen.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `7dfb0f54` |
| Node-Version | 26 (mise) |
| Adapter | n/a (PWA-only) |
| Repro-Weg | PWA (Browser, 1600×900) |

## Logs

Live-Repro im frischen Chromium (kein alter Service-Worker), 2026-11-23:

```text
Klick auf .tool-pane-popout der Notizen-Kachel
Popup-URL:  http://127.0.0.1:7373/?window=1#/sessions/
Popup-Text: "This window has no target."
```

`#/sessions/` (leere Session-ID) parst als Dashboard-Liste; `targetFromHash`
liefert deshalb `null` und `PopoutShell` zeigt die Leerstelle.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/windows/tile-target.test.ts` | nicht vorhanden — Lücke: kein Test deckt Kachel→Fenster-Ziel ab |
| E2E | `e2e/specs/windows.spec.ts` (Session-Kachel-Fall grün) | Seiten-Kachel-Fall fehlt |

## Eingrenzung

`apps/pwa/src/app/main.tsx` `popoutTile` (und `RestoreBar.targetOf`,
`apps/pwa/src/features/windows/RestoreBar.tsx:12`): Das Fensterziel wird immer als
`{ kind: "session", sessionId: ref.sessionId }` gebaut; Seiten-Kacheln tragen
`sessionId: ""`. `popoutUrl` erzeugt daraus `#/sessions/`, was keine Route ist.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`) — [#312](https://github.com/securesight-ai/AncientVoid/issues/312)
- [x] `bugfix` angewiesen

---
id: BUG-0271
slug: toast-layout-shift
status: done
severity: S3
area: pwa
instance: local
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/337"
epic: ""
created: 2026-11-23
reporter: nutzer (Handy)
---

# BUG-0271 — Toast-Benachrichtigungen schieben das UI

## Gesehen

Neue In-App-Toasts (Benachrichtigungen) verschieben Split bzw. Topbar statt
darüber zu liegen. Am Desktop mit Fluss-Glocke sitzen die Karten in der
Kopfzeile der Listenspalte und drücken Inhalt weg.

## Erwartet

Toasts als Overlay (`position: fixed`, `--z-toast`) über dem UI, ohne
Layout-Shift; nach kurzer Zeit automatisch weg.

## Repro

1. PWA offen (Desktop mit sichtbarer Liste oder Mobil).
2. Ereignis auslösen, das einen Toast zeigt (z. B. Hub kurz offline/online,
   Fehler, Warnung).
3. Beobachten, ob Split/Topbar nach unten rutscht.

**Ergebnis nach Schritt 3:** Inhalt verschiebt sich um die Toast-Höhe.

**Häufigkeit:** immer, sobald ein Toast sichtbar ist.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `51cf0c44` (vor Fix) |
| Repro-Weg | PWA |

## Ursache (kurz)

`.toast-stack` lag im Flow (Kommentar T8.6/P8 Messlauf). Am Desktop rendert
`NotificationCenter flow` den Stack als Geschwister der Glocke in der Topbar.

## Fix

`position: fixed` + `z-index: var(--z-toast)`; kürzere `TOAST_MS`. Test:
`apps/pwa/test/features/notifications/toast-overlay.test.ts`.

Gemerged als PR [#338](https://github.com/securesight-ai/AncientVoid/pull/338) (e15eef36); Unit 2/2 grün im Session-Worktree nachgestellt.

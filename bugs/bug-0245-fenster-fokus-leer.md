---
id: BUG-0245
slug: fenster-fokus-leer
status: done
severity: S2
area: pwa
instance: dev
commit: "a5aed0f6"
forge: "https://github.com/securesight-ai/AncientVoid/issues/237"
epic: ""
created: 2026-11-20
reporter: silenttz
---

# BUG-0245 — Eigenes Fenster: Duplikat statt Fokus; Schließen hinterlässt Leer-Kacheln

## Gesehen

Ein schon offenes eigenes Fenster wird erneut geöffnet statt fokussiert
(Race vor `hello`, oder Fokus ohne benanntes Browsing-Context). Nach Ablösen
bleibt eine leere Kachel („Kachel N ist frei“); nach Schließen des Fensters
bleiben leere Reste bzw. `detached`-Einträge, statt dass der Platz ganz
verschwindet.

## Erwartet

Bereits offenes Ziel → bestehendes Fenster nach vorn, kein zweites.
Ablösen/Schließen entfernt die Kachel aus dem Raster (kompakt) und räumt
`detached` nach echtem Schließen auf (Reload-Grace bleibt).

## Repro

1. Session in Kachel öffnen, ⧉ → eigenes Fenster.
2. Erneut ⧉ / Liste anklicken: zweites Fenster oder leere Kachel bleibt.
3. Fenster schließen: leere Kachel / Restore-Leiste statt sauberem Weg.

**Häufigkeit:** oft (Race) / immer (leere Kachel nach Ablösen)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `a5aed0f6` |
| Repro-Weg | PWA (Code-Pfad) |

## Logs

```text
openPopout: kein Pending-Lock, window.open(..., "_blank") — windows.ts:88–111
detachTile: Slot null, Layout bleibt — tiles.ts:132–137
bye räumt detached nicht (ADR-0053 §7) — RestoreBar hält Leer-Zustand
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `tiles.test.ts` (detach kompakt) | Lücke |
| Unit | Fenster-Pending / windowName | Lücke |
| E2E | `windows.spec.ts` tile-empty nach Ablösen | erwartet bisher Leer-Kachel |

## Eingrenzung

`apps/pwa/src/features/windows/windows.ts`, `protocol.ts`, `PopoutShell.tsx`,
`tiles.ts`, `app/main.tsx`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt
- [x] `bugfix`

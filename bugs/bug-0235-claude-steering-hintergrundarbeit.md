---
id: BUG-0235
slug: claude-steering-hintergrundarbeit
status: done
severity: S2
area: adapters
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/213"
epic: ""
created: 2026-11-20
reporter: "Kai (Nutzerreport: claude fährt einen 3,5-h-Hintergrundprozess; in der CLI geht weiterarbeiten, im Hub bleibt die Nachricht vorgemerkt)"
---

# BUG-0235 — claude nimmt während des laufenden Zugs keine Nachricht an: Vorgemerktes bleibt über die ganze Hintergrundarbeit hin liegen

## Gesehen

claude läuft in einer Hub-Session und hat einen Hintergrundprozess gestartet
(~3,5 h). Eine weitere Nachricht wird vorgemerkt; „Jetzt senden“ (➤ an der
vorgemerkten Nachricht) wird abgelehnt mit:

```text
Dieser Adapter kann während des laufenden Zugs keine weitere Nachricht annehmen. Die Nachricht bleibt vorgemerkt.
```

In derselben Situation ist die claude-CLI selbst bedienbar: Getipptes geht
als Zwischenruf in den laufenden Zug bzw. als nächster Zug durch, während
die Hintergrundarbeit weiterläuft.

## Erwartet

Der claude-Adapter nimmt Eingaben während des laufenden Zugs an und injiziert
sie über den Streaming-Input-Kanal des CLI (`--input-format stream-json`) —
ohne zweiten Prozess auf dieselbe native Session (ADR-0074 bleibt heil).

## Repro

Voraussetzung: Hub läuft, Adapter `claude`, echte CLI-Anmeldung.

1. Session starten mit einem Prompt, der einen Hintergrundbefehl startet
   (z. B. „starte `sleep 300` als Hintergrundprozess und warte“).
2. Während der Zug läuft: Nachricht senden → wird vorgemerkt.
3. ➤ „Jetzt senden“ auf der vorgemerkten Nachricht → 422 mit der Meldung oben.

**Ergebnis nach Schritt 3:** Ablehnung durch den Hub, Nachricht bleibt bis
zum Ende der Hintergrundarbeit vorgemerkt.

**Häufigkeit:** immer (strukturell — kein Eingabekanal vorhanden).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | (Fix-PR) |
| Node-Version | 22+ |
| Adapter | claude (CLI 2.1.329) |
| Repro-Weg | PWA |

## Ursache

Der Adapter fährt One-Shot-Print-Mode: `claude -p "<prompt>"` mit dem Prompt
im **Argv**, stdin ungenutzt (`packages/adapters/claude/src/index.ts`,
`buildArgs`). Einen laufenden Prozess zu steuern ist so unmöglich; ein
zweiter `--resume`-Prozess wäre der ADR-0074-Verstoß (zwei Schreiber auf
eine native Session). Der Hub lehnt deshalb korrekt ab
(`session-manager.ts:3442`, `sendQueuedNow`) und die Queue wartet auf
`idle` (`drainSlot`, `session-manager.ts:3399`) — das aber erst zum Ende der
Hintergrundarbeit, weil `claude -p` offenes Background-Work abwartet
(dokumentiertes CLI-Verhalten „Background tasks at exit“).

Die CLI selbst kann es, weil ihr Eingabekanal (stdin des persistenten
Prozesses) offen bleibt; headless existiert derselbe Kanal als
`--input-format stream-json` (Agent-SDK: „Send messages to a running agent“
— Zwischenrufe erreichen Claude nach dem laufenden Tool-Call).

**Zweitfund bei der Umstellung (E2E):** Der promptlose claude-Start (Session
ohne Startprompt) spawnt unter dem Streaming-Modus nichts mehr — der Hub
markierte ihn aber als `working`, und ohne Zug-Prozess kann dieser Zustand
nie settle'n. Fix: neue Capability `promptlessStartIdle` (ADR-0098 Nachtrag);
der Hub öffnet solche Sessions direkt `idle`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/claude/test/adapter.test.ts` | grün (beschreibt One-Shot-Verhalten) |

Ohne Fix rot sein müssen: `adapter.test.ts` — „steer(prompt) schreibt in den
laufenden Prozess (stdin), kein Zweitprozess“, „result → ctx.turn(idle)“,
„capabilities: midTurnInput“; Core: `session-manager.test.ts` —
„promptloser Start eines promptlessStartIdle-Adapters öffnet idle“.

## Eingrenzung

`packages/adapters/claude/src/index.ts` — `buildArgs` (Prompt via Argv),
`start()`/`steer()` (spawn pro Zug), `capabilities()` (kein `midTurnInput`).
Core: `session-manager.ts` `launchAdapter`/`create` (promptlos → working).
PWA unverändert: `midTurnInput` existiert seit ADR-0085 und wird
von `sendPrompt`/`sendQueuedNow`/Queue-Drain und dem ⚡-Chip bereits
ausgewertet.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` (Fix: ADR-0098, Streaming-Input-Prozess)

## Verifikation

`adapter.test.ts`, `session-manager.test.ts` und `pause-queue.spec.ts`
prüfen den Streaming-Kanal, die Zustellung nach dem Hauptzug und die
weiterlaufende Hintergrundaktivität. Der Browser nutzt einen lokalen
Claude-Stand-in.

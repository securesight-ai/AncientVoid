# ADR-0110 — Ralph im Hub: hub-getriebener Goal-Gate-Loop für jede Agenten-CLI

**Status:** akzeptiert (Nutzerauftrag 22.11.2026: „Ralph-Loop nicht nur mit Hermes, sondern mit allem anderen auch") · **Betrifft:** EPIC-P54,
`packages/loops/ralph-hub` (neu), ADR-0038 (`agents: "hub"` Entsperrung),
EPIC-P19 Premortem #7 („Ralph im Hub" war reserviert)

## Kontext

Ralph ist die Goal-Gate-Arbeitsweise: ein autonomer Grind über die Aufgaben
eines Ziels (Epic/Bug), der jede Aufgabe deterministisch verifiziert und erst
bei grünen Gates `wartend` meldet — Abnahme bleibt Mensch-Gate. Bislang gab es
genau einen Weg: den Hermes-Ralph-Runner lokal betreiben und über den
Beobachter-Connector `ralph` (ADR-0038, PR #280) in den Hub spiegeln. Der
Nutzer will Ralph mit **jedem** Adapter/LLM nutzen — auch ohne Hermes.

Randbedingungen: `LoopCapabilities.agents: "hub"` war seit ADR-0038 reserviert
(EPIC-P19 hielt „Ralph im Hub" bewusst out); Loops sehen nur `AdapterContext`;
`loops.start` ist Menschen-only (Policy); K5 (keine großen Payloads in Events);
K7 (Zustand rekonstruierbar); Prompt-Injection-Grenze (PRD §8.5); die
geteilte Box/der Rechner darf nicht endlos spawnen.

## Entscheidung

1. **Entsperrung von `agents: "hub"` mit fester Rollenverteilung.** Ein
   hub-getriebener Loop-Connector darf Agenten **ausschließlich** über
   `ctx.spawnWorker` im Workdir seiner eigenen Loop-Session starten — keine
   Kind-Sessions, kein Zugriff auf Hub-Internas, keine zweiten
   Steuerungsinstanzen (P40-Regel bleibt: eine Lifecycle-Autorität pro Lauf).
2. **Die CLI ist der Agent, der Hub nur die Schleife.** Der Nutzer bringt den
   Agenten-Befehl mit (Option `command`, Prompt als `{prompt}`-Platzhalter
   oder letztes Argument): `claude -p {prompt}`, `codex exec {prompt}`,
   `pi {prompt}` … Damit wählt er Adapter UND LLM frei; der Hub fügt keine
   eigene Runtime hinzu.
3. **State-Datei bleibt die Wahrheit (Ralph-Protokoll wie beim Hermes-Runner).**
   Der Connector sät `<workdir>/.ralph/<target>-state.json` aus der
   Epic-Datei (Deploy-Regel: State VOR erstem Turn), der Agent pflegt sie,
   `wartend|blocked|stopped` beendet die Schleife. Pause stoppt neue Turns,
   nicht die Sichtbarkeit.
4. **Budget und Lautstärke:** `maxTurns` (Startformular/Config) plus
   `turnTimeoutMs` pro Turn; Überschreitung ist ein sichtbares Level-2-Event,
   nie ein stiller Loop. Events bleiben kompakte `loop.*`-Meldungen (K5);
   CLI-Ausgabe nur gekürzt im Event, voll als Blob.
5. **Grenzen der Autonomie:** Der Ralph-Prompt erzwingt Branch
   `ralph/<target>`, kein Commit auf `main`, kein Push/Merge ohne Anweisung;
   erzwungen wird darüber hinaus durch die Repo-Gates selbst
   (Branch-Protection, commit-msg-Hook). Der vorzulesende CLI-Output bleibt
   Daten (PRD §8.5).

## Alternativen

- **Nur weiter den Hermes-Beobachter ausbauen:** lässt Ralph an Hermes
  gebunden — widerspricht dem Auftrag. Verworfen.
- **Ralph als Skill/Prompt in normale Adapter-Sessions:** keine Schleife, kein
  Budget, kein Menschen-Gate — der Grind stirbt mit dem Zug. Verworfen.
- **Hub treibt Kind-Sessions (SessionManager pro Turn):** zweite
  Steuerungsschicht, bricht die P19/P40-Lifecycle-Regel. Verworfen.

## Folgen

- `packages/loops/ralph-hub` (`@ancientvoid/loop-ralph-hub`) ist der erste
  `agents: "hub"`-Connector; ADR-0038s Reservierung gilt als durch diesen ADR
  ersetzt (nachgetragen).
- Jede promptbare CLI ist ralph-fähig; unpassende Befehle scheitern laut im
  ersten Turn (loop.broken), nicht still.
- Der Beobachter `ralph` (Hermes) bleibt unberührt — zwei Wege, ein Protokoll.
- Menschen-Abnahme (echter Grind mit echtem LLM) läuft über EPIC-P000.

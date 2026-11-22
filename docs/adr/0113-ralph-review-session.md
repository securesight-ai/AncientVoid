# ADR-0113 — Ralph-Agent-Review in eigener, automatisch gestarteter Loop-Session

**Status:** akzeptiert (Nutzerauftrag 22.11.2026: Ralph soll „per deterministischen Endchecks plus Agent-Review in einer automatisch gestarteten Session — im UI als neue Session sichtbar — verifizieren") · **Betrifft:** ADR-0110 (Ralph im Hub),
`packages/contracts` (`LoopIo`), `packages/core` (loop-adapter), `apps/hub`
(main-Wiring), `packages/loops/ralph-hub`

## Kontext

ADR-0110 gab Ralph im Hub feste Grenzen: Der Connector treibt Agenten
ausschließlich über `ctx.spawnWorker` in der Workdir-Gruppe **seiner eigenen**
Loop-Session — keine Kind-Sessions, eine Lifecycle-Autorität pro Lauf. Der
Nutzer will zusätzlich einen Agent-Review als Abschluss eines Ralph-Laufs:
deterministische Endchecks plus ein prüfender Agenten-Lauf, der als **eigene
Session in der PWA sichtbar** ist.

## Entscheidung

1. **`LoopIo.startSession?` (optional, neu).** Ein Connector darf beim Erreichen
   eines Gates eine weitere Loop-Session *seines eigenen* Connectors anfordern —
   implementiert nur von der Hub-Seite (`loopAsAdapter` reicht einen von
   `main.ts` bereitgestellten Starter durch, der den `SessionManager` mit dem
   internen Adapter `loop:<id>` und `LOOP_ARG` aufruft). Ohne Starter fällt der
   Connector auf das alte Verhalten zurück (kein Pflichtvertrag).
2. **Review ist Teil des einmal gestarteten, menschlich autorisierten Laufs.**
   `loops.start` bleibt Menschen-only für HTTP (AC-P19-8): Policy bewertet
   HTTP-Routen; der interne Start trägt den Actor `loop-review` und erzeugt
   eine normale, sichtbare Session — laut, nie versteckt.
3. **Eine Lifecycle-Autorität bleibt pro Lauf.** Die Review-Session erhält eine
   eigene Rolle (`role: "review"`), eigene State-Datei
   (`.ralph/<target>-review-state.json`), eigenes Turn-Budget — sie steuert
   nichts, sie prüft. Der Eltern-Lauf wartet auf deren `wartend|blocked|stopped`
   und meldet das Ergebnis als `loop.review`-Event (K5-kompakt).
4. **Keine Aufweichung der Injection-Grenze:** Review-Prompt und -Ausgabe
   bleiben Daten (PRD §8.5); die Review-Session liest dieselbe State-Wahrheit
   und denselben Befehl (`command`) wie der Eltern-Lauf — Adapter/LLM-Wahl
   bleibt die des Nutzers, der Ralph gestartet hat.
5. **Genau ein Ralph-Loop:** In der Konfiguration ersetzt `ralph-hub` den
   Hermes-Beobachter `ralph` (Beobachter bleibt als Paket vorhanden, wird aber
   nicht mehr registriert — zwei Frontends für ein Protokoll verwässern die
   eine Wahrheit über den Lauf).

## Alternativen

- **Review als zusätzlicher spawnWorker-Turn im Eltern-Lauf:** verletzt keine
  Grenze, ist aber nicht als eigene Session sichtbar — widerspricht dem
  Auftrag. Verworfen.
- **Review über HTTP self-start des Connectors:** würde die Menschen-only-
  Policy für `loops.start` aushöhlen. Verworfen.
- **Beobachter `ralph` zusätzlich registriert lassen:** zwei Ralph-Loops im
  Startformular — genau das, was der Auftrag ausschließt. Verworfen.

## Folgen

- `LoopIo.startSession?` ist eine optionale Vertragserweiterung; bestehende
  Connector bleiben kompatibel (ADR-0020-Grenzen unberührt: der Connector sieht
  weiterhin keine Hub-Internas, nur die von der Loop-Schicht gestellte Funktion).
- K7: Review-Session ist eine normale Session (JSONL + Snapshot); ihre
  State-Datei folgt dem Ralph-Protokoll und ist rekonstruierbar.
- K5: `loop.review`-Events bleiben kompakt; CLI-Ausgabe der Review landet als
  Blob.

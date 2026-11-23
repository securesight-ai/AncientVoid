# ADR-0114: `midTurnInput` verbietet eine zweite Lauf-Prozess auf dieselbe native Session

Status: akzeptiert (2026-11-23). **Korrigiert ADR-0085** (Zusicherung von Pi) und
stützt ADR-0074. Referenz: BUG-0261.

## Kontext

ADR-0085 führte `AdapterCapabilities.midTurnInput` ein und gab Pi `true` mit der
Begründung: „Pi's steer ist ein eigener Lauf (kein zweiter Prozess auf dieselbe
native Session)". Diese Begründung ist **falsch**. `steer(prompt)` im Pi-Adapter
baut `pi -p --mode json --session <dieselbe Datei>` (bei Adoption) bzw.
`--continue` (danach) und startet damit einen **eigenen Prozess auf dieselbe
native Sitzung**.

Gemessen 2026-11-23, Sitzung `943797b3-a698-454d-a096-4e42fdab782a`:

    07:39:35Z  node … pi-launcher.js -p --mode json --session …01a203bb…
    07:52:56Z  node … pi-launcher.js -p --mode json --session …01a203bb…   (derselbe Pfad)
    07:59:15Z  node … pi-launcher.js -p --mode json --session …01a203bb…   (derselbe Pfad)

Drei Läufe, eine Transkriptdatei, ein Arbeitsverzeichnis. Folgen, alle belegt:

- Zwei Agenten schrieben gleichzeitig an `watchface-vice/` (Datei-Mtime
  08:07:50 während eines fremden Laufs) und überschrieben sich gegenseitig.
- Der Hub führte einen der Prozesse als *die* Adapter-Verbindung; als ein
  anderer beendet wurde, meldete er `session.turn_end reason:"error"` und
  `adapter.down` (Events 4523/4524, 07:12:55.605Z) — die Akte zeigte
  „Zug fehlgeschlagen" für Arbeit, die in einem anderen Prozess erfolgreich war.
- Danach liefen Events eines noch lebenden Laufs gegen ein bereits gestopptes
  Handle: Hub-Log „adapter event after stop dropped" bis 07:14:17Z, die
  Assistant-Antwort dieses Laufs wurde verworfen und erreichte das Handy nie.

ADR-0074 verbietet einen zweiten Prozess auf dieselbe native Session für
Claude & Co. ausdrücklich. Pi hatte die Erlaubnis nur durch eine falsche
Capability-Angabe.

## Entscheidung

1. **Pi nimmt `midTurnInput` zurück** (`packages/adapters/pi/src/index.ts`:
   `midTurnInput: false`). Lenken heißt bei Pi: **im nächsten Zug**. Die
   Zustellwahl „jetzt senden" (ADR-0085) bleibt für Adapter, die Eingaben
   tatsächlich in einen **laufenden Prozess** lenken (`promptDelivery: "live"`).
2. **Der Adapter verweigert selbst den zweiten Lauf.** `steer(prompt)` mit noch
   laufendem Worker für diese Sitzung antwortet `{ ok: false, detail: „ein
   pi-Lauf läuft bereits — Meldung bitte vormerken" }` und spawn **nicht**.
   Diese Grenze sitzt im Adapter, weil sie auch direkte Aufrufe (hubctl,
   Schlaufen, Wiederaufnahme) erfasst — nicht nur den Weg über `steerNow`.
3. **Contract-Regel für künftige Adapter (Leitlinie, nicht erzwungen):**
   `midTurnInput: true` ist nur glaubwürdig zusammen mit
   `promptDelivery: "live"`. Wer Prompts als eigenen Prozess zustellt
   (`"next-turn"`), darf Mid-Turn-Eingabe nicht zusichern. Eine harte Prüfung
   im Contract ist bewusst **nicht** eingeführt worden: sie hätte drei Adapter
   ohne Messlage umgestellt. Die Regel steht hier und in
   `docs/guide/adapter-capabilities.md`-Nähe der Capabilities-Doku; bei einem
   zweiten Fall wird sie hart.

## Konsequenzen

- Der Hub merkt Pi-Prompts, die während eines laufenden Zug eintreffen, **immer**
  vor — auch wenn das Handy „jetzt senden" wählt. Das ist die gewünschte
  Single-Writer-Eigenschaft: pro Sitzung genau ein Zug.
- Ein absichtliches Stoppen eines Läufe soll über die Hub-Route
  (`POST /api/sessions/:id/stop`, `hubctl stop`) laufen, nicht über
  Prozess-Keule: der Hub bucht ein Stop dann als Absicht statt als
  `turn_failed` mit `reason:"error"`.

## Verifikation

`packages/adapters/pi/test/keine-parallelen-laeufe.test.ts`:
(1) Capabilities sichern Mid-Turn-Eingabe nicht mehr zu; (2) ein Prompt während
eines laufenden Zug wird abgelehnt und erzeugt **keinen** zweiten Spawn
(`spawned.length === 1`); (3) nach beendetem Zug ist Lenken wieder normal
möglich. Rot zuerst (3/3 fehlgeschlagen), nach dem Fix grün. Der
Fork-Test in `adoption.test.ts` endet jetzt sauber zwischen den Zügen —
genau so ruft der Hub den Adapter an.

## Nachtrag (2026-11-23, PR #357): der Mechanismus ohne Zweitprozess ist da

Die Leitlinie dieses ADR bleibt unverändert — `midTurnInput: true` nur mit
`promptDelivery: "live"` und **ohne** zweiten Prozess auf dieselbe native Session.
Pi erfüllt beides jetzt über `pi --mode rpc` (ADR-0116): ein Prozess pro Sitzung,
Eingaben als JSONL auf stdin, `steer`/`follow_up`/`abort` als Frames. Damit ist
`midTurnInput: true` für pi zulässig, solange `adapters.pi.config.mode = "rpc"`
gesetzt ist; mit `mode: "oneshot"` (Standard) gilt weiter die alte Zurückhaltung.

Drei Regeln, die der RPC-Weg einhalten muss (Tests in
`packages/adapters/pi/test/rpc-adapter.test.ts` und
`keine-parallelen-laeufe.test.ts`):

1. Ein Zug, ein Prozess: Lenken schreibt in den laufenden Prozess, es spawnet nie.
2. Zugrahmen meldet der Adapter (`ctx.turn`) — ein persistenter Prozess endet nicht
   pro Zug, `turn_end` an der Prozess-Keule wäre falsch.
3. Nach einem Hub-Neustart wird der überlebende Prozess als RPC-Prozess
   übernommen, nicht an den One-Shot-Parser gehängt.

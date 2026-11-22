# Loops / Dark Factory (EPIC-P19, ADR-0038)

**Art:** how-to

Beim Start einer Session lässt sich ein **Loop** wählen (Zeile „Loop“ im Start-Formular, PWA).
Ein Loop ist ein eigenständiges System, das seine Agenten selbst ausführt; der Hub zeigt, beantwortet Fragen und steuert.

## So hängt es zusammen

```text
Start-Formular ──POST /api/sessions {loop}──▶ Hub ──▶ Session mit Adapter "loop:<id>"
                                               │         (loopAsAdapter, Snapshot für K7)
                                               ▼
                                     LoopConnector (packages/loops/<name>)
                                               ▼
                                  Loop-System (MQTT-Broker bzw. Dateien/CLI)
```

- Der **Connector** sieht nur `@ancientvoid/contracts` (`check:arch`-Regel `loops-only-contracts`).
- Die Session trägt den internen Adapter `loop:<id>`; EventStore, Recovery, Freigaben, Push und PWA laufen unverändert.
  Die Adapter-Liste (`/api/adapters`) führt diese Shims nicht; sie stehen in `GET /api/loops`.
- Die Auswahl des Start-Formulars steht als `args.loop` im Event `session.created`.
- **Ohne Worktree:** ein Loop arbeitet im Projekt des Loop-Systems selbst.
- **Steuern über den normalen Weg:** Pause/Fortsetzen = `park`/`resume`, Betriebsart = „Modus“ (`configure`), „nächste Aufgabe“ = Prompt.
- **Wiederanlauf (K7):** je Session liegt `data/loops/<sessionId>.json` (Startvorgabe + Leseposition). Nach einem Hub-Neustart
  liest der Connector ab dort weiter — nichts doppelt, nichts fehlt.
- **Ereignisse:** `system`-Events mit `payload.kind` = `loop.info | loop.state | loop.progress | loop.gate | loop.stats | loop.report |
  loop.broken | loop.command | loop.notify`. Inhalte, die der Loop als Agenten-Output liefert, erscheinen als normale Chat-Events.
- **Fragen** des Loops kommen als Freigaben (`AskUserQuestion` bzw. Tool-Freigabe) in die vorhandene Ansicht; Antwort nur einmalig
  `allow`/`deny` bzw. Auswahl, nie „immer erlauben“.

## Einrichten (`hub.config.json`)

```json
"loops": [
  { "id": "aspark-factory", "module": "@ancientvoid/loop-aspark-factory", "config": {
      "url": "mqtt://127.0.0.1:1883", "username": "leitstand",
      "passwordEnvFile": "~/.aspark-factory/factory.env", "passwordKey": "MQTT_LEITSTAND_PASSWORD",
      "factoryctl": "/pfad/zu/aSPARK-Factory/factoryctl", "factoryHome": "~/.aspark-factory" } },
  { "id": "securesight-factory", "module": "@ancientvoid/loop-securesight-factory", "config": {} }
]
```

Schlüssel nur als Datei (`passwordFile`, oder bei aSPARK ein Schlüssel in `factory.env`), nie als Wert in der Konfiguration. Ein Loop, der nicht lädt, bleibt in der Auswahl
sichtbar, gesperrt, mit dem Grund. Ohne Eintrag steht er als „nicht eingerichtet“ da.

## API

- `GET /api/loops` — Liste mit `available`, `reason` und den Fähigkeiten des Connectors (Betriebsarten, riskante Betriebsarten,
  Orchestratoren, Steuerbefehle, Optionen). Keine Secrets.
- `POST /api/sessions` mit `loop: { id, mode?, orchestrator?, options? }` statt `adapter` — nur für Menschen (Policy `loops.start`);
  ein Agenten-Token bekommt 403, ein nicht angebundener oder unbekannter Loop 422, eine Auswahl außerhalb der Fähigkeiten 422.

## Einen Connector schreiben

`createLoopConnector(config?) => LoopConnector` exportieren (`packages/contracts/src/loops/connector.ts`) und
`runLoopContractTests(createLoopConnector, …)` aus `@ancientvoid/adapter-testkit` grün bekommen. Der Fake-Loop
(`@ancientvoid/adapter-testkit/fake-loop`) ist die Vorlage und läuft in den E2E-Specs.


## Ralph im Hub (`@ancientvoid/loop-ralph-hub`, ADR-0110)

Der hub-getriebene Ralph-Loop treibt **jede promptbare Agenten-CLI** — Adapter
und LLM wählst du über den Befehl, der Hub liefert nur die Schleife:

```json
{ "id": "ralph-hub", "module": "@ancientvoid/loop-ralph-hub", "config": {
    "turnTimeoutMs": 3600000, "maxTurns": 40 } }
```

Start-Optionen: `target` (Epic oder Bug, z. B. `EPIC-P54`), `command`
(Agenten-Befehl mit `{prompt}`-Platzhalter, sonst hängt der Hinten, z. B.
`claude -p {prompt}` oder `codex exec {prompt}`), `maxTurns`. Ablauf: Der
Connector sät `<workdir>/.ralph/<target>-state.json` aus der Epic-Datei,
spawn`t pro Turn einen Agenten mit dem Ralph-Protokoll-Prompt, meldet
Fortschritt/Gates als `loop.*`-Events (Ausgabe gekürzt + Blob, K5) und stoppt
bei `wartend` — Abnahme bleibt deins. Pause stoppt neue Turns; der Hermes-Beobachter
`ralph` (ADR-0038) bleibt davon unberührt der zweite Weg.

## aSPARK-Factory (`@ancientvoid/loop-aspark-factory`)

Der Hub ist ein Leitstand-Client einer Linie (AsyncAPI 0.9.0, alle Nachrichten `v:1`). Pro Session ein MQTT-Client

| Topic | im Hub |
|---|---|
| `agent/<line>/info` | `loop.info` (Betriebsart, Aktivität); `status:offline` (Last Will) = `loop.broken`, Status `down` |
| `…/<session>/state`, `…/progress` | `loop.state`, `loop.progress` (Aufgaben, Phase, Gate policy/review/ci/merge) |
| `agent/<line>/stats`, `…/report` | `loop.stats`, `loop.report` (Bericht über 2 KB als Blob) |
| `…/<session>/ask` | Rückfrage auf dem Handy; Antwort nach `…/answer` (`allow`/`deny`, bei Fragen Indizes + Notizen) |
| `agent/<line>/command` | `pause`, `resume`, `set-mode`, `work` (nur Issue-Nummer); geprüft gegen `commands[]` der Linie |

**Neues Repo anbinden.** Mit `factoryctl` in der Config zeigt die Startauswahl „Linie“ die vorhandenen Linien (`~/.aspark-factory/lines`)
und „Neues Repo anbinden …“. Dort Repo (`owner/name`, GitLab `group/…/name`), Name der Linie (leer = Repo-Name), Art, Betriebsart
(ohne dark) und optional den GitLab-Server angeben und das Repo-Token eintragen. Beim Starten ruft der Hub `factoryctl new …`
(Token über stdin, nie gespeichert oder geloggt) und startet dann die Session auf der neuen Linie; die Linie meldet sich wenige Sekunden später. Einmalig vorher
im Terminal: `./factoryctl setup` (Claude-Token, Broker); fehlt es, nennt der Hub den Befehl. Dasselbe geht ohne Session über
`POST /api/loops/aspark-factory/onboard`.

Grenzen: kein `allow-always` (v1 der Factory); „Nein“ auf eine Frage kennt das Protokoll nicht, die Linie handelt dann
nach ihrem `timeoutAction`. Das Passwort steht nie in der Config, nur `passwordFile`. Tests: echter `mosquitto`
auf Zufallsport (`packages/loops/aspark-factory/test/aspark.test.ts`), übersprungen, wenn er fehlt.

## securesight-Factory (`@ancientvoid/loop-securesight-factory`)

Ein Projekt = ein Loop (Projektwurzel = die gewählte Projektauswahl, sie braucht `scripts/betrieb.py`). Der Hub ruft den Supervisor alle
`pollMs` (Standard 15 s, höchstens 30 s) und liest Dateien live (fs.watch, sonst alle 2 s) und **schreibt nichts**; der Supervisor darf nur lesen und eskalieren, `notify-ack` und Fortsetzen
macht die Person im Projekt.

| Quelle | im Hub |
|---|---|
| `betrieb.py supervisor-status --json` | `loop.info` (Betriebsart, Iteration, Watchdog), Prüfungen als Gate `gates`; Exit 3 = `loop.hold` (Status degraded), Exit 4 = Watchdog ausgefallen, 5/Schemafehler = `loop.broken` |
| `.harness/notify/*.json` | `loop.notify` (Stufe, Grund, Lauf) einmal je Datei |
| `.harness/transcript/*.ndjson` | `loop.transcript`, ab Start des Loops (keine Vorgeschichte), Schema 1 und 2, Cursor je Datei |
| `.factory/progress.json` (früher `.harnez/`) | `loop.progress` (Story, Aufgabe, Phase) |
| `~/.hermes/ralph/<epic>-state.json` | nur bei Orchestrator `hermes` (+ Option `epic`): `loop.progress` mit `source: hermes` |

Konfiguration: `python`, `pollMs`, `hermesDir`. Jede Quelle fällt einzeln aus: ihr Fehler wird `loop.broken`, die anderen laufen weiter.

## Oberfläche

Eine Loop-Session zeigt im Kopf das Abzeichen „Loop · Name · Betriebsart“ (rot bei Störung, gelb bei Halt oder Pause) und
darunter das Panel: Fortschritt, Gate, Halt (`loop.hold`), Störungen (`loop.broken`, bis `loop.recovered`), Eskalationen,
Statistik und Tagesbericht. Alles wird aus den `loop.*`-Ereignissen der Session gefaltet (`deriveLoopView`); was der Loop
nicht gemeldet hat, bleibt leer. Pause/Weiter und der Wechsel der Betriebsart gehen als Steuerbefehl an den Connector, eine
Betriebsart mit Außenwirkung wird vorher bestätigt. Fragen des Loops erscheinen in der Freigaben-Ansicht.

`loop.hold`, `loop.broken` und `loop.notify` lösen zusätzlich eine Benachrichtigung aus (Glocke und Push).

## securesight-factory im Projektmodus und Steuerung (EPIC-P26, ADR-0043)

- **Zwei Sessions, ein Lauf:** „Lauf starten“ (`POST /api/factory/start`) legt einen **Treiber** (Claude/maki, erster
  Prompt `/factory <Auftrag>`) und den **Beobachter** (Loop `securesight-factory`, Modus `project`) an. Die Verknüpfung steht
  als `factory.linkage` auf beiden Sessions (JSONL, K7). Der Beobachter liest nur (`factory progress show`,
  `.factory/lauf-status.json`, Fehlerbelege, Intake) und schreibt nichts ins Projekt.
- **Anzeige:** Das Loop-Panel der Beobachter-Session zeigt Verknüpfung (Treiber läuft/beendet), Intake-Zustand
  (ausführungsbereit oder nicht), Lauf, Fortschritt, Fehlerbelege und Störungen — alles aus `loop.*`-Ereignissen bzw. dem
  gelesenen Treiber-Status. Endet nur der Treiber, steht dort „Treiber beendet“, nie „fertig“.
- **Steuerung** (`POST /api/factory/:id/command`, Policy `factory.control`, nur Menschen): feste Allowlist
  `end_run` (beendet beide Sessions), `resume` (`/factory` an den Treiber), `set_mode` (`factory init --reconfigure`; Betriebsart `a`
  merged automatisch und verlangt eine Bestätigung). Alles andere, auch `notify_ack` im Projektmodus, wird mit Grund abgelehnt.
  Jeder Befehl — auch ein abgelehnter — erzeugt ein `factory.command`-Ereignis auf beiden Sessions.
- **Einrichtung:** Das Formular „Factory-Projekt anlegen“ ruft `factory init`; ein Fehler zeigt den Grund der Factory,
  „nicht bereit“ zeigt die Checkliste und startet **keinen** Lauf. Der Hub setzt weder Trust noch Berechtigungen.
- **Namen:** „harnez“ steht nur noch im dokumentierten `.harnez/`-Lesefallback; `npm run check:names` (im Gate) prüft das.
- **Abnahme:** E2E `e2e/specs/factory-lauf.spec.ts` und Messlauf `docs/messlauf/2026-11-09-p26-factory.md` laufen gegen eine
  Attrappe der `factory`-CLI. Die manuelle Abnahme mit der echten Factory (AC-P26-10) bleibt `not_run`.

# PROGRESS — AncientVoid (Lagebericht)

## 25.11.2026 — PR-Lage klären, Flake-Fix, Hub auf neuen Stand (Sitzung f2f88190)

Lage: EPIC-P82 ist über PR #423 in main gemerged (16791e7b). #420 (EPIC-P83-Doku,
Auto-Merge aktiviert) ist BLOCKED — verify scheiterte am device-setup-Test mit
ENOTEMPTY; #424 (p80, andere Sitzung) ist offen, CLEAN und grün. Fix läuft auf
fix/device-setup-test-race: Tests warten auf den terminalen Zustand, bevor
afterEach löscht. Rückfall-Stand für den Hub-Neustart: f291ce81 (ausgeliefert).
Wiederaufnahme bei Abbruch: (1) Fix-PR mergen, (2) gh pr sync 420 (Auto-Merge
löst aus), (3) main pullen, PWA bauen, Wachhund-Neustart nach Skill
hub-neustart-live, (4) Nightly auf dem neuen Stand anstoßen.

Schritte 1–4 erledigt (PR #425, #420 gemergt, Hub läuft auf 4e9675f6, Health 200,
deployment consistent). Nightly 45559850100 auf dem Stand: vitest-full und k8 grün,
E2E rot in Shard 1+2 — device-setup (Runner-SDK ohne emulator-Binary, kein /dev/kvm),
main-sync (Git-Identität im Konflikt-Klon), progress/querformat (Flakes). Fix läuft
auf fix/nightly-e2e-runner; danach Nightly neu anstoßen — grün schließt #402–#404.

## 24.11.2026 Vormittag — Zurück-Knopf im Browser und hängende Sitzungsliste

**Nachtrag — Eigenkritik an #443, korrigiert in PR #444 (`d15059fb`, live).** Die Regel in
#443 lautete „Inhalt der fokussierten Kachel geändert → Vorwärtsschritt". Das war zu weit:
ein reiner Fokus-Wechsel (Alt+1/2/3, Klick auf eine andere offene Karte) ändert genau diesen
Inhalt — jede Fokus-Bewegung hätte einen Historie-Eintrag hinterlassen. Jetzt entscheidet die
reine Funktion `warVorwaertsSchritt()` in
`apps/pwa/src/features/workspace/content.ts`: nur was in **keiner** offenen Kachel steckt, ist
ein Schritt; Fokus-Sprung und Kachel-Schließen bleiben `replaceState`.
*Tests:* `test/features/workspace/content.test.ts` fünf Fälle (neue Sitzung = Schritt; Fokus
auf offene Kachel = kein Schritt; Verlauf teilt die Sitzungs-Adresse = kein Schritt, Graph mit
eigener Adresse = Schritt; Kachel schließen = kein Schritt; Alt+1/2/3-Serie = kein Schritt),
`test/features/workspace` + `test/app` 11 Dateien grün, Typecheck leer.
*Browser, ausgelieferter Stand `d15059fb`:* Desktop 1280 px — Sitzung öffnen 2→3, dieselbe
Sitzung erneut 3, **Alt+2 (Fokus) bleibt 3**, andere Sitzung öffnen 3→4. Handy 430×900 —
Übersicht (7 Zeilen, kein Ladeköder) → Sitzung A (+1) → zurück (`#/`, 7 Zeilen) → Sitzung B
(kein zusätzlicher Eintrag) → zurück (`#/`, 7 Zeilen).

**Fund (Nutzer, Handy):** „Die Zurück-Taste funktioniert hier gar nicht, ich muss die App
schließen und komplett neu öffnen.“

1. **Leere Historie.** `changeWorkspace()` schrieb jede neue Ansicht mit `replaceState` über
   die aktuelle Adresse, und viele Ansichten (Bild-/Dateivorschau, Plananzeige) änderten die
   Adresse überhaupt nicht. Vor dem Zurückknopf der Welt standen damit nur Seiten, die die
   Adresszeile zufällig hinterlassen hatte — Zurück warf in uralte Ansichten oder aus der App.
   Jetzt: echter Vorwärtsschritt (neue Seite, neue Sitzung, neue Vorschau, neuer Plan) →
   `pushState`; Fokus zwischen offenen Kacheln, Kachel schließen und Seitentausch bleiben
   `replaceState` (`apps/pwa/src/app/main.tsx`).
   *Nachweis (ViewPort 430×900, echter Klick auf eine Sitzungszeile):* Adresse wechselt auf
   die Sitzung, `history.length` wächst um eins, `history.back()` → `#/` mit Liste und
   geschlossener Sitzung, weiter zurück `#/notizen`, weiter zurück die zuvor besuchte Sitzung.
2. **Hängende Liste nach dem Zurück.** Die Seitenliste hängt an `/api/fleet` — gemessen
   **3,0 s** pro Abruf (jeder Partner wird befragt), bei abwesendem Rechner deutlich länger:
   nach dem Zurück stand **über 10 s** nur „loading…“ da, ohne Konsolenfehler. Die eigene
   Liste kommt in **6 ms** (`/api/sessions`). Jetzt wird sie zuerst gesetzt, die Flotten-Sicht
   ergänzt sie danach (`apps/pwa/src/app/App.tsx`). *Nachweis:* Liste beim Öffnen sofort
   (3 Zeilen), nach dem Zurück die Gruppen „Arbeitet 1“ / „Ruhig 4“ statt Ladeköder.

**Neu aufgeschrieben (offen, mit Messung in der Datei):**
* `bugs/bug-0287-…` — eine späte Kachel-Aktualisierung schreibt die Adresse der verlassenen
  Sitzung zurück in die Historie (direkt nach `history.back()` steht `#/`, 1,5 s später
  wieder die Sitzungs-Adresse). Richtung: Navigations-Marke beim popstate.
* `bugs/bug-0288-…` — der Denk-Block wächst im Browser nicht mit, in der Native-App schon.
  Messung in der **eigenen laufenden** Sitzung (15 s, alle 1,9 s): Ansicht baut und klebt am
  unteren Rand (`abstandUnten` 0), aber `.chat-live-thinking` bleibt leer (Länge 0).
  Adapter und Pumpe liefern Fetzen (`normalize.ts:90-91`, `stream-pump.ts:86-95`), die PWA kann
  wachsen (`ChatTurns.tsx:122-131`, Mitlauf-Effekt `SessionTail.tsx:1189-1190`). **Nächster
  Schritt: zählen, welche WebSocket-Rahmen während eines laufenden Zugs im Browser ankommen.**
  Achtung bei weiteren Messungen: eine Sitzung, die nicht in der Liste steht, bringt die App
  stumm zurück auf die Übersicht — zwei Messläufe waren deshalb wertlos.


## 24.11.2026 — Nachschau über die eigenen Änderungen (PR #…)

Vier echte Mängel in dem, was ich am Vorabend gebaut habe — alle behoben, nicht nur
gefunden:

1. **Chips nach Pfad, nicht nach Ziel geschaltet.** Der offene Zustand hing an
   `path`, die Chips aber an `target/path`: `bild.png` im Projekt und `bild.png` im
   Sitzungsordner öffneten sich immer zusammen. Jetzt ein Schlüssel (`bildpfad()`).
2. **Einhängen zu früh gerechnet.** `zeigeBlockVollstaendig()` lief im Klick-Handler,
   also vor dem Rendern — die Höhe des gerade erschienenen Bilds fehlte, die
   Bildunterschrift rutschte erneut unters Eingabefeld. Jetzt nach dem Rendern
   (`useEffect` auf dem offenen Zustand, beim Laden der Seite aus) **und** nach dem
   Bild (`nachLaden`). Der erste Screenshot sah nur gut aus, weil schon ein anderes
   Bild offen war.
3. **Stillschweigend gekürzt.** Eine `ls` mit 40 Namen zeigte 6 Chips und schwieg zu
   den anderen 34. Jetzt `nichtGezeigt` + „… {count} weitere Dateien nicht
   aufgelistet".
4. **Echo-Erkennung nach Präfix** (`id.startsWith("av")`) hätte auch ein echtes
   Ereignis treffen können. Jetzt: nur Ids, die dieser Adapter wirklich vergeben hat.
   Zusätzlich: `cd`-Erkennung verlangt eine Befehlsposition (`sed 's/cd alt/cd neu/'`
   verschob die Wurzel sonst), Klammer/Komma am `cd`-Ziel werden abgeschnitten.

Tests: `apps/pwa/test/features/tool-image.test.ts` 18/18 (neu: Argumente mit `cd`,
Kürzungszahl, zwei gleich benannte Ziele), `packages/adapters/pi/test` 67/67 (neu:
fremde `av`-Id bleibt ein Ereignis), `npm run typecheck` und `check:i18n` leer.

**Zwei weitere Funde im Browser-Check (Kratz-Hub :7399, neue Fixture mit 9 Namen und
zwei gleich benannten Dateien):**
* Kaputte Bilddatei: Route liefert 200, Bytes kommen an (1270 B, `image/png`), aber der
  Browser kann nicht dekodieren → bisher ein gebrochenes Bildkästchen ohne jeden Hinweis.
  Jetzt `onError` am `<img>`: kein Kasten, dafür „Bild kam an, ließ sich aber nicht
  anzeigen (beschädigte Datei?)". (Die Fixture selbst war porös — IHDR-Länge 17 statt 13,
  erzeugt aus einem Shell-Herodoc; das ist ein Lehrstück: erst die Bytes prüfen, dann der
  UI einen Fehler unterschieben.)
* Nach dem ersten Öffnen blieb der Block 6 px zu tief (Bildhöhe wächst nach dem
  Einhängen). Jetzt additionally `onLoad` → Block wird nach dem Dekodieren neu
  eingehängt. Gemessen nachher: Block 189–368 bei Rahmen 155–436 (68 px Abstand),
  beide Bildunterschriften per `elementFromPoint` erreichbar.

**Bewusst offen gelassen (Limitation, nicht Fehler):** die Wurzel einer
Schalen-Ausgabe wird als **eine** Kette berechnet — `cd A && (cd B && ls); ls` nennt
Namen aus zwei Wurzeln, die sich nicht sauber trennen lassen. Ebenso `pushd`/`popd`.
Beide Fälle laufen ins Weglassen (keine Vorschau), nicht in eine falsche Vorschau.

## ## 23.11.2026 Nacht — cd-Fallstrick der Bildchips (PR #367)

**Nachweis aus eigener Live-Sitzung.** 7d3df295 hat als Arbeitsverzeichnis
`/home/kaib/repos/ancientvoid-suche`; der Befehl
`cd /home/kaib/repos/AncientVoid && ls -1 apps/pwa/public/icons/*.png` nennt Pfade,
die es unter der Sitzungs­wurzel **nicht** gibt. Die Chips der PR #355 laufen aber
über `…/api/code/raw?session=<id>` — Wurzel = Arbeitsverzeichnis —, hätten also ein
Bild versprochen, das mit 404 antwortet.

**Regel.** Die `cd`-Kette der Zeile wird lexikalisch nachgerechnet (letztes `cd`,
`.`/`..` bereinigt). Ziel im Projekt → Projektroute mit korrektem Präfix; Wurzel nicht
bestimmbar (relatives `cd` ohne bekannte Ausgangswurzel, `~`, `$VAR`, Ziel außerhalb
des Projekts) → **keine** Vorschläge. Grundsatz: lieber keine als eine ins Leere.
Tests 15/15, Typecheck `apps/pwa` leer.

**Bewusst nicht geändert.** Chips können weiterhin Namen nennen, die nur im Text
stehen (zwei echte Fälle in der eigenen Sitzung: `pgrep`-Ausgabe → `image.png`,
`grep` auf einen HTTP-Header-Dump → `nachweis-bild.png`). Ein Befehls-Allowlist
(`ls`, `find`, …) hätte den Originalfall von #355 killt — dort kam der Name aus einer
`for`-Schleife mit `printf`. Der Fehlversuch ist stattdessen ehrlich beschriftet:
„Bild hier nicht abrufbar — es liegt außerhalb des Projekts."
(`session.tool_image_missing`).

## 23.11.2026 Nacht — Störsignal im RPC-Strom beseitigt (PR #360, main 3da56ab8)

Nach dem Hub-Neustart um 21:16 erschien in einer laufenden Sitzung
`pi: unbekannter Stream-Typ "get_state"` (seq 9998). Grund: übernimmt der Hub einen
**laufenden** tmux-Worker, spielt der Pane-Puffer die eigene Anfragezeile
(`{"id":"av1","type":"get_state"}`) zurück, und die Protokollschicht reichte sie an den
Event-Parser weiter. Regel jetzt: Frames mit einer Id, die der Adapter selbst vergibt
(`av`-Präfix), sind keine Ereignisse — pi nutzt UUIDs und `call_…`; echte Antworten
(`type:"response"`) bleiben unberührt. Rot bewiesen ohne Absicherung
(`expected [ get_state, agent_start ] to deeply equal [ agent_start ]`), Paket 67/67.

**Live-Stand nach diesem Block (gemessen, nicht vermutet).** Hub auf `26fe3fde`,
`runtimeSha == checkoutSha == pwaSha == 26fe3fde`, `runtimeDirty: false`, ausgeliefertes
Bundle `assets/index-DY-WYBVb.js`, pi-Capability `midTurnInput: true`. Der tmux-Worker
der laufenden Sitzung (Pane seit 21:15:25) hat **drei** Hub-Neustarts überstanden — die
Übernahme aus #357 trägt den Zug durch den Neustart, genau wie im Test. Merksatz für
künftige Deployments: `apps/pwa/dist` liegt auf der Platte, ein neues Bundle wirkt schon
vor dem Neustart; der Neustart ist nötig, damit die drei Shas wieder zueinander passen.

**Nebenbefund, nützlich für künftige RPC-Arbeit:** echtes `pi --mode rpc` antwortet auf
`get_state` exakt mit `{"id":"…","type":"response","command":"get_state","success":true,…}` —
die Id-Zuordnung in `rpc.ts` passt. Beim Start sendet pi zusätzlich
`extension_ui_request`-Frames (eigene UUID-Ids); die bleiben bewusst ungelesen.

## 23.11.2026 Nacht — Bildvorschau auch für Dateinamen aus Shell-Ausgaben (PR #359)

**Fund.** Kai zeigte auf ein `tool_result` mit `neonsunset_shot1.png 200 65140 …`:
die Bilder lagen im Arbeitsverzeichnis, aber im Chat führte **kein** Link hin — die
Vorschau (PR #350/#354/#355) hing allein am `read`-Werkzeug, Pfad in der Eingabe.

**Umsetzung.** `apps/pwa/src/features/session/tool-image.ts`: `toolImageHits()` trennt
`direkt` (gelesenes Bild) von `vorschlaege` (Bildnamen im Ausgabe-Text von Schalen-
Werkzeugen). Relative Pfade gehen über die Sitzungsroute (Wurzel = Arbeitsverzeichnis —
genau da liegen sie), absolute über die Projektroute; URLs, `.git`-Ordner, `..` und der
siebte Vorschlag fallen weg. `EventRow` und `ChatTurns` zeigen eine Chip-Kette, Bilder
werden erst auf Zuruf geladen. Tests 12/12.

**Layout-Fallstricke, gemessen statt geraten.** (1) Der Chat-Ausschnitt ist niedrig
(246 px) und hat oben einen **klebenden Tagesabschnitt**: Chips landeten darunter und
waren nicht anklickbar (`elementFromPoint` traf die Leiste). (2) `scrollIntoView` mit
`scroll-margin` konnte beide Ränder nicht halten — die Bildunterschrift hing bei
y 457 während das Ausschnittende bei 436 lag, also unter dem Eingabefeld. Deshalb
hängt `zeigeBlockVollstaendig()` den Block selbst ein (Zentrieren, wenn es passt, sonst
am unteren Rand) und die Vorschaubilder sind auf 240×128 px begrenzt. Nachher: Block
y 220–428 im Ausschnitt 190–436, alle Chips/Bilder/Links erreichbar.

## ## 23.11.2026 Nacht — Lenken mitten im Zug: pi läuft jetzt als RPC-Prozess (PR #357)

**Warum das vorher zu war (BUG-0261).** pi wurde pro Nachricht als eigener Prozess
gebracht; Lenken mitten im Zug hätte einen *zweiten* pi-Prozess auf derselben Sitzung
gestartet, und zwei Prozesse überschreiben das Arbeitsverzeichnis. Deshalb war
`midTurnInput` für pi auf `false`, und die PC-Oberfläche bot „Jetzt senden“ nicht an.

**Die Änderung (PR #357, Branch `feat/pi-rpc-steering`).** `pi --mode rpc` ist genau
dassebe Protokoll, nur langlebig: ein Prozess pro Sitzung, JSONL-Eingaben auf stdin.
Der Adapter hat dafür `adapters.pi.config.mode` (`oneshot` = altes Verhalten,
Standard; `rpc` = ein Prozess pro Sitzung). Neu: `packages/adapters/pi/src/rpc.ts`
(Zeilenrahmung nur LF, Anfragematch, Fristen, Aufräumhaken), `steer`/`follow_up` über
den laufenden Prozess, `/compact` als RPC-Befehl, Abbruch erst `abort` dann nach 5 s
Keule, `queue_update` → Systemereignis **`pi.queue`** („vorgemerkt — N Lenkung“),
`extension_ui_request` wird verworfen. Zugrahmen meldet jetzt der Adapter selbst
(`ctx.turn("working"/"idle")` auf `agent_start`/`agent_settled`) — persistente
Prozesse enden nicht pro Zug.

**Nachweis (Kratz-Hub :7399, echtes Modell Strata, `workerRunner: process`).**
(a) `sleep 18`-Werkzeuglauf, nach 6 s gelenkt → Antwort `GESTEUERT`. (b) Meldung
vorgemerkt (`queued`), dann `POST /queue/<id>/send` mitten im Lauf → 200, Ereignis
`pi.queue` („vorgemerkt — 1 Lenkung“), Antwort `JETZTGESENDT`. (c) zweiter Zug erinnert
sich an den ersten („Die letzte Anweisung lautete … GESTEUERT“) — derselbe Prozess,
kein `worker_end`. (d) lenken ohne offenen Zug → 422 „es läuft kein Zug“.
Tests: `rpc.test.ts` 6/6, `rpc-adapter.test.ts` 8/8, Paket 63/63, Typecheck sauber.

**Hub-Neustart mitgezogen (Fund beim Debuggen).** `recover()` hing den übernommenen
Prozess an den One-Shot-Parser — in der RPC-Betriebsart wäre Lenken nach jedem Deploy
tot gewesen. Behoben: `steuereProzess()` (frisch oder übernommen), Test
„übernimmt nach einem Hub-Neustart denselben Steuerprozess" (ohne Fix rot, mit Fix
grün). Live: tmux-Worker eines laufenden pi-Zugs überlebt den Hub-Kill, danach neues
Prompt + Lenken → Antwort `NACHNEUSTART`. Paket: 66/66 grün.

**Live umgestellt (23.11., 20:05 UTC).** PR #357 ist gemerged (main `b0103583`),
`hub.config.json` (unversioniert) hat für pi `"config": { "mode": "rpc" }`; der
Hub-Neustart läuft per Wächter, sobald kein Zug mehr offen ist. Danach muss
`GET /api/health` bei adapter `pi` `midTurnInput: true` und
`promptDelivery: "live"` zeigen. **Rollback:** `"mode"` aus dem pi-Eintrag nehmen und
den Hub neu starten — damit ist wieder die alte One-Shot-Schiene aktiv.

**Noch nicht erledigt.** (1) **BUG-0272 Pforte**: `durchlassen()` in
`packages/core/src/modules/inference/pforte.ts` hat weiter **keine Aufrufstelle** —
Admission-Kontrolle existiert nur als Route (`/api/inference/gate`) und Lease, nicht
als Riegel vor den Modellaufrufen.

**Fallstricke für die nächste Sitzung.** `hubctl token issue` schreibt in die **Standard-DB
`data/hub.db`**, nicht in die des Kratz-Hubs — fürs Kratz-Setup immer
`--db /tmp/<…>/data/hub.db` mitgeben (sonst hängt ein Scratch-Token am Live-Hub; die
drei von heute sind widerrufen: `scratch-rpc`, `scratch-live`, `scratch-ui`).
Kratz-Hub-Rezept: `ANCIENTVOID_CONFIG=/tmp/av-rpc/config.json node apps/hub/src/main.ts`
mit `workerRunner: "process"` (Wert `"child"` ist ungültig → Hub startet nicht) und
`adapters: { pi: { config: { mode: "rpc" } } }`. pi putzt seine Prozesszeile —
`pgrep -f 'pi --mode rpc'` findet nichts, Nachweis über Verhalten (kein `worker_end`,
Gedächtnis über Züge hinweg) statt über `ps`.


## 23.11.2026 Abend — Compaction-Schleife, Bilder, Warteschlange (verifiziert)

**Compaction-Loop (Punkt 5).** Ursache gemessen: `Auto-compaction failed:
Summarization failed: generation hit the token cap and the summary is incomplete` —
11 Fehlversuche in 3,5 h (events.jsonl von 7d3df295), Kontext fiel nie, also Versuch
für Versuch jeden Zug. Zusammenfassungen wuchsen 11 494 → 93 231 Zeichen. Behoben:
`maxTokens` 32 768 (normal Antwort darf 30k+ sein), Extension
`~/.pi/agent/extensions/compaction-budget.ts` (eigenes Budget 10 000 Token, max 180
Zeilen, Schleifenschutz <8 % Fortschritt / 3 min). Nachweis: `/compact` auf Kratz-
Sitzung → `FERTIG grund=manual tokensBefore=42259 zusammenfassung=3442 Zeichen
stopReason=stop`; Prompt dieser Sitzung 238 205 → ~112 000 Token, seither kein
weiterer Versuch. Chat-Zeile jetzt lesbar (PR #349, `compactionSummary()` in
`packages/adapters/pi/src/normalize.ts`, 12 Tests grün).

**Bild-Vorschau: gebaut, aber wirkungslos — second View übersehen (PR #354).** Nach
dem Merge von #350 live nachgesehen: die Vorschau erschien **nirgends**. Zwei eigene
Gründe: (a) `SessionTail` entschied `session.hostId ? undefined : …`, und **jeder**
Sitzungsdatensatz trägt die hostId des eigenen Hubs (live: `hostId: "cachyos-ai"` auf
der eigenen Sitzung) — die Weiche schloss also alle eigenen Sitzungen aus; jetzt
vergleicht `sessionRefFor()` mit der eigenen Kennung (`remoteHost`). (b) Die Vorschau
hing nur an der flachen Ereignisliste, nicht an der **Zug-Ansicht**, die im Chat
standardmäßig gezeigt wird; `StepRow` rendert sie jetzt über denselben Detektor, und
das Bild selbst ist der Link. Nachweis im Browser, Sitzung 7d3df295, Lese-Schritt
#8474: `.turn-step .tool-image a img` gemessen **96x64, komplett geladen**, Meta-Zeile
4 px unter dem Bild mit Dateiname und „Bild öffnen"; Screenshot zeigt den Farbverlauf
mitten im Zug. Diagnose-Falle: mein erstes Test-PNG (239 Bytes) war kaputt — Chromium
dekodierte nicht, `naturalWidth` blieb 0; das war kein App-Fehler.

**Bild-Vorschau + Einfügen unter Linux (Punkte 1 und 2, PR #350).** `toolImageRef()`
zeigt gelesene Bilder als Vorschau inkl. „Bild öffnen" über `GET /api/code/raw`
(keine neuen Rechte). Linux/Wayland: Chromium liefert keine Bild-Bytes, Datei-Manager
legen Pfade ab → neue Route `POST /api/local-files/bytes` (nur absolute Pfade, nur
innerhalb `projectRoots`, Endung **und** Magic Bytes, `MAX_ATTACHMENT_BYTES`), eigene
Policy-Operation `files.readLocal` (nur Mensch, fleet/agent/bridge/companion/display
deny), **nicht** flotten-routbar. Tests: 6 Route + 2 Policy + 5 PWA-Pfade.

**Warteschlange am PC (Punkt 3, PR #352).** Gemessen: pi `midTurnInput: false`
(BUG-0261, zwei pi-Prozesse auf derselben Sitzung überschreiben das Arbeitsverzeichnis)
→ alles im laufenden Zug wird vorgemerkt; PWA bezieht die Fähigkeit live aus
`/api/adapters`; Hub-Journal seit 17:00: **kein** Request ≥ 400. Der einzige echte
Ärgernis-Knopf „Jetzt senden" kann in diesem Modus nie funktionieren →
`sendNowPossible(working, steerable)` zeigt stattdessen Grund + „geht automatisch
raus, wenn der Zug fertig ist"; Core-Meldung erklärt jetzt das Warum.

**Parallelverarbeitung (Punkt 4).** Der Mechanismus existiert schon: **Pforte pro
Modell-Endpoint** (ADR-0116, PR #343, `GET /api/inference/gate`,
`inference.slot_wait` statt Provider-Fehler). ABER: auf diesem Rechner lief der
Hub-Prozess von `83d57105` — **älter** als `5e71d1e0` — die Pforte war also nicht
wirksam (404 auf `/api/inference/gate`). Wackeltum: deployment-Identität
(`runtimeSha` vs `checkoutSha`) nach jedem Merge prüfen und neu starten, sonst
Rollt der laufende Prozess hinter main zurück. Offener Rest aus BUG-0272:
hub-interne Kurz-Anfragen (Gatekeeper, Titel, Übersetzen, Enhance, Analyse) laufen
noch ohne `durchlassen()`.

**Auslieferung.** main = cf96201f (#349, #350, #352 gemerged), PWA gebaut
(`index-Dqzv9lG_.js`), Auslieferung läuft automatisch weiter: der Wächter `/tmp/hub-neustart-wait.sh`
startet 60 s, nachdem der Hub keine Kindprozesse mehr hat (kein Zug läuft), und
schreibt health, die drei Shas und den Bundle-Merker nach
`/tmp/hub-neustart-watch.log`. Stand beim Schreiben: laufender Hub `cf96201f`,
main `3b012409`, ausgeliefertes PWA-Bundle bereits `index-CepfQPIH.js` (statisch
vom Datenträger, ohne Neustart wirksam). Nachweis der Pforte nach diesem Neustart:
`GET /api/inference/gate` antwortet 200 (vorher 404, weil der Prozess älter war als
der Pforte-Merge).

Hub-Neustart durch Wächter `/tmp/hub-neustart-wait.sh`
(startet 30 s nach dem letzten laufenden Zug, Protokoll
`/tmp/hub-neustart-watch.log`: health, runtime/checkout/pwa, Gate-Status).

## Ziel
Die Suche des Hubs war zu billig (nur Markdown, nur ein Projekt). Sie sucht
jetzt den ganzen Fundus: **Sessiontexte — Fragen und Antworten** — plus Doku,
in einem Feld. Implementierung, Tests und E2E sind fertig und am laufenden
Interface verifiziert (Branch `feat/suche-sessiontexte`, 5 Commits). Fertig und **live**: PR
**#276** ist gemergt (Merge-Commit `00dc288c`, Quellzweig gelöscht), Gate
`verify` **pass 3m19s**. Hub neu gestartet (Wachhund `systemctl --user restart`):
health 200 nach 3 s, `version.json` sha `00dc288c`, `dirty:false`, Hub-Log
`search: Sessiontext-Index 17247 Zeilen (fts5)`. Nachweis am laufenden Hub:
`GET /api/search/all?q=flowkey&scope=all` → `mode and`, `sessionStatus ready`,
`sessionTotal 2`, Fundstellen seq 19 (Frage) und 474 (Antwort) mit markiertem
Fundwort; Indexzeile in der PWA „17283 Texte aus 5 Sitzungen". Für den Nachweis
gelegtes Gerätetoken ist widerrufen (`token revoke`, Route antwortet danach 401).
Der Deploy bringt auch **P75 Sprachausgabe** auf den Hub (main enthielt es seit
11:46; der Live-Hub stand vorher auf `5701180b`).

**Nachzug 23.11. — „warum finde ich Tokdeck nicht?“** Die Suche fand Tokdeck
(20 Fundstellen in Frage/Antwort, 1 062 mit Denken/Werkzeug), aber drei Lücken
waren echt: (1) Begriffe mit Trennern (`tokdeck.env.key`, Pfade) suchte man als
ein Wort und fanden sie nicht — FTS5 zerlegt sie in Tokens; jetzt Phrase-Suche.
(2) Die Doku-Seite war an das Projekt der laufenden Sitzung gebunden, das Repo
`tokdeck` war nie im Suchraum — jetzt `allProjects=1` mit Projekt an der
Fundstelle und gemeldetem Umfang (12 Projekte / 2,5 s). (3) Eine leere Liste nannte
keine Facetten, las sich also wie „nichts im Hub“, obwohl 162 Fundstellen in
Denken/Werkzeug lagen — jetzt Zahl plus Einschalt-Knopf. Nebenbei: der
Nyx-Schwebeknopf lag auf dem Handy auf dem „Sitzung öffnen“-Knopf der Fundkarte.

Nachweis danach am **laufenden** Hub (sha `d72024c5`, health 200 nach 2 s):
„Tokdeck“ → Sitzungen 20 Fundstellen; mit „Doku in allen Projekten“ → 7
Fundstellen aus 7 Projekten, oben als Fundorte (`tokdeck/README.md`,
`tokdeck/PROGRESS.md`); „tokdeck.env.key“ → Hinweisle „208 Fundstellen liegen in
Denken, Werkzeug“, nach einem Klick 208 Fundstellen. Gate: #302 `pass 3m0s`,
#303 `pass 3m23s` (erster Versuch von `activity-register.test.ts` verlaufen,
lokal 13/13 — einmal neu angestoßen). Diagnose-Rezept liegt als Skill
`.agents/skills/ancientvoid-hub-suche`.

**Vierte Suchstufe `typo`**: „tokdek“ ist weder Wortanfang noch Teilwort von
„tokdeck“, blieb also ein stiller Null-Treffer. Die Wortliste des Index
(`fts5vocab`) hält Kandidaten gegen die vorhandenen Wörter — Edit-Distanz 1
(ab acht Zeichen 2) oder Teilfolge — und die Antwort nennt `corrected`. Kurze
Begriffe (< 5 Zeichen) werden nicht geraten, und was keinen Kandidaten hat,
bleibt leer.

Der häufigere Fall ist der Widerhall: der vertippte Begriff steckt im Bestand —
in der Frage selbst — und die Liste ist richtig und nutzlos zugleich. Darum läuft
parallel die **Vorschlagsstufe**: sie zählt Fundstellen ähnlicher Wörter und zeigt
einen Chip („meintest du tokdeck? 3 Fundstellen“), der neu sucht. Die Reihenfolge
der eigenen Treffer wird nie heimlich verändert.

**Cross-Hub-Suche** (dieser Zweig/PR): `hubs=1` fragt die gekoppelten Hub-Rechner über
die bestehende Fleet-Tür (`/api/search` ist fleet-routable, kein neues Recht),
funde tragen `hub`/`hubUrl`, und pro Rechner steht in `hubs`, wie er mitgemacht
hat (ok / offline / abgelehnt / zu alter Hub / übersprungen). Die PWA zeigt den
Kreuz „andere Rechner einbeziehen“ (nur wenn Peers bekannt sind), eine Zeile pro
Rechner, und eine Fremdsitzung öffnet auf deren Hub statt ins Leere zu springen.

**Sitzungsfilter findet Inhalt, Sprung zur Fundstelle** (dieser PR): das
Suchfeld der Übersicht war ein Titel-Filter — Kai sucht aber nach dem, was in
einer Sitzung gesagt wurde. Ab zwei Zeichen sucht das Übersichtsfeld jetzt im
Sessiontext-Index (`/api/search/all`, scope=sessions): Karten tragen eine
Fundstellen-Marke, eine Zeile sagt, was gefunden wurde, und ein Tipp öffnet die
Sitzung **an der Fundstelle** — Adressform `#/sessions/<id>/seq/<n>` (auch
host-qualifiziert). Fundstelle ist die früheste Trefferstelle der Sitzung; liegt
sie mitten in einem Zug, wird der Zug angesprungen (nur er liegt im DOM) und
leuchtet 2,2 s nach. Im Probelauf auf dem echten Hub: Filter „Kurbelwelle“ →
Treffer in der 4 800-Ereignisse-Sitzung, angesprungen bei seq 1639, dort
sichtbar (`inView: true`, `hit-target` nachgewiesen).

**Nachzug 23.11., zwei Nutzerfund-Stellen:** (1) In einer **laufenden** Sitzung
fiel der Chat nach dem Sprung zur Fundstelle ans Ende zurück — der Sprung hält
jetzt 8 s gegen das Mitlauf-Nachziehen (#329). (2) Der Tages-Anker saß nur an der
Tagsgrenze: im Probelauf hing „Heute" 3 037 px über der Lesestelle, unten war nur
Uhrzeit zu sehen. Die Tageslinie haftet jetzt an der Lesespitze (`sticky`,
`--z-sticky`), und Stempel ab gestern tragen den Tag („Gestern · 09:16:59") —
heute bleibt die nackte Uhrzeit (#331). Nachweis: 430 px am echten Hub, Stempel
`#1 · system Gestern · 09:16:59`, haftende Linie exakt an der Behälterkante,
keine Überlappung zweier Linien; chat- specs + Suche 9/9.

**Bild in fremder Sitzung einfügen** (Nutzerfund 23.11.): der Chip zeigte
„Unsupported Media Type“. Der Fleet-Catch-all `app.route("/api/hosts/:hostId/*")`
kann nur JSON (`forward()` serialisiert, Parser ist JSON) — ein Rohbild hat dort
keinen Parser, Fastify antwortet 415 **vor** der Weiterleitung. Neue Route
`/api/hosts/<id>/attachments` mit Roh-Parser + `forwardRaw()` (Bytes,
`content-type`, `x-filename`, 60 s, gleiches Kopplungs-Token, keine neuen Rechte).
Nachweis: 4 neue Fleet-Tests (zwei echte Hubs, echtes PNG, Peer hat die Bytes
byte-identisch), live `POST /api/hosts/kaisgamingdesk/attachments` → 201 und
`GET …/attachments/<id>` → 200 beim Peer; im Browser zeigt die fremde Sitzung
dasselbe Chip-Bild wie die eigene (vorher 415).

**Warteschlange einer fremden Sitzung bedienen** (Nutzerfund 23.11., PC):
„Editieren und Löschen von Vorgemerkt funktioniert nicht“. Zwei Defekte:
`operationOf()` hatte für `/api/sessions/<id>/queue…` kein Mapping →
Fail-closed-Fallback → Peer-Hub antwortete 403 „Nicht erlaubt für
fleet:cachyos-ai: …“, und der Fleet-Proxy ließ **PATCH** gar nicht durch.
Neue Policy-Operation `sessions.queue` (Mensch + Flotte allow, Agent/Display
deny), Mapping für `PATCH`/`DELETE`/`…/send` (Liste bleibt `read`), PATCH in der
Proxy-Methodenliste, und der Proxy reicht den Grund des Peers durch statt der
„Kopplung widerrufen“-Vermutung. Nachweis: neue Fleet-Integration mit zwei
echten Hubs (4/4: Liste mit `position`, Text ändern, umhängen, streichen,
sofort senden — jeweils beim Peer nachgelesen), neue Policy-Tests (4/4), neue
PC-E2E (8/8 desktop/tablet/mobile), 79/79 in fleet+policy+queue+css. Live auf
`83d57105`: eigener Rechner `PATCH …/queue/<unbekannt>` → 422
„nicht mehr in der Warteschlange“ (kam also durch die Policy), Bundle
`index-3beX1QxM.js` enthält die neue Zeile. **Offen:** kaisgamingdesk läuft
noch auf älterem Stand und lehnt dort weiterhin ab — Flotten-Änderungen wirken
erst, wenn **beide** Hubs denselben main haben.

## Erledigt (verifiziert)
- **Shell endet an der Statusleiste, Rauszoomen bis 50 % möglich (BUG-0279).**
   Am PC reichte die Shell bis zum Fensterboden und legte sich 28 px über die
   fixe Statusleiste; die Zoom-Untergrenze war deshalb bei 70 % versüßt
   (`SCALE_MIN`). Neu: Token `--status-bar-h`, Abzug am Container
   (`#app:has(.split)` ab 1280 px: `calc(100dvh / var(--ui-zoom) - var(--status-bar-h))`),
   Untergrenze 0.5, Hinweis in den Einstellungen. Belege: `ui-scale.test.ts`
   6 passed (zuerst rot: `expected 0.7 to be 0.5`), `oberflaeche.spec.ts`
   13 passed (Grenzen 50/200 %), `zoom-flaechen.spec.ts` Matrix auf fünf Stufen
   (50/70/100/130/200 %) — 11 passed, Vorher war dieser Spec auf Windows schon
   ohne Änderung rot (Shell-Unterkante 720 ≠ Boden 692). Offene Folgethemen:
   BUG-0280 (eigene Nachricht nach dem Senden nicht im Chat) und BUG-0281
   (Gerätekennung „Du · handy“ am Desktop, weil derselbe Token genutzt wird).
- **Eingefügte Bilder erreichen den Agenten jetzt als Bild, nicht als Vermerk
  (BUG-0267).** Der Adapter `pi` sagt `images:false`, der Hub legte ihm deshalb
  nur den ausgelesenen Text vor — und ohne OCR stand dort nur „(kein Text
  auslesbar)" — der Pfad zur Bilddatei stand im Prompt, der Hinweis, sie zu
  oeffnen, nicht. `promptWithAttachments` kuendigt Bilder ohne OCR-Text jetzt
  als Bild mit Pfad und der Aufforderung, es mit dem Datei-/Bild-Werkzeug zu
  ansehen; Nicht-Bilder bleiben kurz. Adapter mit Bild-Zusage (claude,
  opencode, codex app-server) bekommen das Bild weiterhin nativ.
  `prompt-with-attachments.test.ts` 5 passed (zuerst 2 failed, BUG-0267).
- **Bild-Anhang: ehrlicher Auslese-Befund + Vorschau schon VOR dem Senden
  (BUG-0266).** Der Hub meldete bei Bildern pauschal „Kein Text gefunden. Mit
  einem Gemini-Schluessel …", obwohl auf dem Hub-Rechner **gar kein**
  OCR-Werkzeug sitzt und kein Vision-Schluessel gewollt ist. `extractText`
  meldet jetzt werkzeugabhaengig („tesseract nicht installiert — der Text wurde
  nie gelesen; das Bild ist unveraendert in voller Groesse zu sehen“) und nennt
  ein Vision-Modell nur, wenn keins eingeschaltet ist. Der alte Test war an
  `tesseract`/`magick` gekoppelt und wurde ohne diese Werkzeuge
  **uebersprungen** — deshalb fiel das nie auf. Neu: `hasTool` ist injizierbar,
  der Fall laeuft determiniert auf jedem Rechner (`extract.test.ts`
  **5 passed | 2 skipped**). Ausserdem zeigt die Eingabezeile jetzt ein echtes
  Vorschaubild (ein Tipp = dasselbe Vollbild wie im Chat, Esc schliesst, Anhang
  bleibt haengen) und nur noch ein Kurzlabel („1 KB · kein Text gelesen“); der
  volle Grund bleibt als `title`. E2E `anhang-bilder.spec.ts` **3 passed**.

- **Der Chat nennt jetzt den Tag, nicht nur die Uhrzeit (Nutzerfund 23.11.).**
  Tages-Anker als eigene Zeile im Verlauf: „Heute“, „Gestern“, im selben Jahr
  „Fr., 21.11.“, aeltere mit Jahr. Helfer `apps/pwa/src/shared/i18n/day-label.ts` —
  `dayKey` rechnet **lokal**, der Trenner wechselt an der lokalen Mitternacht und
  nicht um 00:00 UTC. Verdrahtet in den Chat-Zuegen (`ChatTurns`) und der
  Verlaufsspalte (`SessionTail`); die Uhrzeiten bleiben daneben stehen. CSS
  `.day-sep` nutzt nur Design-Token. Tests: `apps/pwa/test/shared/day-label.test.ts`
  **8 passed** (Mitternacht, Monats-/Jahresgrenze, erster Eintrag, Sammelzeile ohne
  Zeit), E2E `chat-zuege.spec.ts` **1 passed** (Anker genau einmal, Text „Heute“,
  Uhrzeit bleibt als `HH:MM:SS` stehen).
- **Kontextüberlauf ist keine Anmeldepleite mehr (BUG-0265, ADR-0115).** Vier
  identische Rohfehler in Sitzung `943797b3` („prompt (237428 tokens) … context
  (204800)") liefen als „Die CLI ist nicht (mehr) angemeldet" ins Banner — die
  gierige auth-Regel `invalid.*(api.?key|token)` fing „invalid_request_error" plus
  späteres „tokens". Neue Kategorie `context` prüft vor quota/auth, nennt die
  Tokenzahlen und den gangbaren Weg (Übergabe/großeres Modell); auth-Regel scharf
  (`invalid.{0,24}?(api.?key|token|credential)`). Rot-vor-gruen: 6 failed →
  **24 passed** in `provider-error.test.ts`. Runbook hat jetzt eine
  Kategorien-Tabelle (setzt den Frischhalte-Wecker von `operations-runbook.md`).


- **Bilder im Chat: einfügen, ansehen, verlinken (S82, 23.11.)** — Einfügen oder Ablegen im
  Eingabefeld haengt Screenshots an die Nachricht (`shared/paste-images.ts`,
  `composer/Composer.tsx`); die Chat-Zeile zeigt ein echtes Vorschaubild mit Oeffnen-Ecke
  (`features/attachments/Attachments.tsx`, `app/styles/58-attachment-viewer.css`); ein Tipp —
  oder der Bild-Link eines Agenten (`#/anhang/<id>`, session-intern `…/anhang/<id>` in
  `app/route.ts` + `app/main.tsx`) — oeffnet dasselbe Vollbild, als `body`-Portal (z 400,
  Fokusfalle, Esc/Tipp am Rand/✕ schliesst). Bewiesen in `e2e/specs/anhang-bilder.spec.ts`
  (2 passed, mobile): natuerliche Bildmasse 320×200 im Vorschaubild, Vollbild-BBox
  > 200×100, Deep-Link oeffnet und fuehrt session-intern zurueck; Dokument-Chips bleiben die
  Text-Ansicht („4711“). Agenten-Rezept: `docs/bild-links-fuer-agenten.md`, Leitplanke in
  `AGENTS.md` (kein Bild als Dateipfad abliefern).
  **Live bewiesen am produktiven Hub** (23.11., Bundel `assets/index-7aVYSFO8.js`,
  `version.json` sha `1034942f`, kein Hub-Neustart nötig — nur Static): Upload ueber
  `POST /api/attachments` (163 270 Byte, `kind=image`), Link `#/anhang/<id>` oeffnet das
  Vollbild (Ebene 300, Name „selbsttest-vollbild.png 159 KB“ vordergrund-, ✕-Trefferzone
  frei, Esc schliesst), Einfuegen auf `#/neu` haengt das Bild an (Chip „wird gelesen…“ →
  „Kein Text gefunden“) und der Anhang ist nach dem Entfernen wieder weg (Chips 0).
  css-tokens-Ratchet zuerst rot (z-index 400, eigener Breakpoint) → auf die Leiter gezogen
  (`--z-lightbox: 300`, `(max-height: 520px)`), danach 14 passed.
- **Sessiontext-Index (Core)** `packages/core/src/modules/search/session-text-index.ts`
  plus Migration 40 (`transcript_lines`, `transcript_state`): FTS5 über die
  echten `events.jsonl` **inkl. Blob-Payloads** (K5-Offload — ohne Blob-Read
  wären lange Antworten unauffindbar), rollengetrennt (user/assistant/thinking/
  tool/system), rollengewichtet, Snippet mit Markerzeichen, Präfix + Umlaut-
  Faltung, AND→OR-Rückfall sichtbar als `mode`, Projekt-/Projektbaum-Filter,
  Rückfall `engine:"scan"` ohne FTS5, `CROSS JOIN`-Zwang (sonst: „unable to use
  function snippet“).
- **Drei Suchstufen** (`SessionSearchMode` in den Verträgen): `and` (Begriff als
  Präfixwort) → `teil` (Begriff als Teilwort, alle zusammen) → `or` (Begriffe
  einzeln). Ohne `teil` war „Angebot" in „Sonderangebot" unauffindbar — FTS5-
  Präfixe greifen nur am Wortanfang, und deutsch stellt Begriffe ans Wortende.
  Die Stufe wird per Sonde vor dem Ausliefern entschieden, also bleibt sie über
  alle Seiten gleich; die PWA nennt sie sichtbar. Nebenbefund aus dem Fixture-
  Hub: `eventText` indexierte Frage + Kurzzeile doppelt, wenn die Kurzzeile den
  Wortlaut wiederholte — jetzt nur, was nicht schon drinsteht.
- Tests `packages/core/test/transcript-search.test.ts` **17/17** und
  `apps/hub/test/modules/search/search-sessions.routes.test.ts` **8/8**,
  `docs-local.test.ts` **5/5**. Am **echten Bestand** gemessen (Kopie von
  `data/`, 5 Sessions): 15 329 Zeilen in 1,2 s, Abfragen 1–3 ms, inkrementeller
  Nachlauf nach einer neuen Zeile in < 1 s, Fragen und Antworten zuerst.
- **Verträge** `packages/contracts/src/search/search.ts` (SessionTextHit,
  SearchIndexState, UnifiedSearchResponse, DocSearchHit/Engine, Snippet-Marker).
- **Routen**: `GET /api/search/transcript` und `GET /api/search/all`
  (Doku + Sessions in einer Antwort, `scope`, Rollen-Chips, Facetten, Paging),
  `/api/search` antwortet ohne qmd mit lokalem Markdown-Durchlauf
  (`engine:"local"`) statt 501. Hub verdrahtet den Index in `main.ts`
  (Nachlauf alle 5 s, `unref`, Shutdown räumt auf) und an der Route mit
  250 ms Frische — ein Zug, der gerade fertig wurde, ist sofort findbar.
- **PWA-Suche** (`apps/pwa/src/features/search/`): ein Feld für den ganzen
  Fundus, Bereichsumschalter Alles / Sitzungen / Doku, Rollen-Chips mit
  Facettenzahl (Standard: Frage + Antwort; Denken/Werkzeug opt-in), „nur dieses
  Projekt“, Fundwort als `<mark>` (Markerzeichen → Preact-Knoten, nie
  innerHTML), Sitzungsblöcke mit Titel/Projekt/seq, „mehr laden“, Stufen-Hinweis
  (`teil`/`or`) und Indexzeile („15 329 Texte aus 5 Sitzungen im Index“).
  Fundstelle in der **eigenen** Sitzung springt im Chat zur Nachricht und holt
  vorher die älteren Seiten nach.
- **E2E**: `e2e/specs/search-sessions.spec.ts` **4/4** (tablet + desktop) —
  Frage und Antwort derselben Sitzung, Markierung, Sprung in den Chat,
  Bereichsumschalter, „nur dieses Projekt“, Dock-Abstand als Zahl. dazu
  `apps/pwa/test/features/search-hits.test.ts` **9/9** und CSS-Ratchet **14/14**.
- **Am laufenden Interface verifiziert** (Krater-Hub auf einer Kopie von `data/`
  mit echtem Bestand, Port 7399, Chromium): Sprung auf seq 19 einer 54 000-
  Ereignisse-Sitzung — ältere Seiten nachgeladen (`minSeq` 5), Fundstelle im
  Viewport (`top` 234, `inViewport` true); „Kurbelwelle Träger“ traf die
  Teilwortstufe und markierte beide Fragmente; Suchfeld ohne UA-✕, letzte Karte
  75 px über der Dock-Leiste (gemessen 496 vs. 571). Screenshots gesehen.
- **P79 im Live-Hub deployed** (`systemctl --user restart ancientvoid-hub`, health 200
  nach 2 s, kein Rückfall): Konfiguration `inference.engines` mit Strata
  (`http://127.0.0.1:8080/metrics`, Schlüssel nur als Dateireferenz), Hub-Log:
  `inference: 1 Engine-Quelle (strata)`, Request-Historie schreibt
  `data/inference-requests.jsonl` (K7). API live geprüft: 932 Anfragen, Prompt
  129,2 Mio, gelesen 2,38 Mio, wiederverwendet 126,8 Mio (Rechnung geht auf),
  KV-Reuse 98,2 %, Decode p50 81,4 / p90 91,7 / Spitze 107,1 (1 Ausreißer,
  ohne Ausr. 93,7), Grenzlaufrate 3.377 tok/s bei R² 1,00, Antwort 7,5 KB.
- **P79 Backend** (Commit `4e92c233`, Branch `feat/p79-inferenz-token-tempo`):
  Vertrag `packages/contracts/src/inference/tempo.ts` (Quellenliste, Snapshot,
  Verteilungszeilen, K5-Kappen), Kern `packages/core/src/modules/inference/`
  (Strata/Halogen/llama.cpp-Adapter, Prometheus-Parser mit Zähler-Deltas,
  Request-Historie als JSONL mit Quellen-Tag, Perzentile mit Tukey-Ausreißern),
  Les-API `GET /api/inference/sources` und `…/snapshot?id=&fenster=`.
  Tests: `packages/core/test/inference.test.ts` **12/12**,
  `apps/hub/test/modules/inference/routes.test.ts` **5/5** (leere Konfiguration →
  leere Liste, unbekannte Id → 404 mit Liste, fehlende Id → 400).
- **P79 PWA** (Commits `1badf763`, `8fffada0`): `features/inference/` (Seite +
  format.ts), **eigener Menüpunkt** „Inferenz“ (Route `/inferenz`, Dock, Sidebar,
  ToolPane), `57-inference.css`, i18n de/en. Im Browser an der ausgelieferten
  Seite geprüft (1280 / 710 / 390 px): Seitenüberlauf null
  (`documentElement.scrollWidth` == Viewport), Tabellenrahmen `scrollWidth ==
  clientWidth` (vorher 893 > 702 — Spitze abgeschnitten), Vollbreiten-Kacheln,
  Leerlauf zeigt „Engine im Leerlauf“ statt nackter „— tok/s“, TTFT-Kachel nennt
  „letzte Anfrage“, Datenalter heißt „gerade gemessen“ / „Daten 2 s alt“.
  E2E `e2e/specs/inference-tempo.spec.ts` **5/5** (Menüpunkt, Verteilung nur bei
  Einzel-Requests, Gegenwerte erklären sich, tote Quelle bleibt sichtbar K9,
  Key nur als Dateireferenz). Format-Tests `apps/pwa/test/inference-format.test.ts`
  **9/9**.
- Gates grün: `lint`, `typecheck` (Hub+PWA), `check:arch`, `check:i18n`,
  `check:context` (nach `npm run docs:reference`).
- tokdeck (extern, `~/repos/tokdeck`) hat jetzt auch einen **Halogen-Adapter**
  (Prometheus + `/health` + `/cache`), 28/28 Tests.

## Bekannte Probleme, die der Live-Betrieb gefunden und behoben hat
- `accept: application/json, text/plain` brachte **Strata dazu, seine
  Prometheus-Exposition statt JSON** zu liefern (`# HELP vll…`). Accept sitzt
  jetzt pro Quellenart; Test hält den Kopf fest.
- Der Tracker wurde in `main.ts` **nach** dem Deps-Objekt erzeugt — die Route sah
  ihn nie („keine Engines konfiguriert“). Erzeugung liegt jetzt vor `createHubApp`.
- Mio-Großzahlen ≥ 100 Mio waren **um Faktor 10 zu klein** (127 Mio → „12,7 Mio“).
- Verlaufslinien zeichneten bei konstanter Serie eine flache Linie (= „stabil“
  vorgetäuscht); jetzt null. Zähler-Engines melden „keine Hardware-Werte gemeldet“,
  die PWA zeigt eine Grenzen-Karte mit den Gründen der Quelle.

## In Arbeit
- **`teil`-Stufe am echten Bestand zeigen**: ein zusammengesetzter Begriff, der
  im Bestand nur in Zusammensetzungen steckt (z. B. „Angebot" dort, wo nur
  „Sonderangebot" steht) — im Fixture und am Kopie-Bestand belegt, am Live-Bestand
  bisher nur `and` beobachtet.
- **Token-Hygiene auf dem Hub**: `p79-vergleich2`, `p79-vergleich3`, `p79-v4`
  liegen seit 21.11. in `data/hub.db`, zwei davon nie benutzt — widerrufen, wenn
  sie nicht mehr gebraucht werden. Und: der GitHub-Zugang auf diesem Rechner ist
  ein klassischer Token mit allen Scopes; ein feingranularer mit Resource owner
  `securesight-ai` (Contents + Pull requests + Issues) wäre angemessener.
- **Lehre fürs Gate** (gemessen, 22.11.): ein PR mit **Merge-Konflikt** zum
  Base-Zweig bekommt **keinen** Workflow-Lauf — GitHub kann den Merge-Commit
  nicht bilden. Da main inzwischen P75 (Sprachausgabe) enthält, stritten sich
  beide Zweige in `apps/pwa/src/shared/api.ts` (Importzeile). Deshalb: nie
  zuerst Actions verdächtigen, erst `pulls/<nr>.mergeable` und Rebase prüfen.
  Nach Rebase + Force-Push lief das Gate sofort.
- **Zugang**: `gh`-Login im GNOME-Keyring (Konto KaiFelixBennett). Fein-granulare
  Token mit Resource owner = persönliches Konto können Org-Repos **nie**
  schreiben (`securesight-ai/AncientVoid` gehört der Organisation) — das war der
  erste Fehlversuch. funktionierend: klassischer Token. Achtung: der aktuelle hat
  alle Scopes; nach Erledigten auf einen feingranularen mit owner
  `securesight-ai` (Contents + Pull requests + Issues) umstellen und rotieren.

## Bekannte Probleme / Risiken
- **Zwei parallele Agenten-Turns derselben Session** haben zeitgleich am Repo
  gearbeitet (der ältere `pi`-Prozess 219360 lief 35 min weiter, während der
  neue 237769 begann). Folge: doppelte i18n-Keys und doppelte api-Methoden,
  jetzt bereinigt. Der Alt-Prozess ist beendet. Meldung des Hub dazu:
  Session-Status wechselte kurz, Hub bleibt gesund (`/api/health` 200).
- Hub-Prozess (PID 59548) ist **Elter des Agentenprozesses**: ein Neustart kann
  diese Agentensitzung beenden. Deshalb: Statusdatei zuerst, Neustart nur
  abgesetzt (`setsid`/`systemd-run --user`) mit Health-Check und Rückrollpfad.
- tokdeck liegt weiter lokal (Port 7474, nur Loopback + Tailscale), kein Remote.

## Betriebswissen auf dem Hub-Rechner (betrifft nicht das Repo, aber den Zugang)
- **Fernzugriff war 21.11. ab 14:20 UTC tot, obwohl alles lief.** GNOME-Leerlauf
  (`idle-delay` 300 s) aktivierte den Screensaver; mutter/xdg-desktop-portal-gnome
  verweigern dann das Erzeugen von Remote-Desktop-Sessions
  (`Session creation inhibited`) — deshalb fielen **Deskflow (InputCapture-Portal)
  und gnome-remote-desktop (RDP) gleichzeitig** aus, während SSH und Hub gesund
  waren. Behoben: `idle-delay 0`, `idle-activation-enabled false`,
  `idle-dim false`, `sleep-inactive-ac-type 'nothing'`, Super+L entbunden, plus
  Keep-Awake-Watchdog (`~/.config/systemd/user/gnome-keep-awake.{service,timer}`,
  30 s, ruft `~/.local/bin/gnome-keep-awake`). Rot-dann-grün bewiesen: Blank
  erzwungen → 7 Portal-Fehler in 10 s → Watchdog deaktiviert → 0 Fehler in 12 s.
- RDP-Port: **3389 = System-Instanz (Greeter), 3390 = echte Wayland-Sitzung.**
  Monitor an `card1-DP-2` angeschlossen lassen — ohne Output kein RDP.
- RAM/VRAM der Modellseite: `strata-host` hält ~92 GiB von 125,7 GiB
  (Expert-Arena, pinned KV, conversation cache), VRAM ~30,2/31,9 GiB, PSI 0.
  Anzeigewahrheit: `MemTotal − MemAvailable` (≈98 GiB) und die klassische
  Formel (≈59 GiB) sind verschiedene Rechnungen — `Mlocked` ≈ 26,6 GiB und
  Shmem werden doppelt gezählt. Werkzeug: Skill `linux-ram-attribution`.

## Live genommen + Skill für den Neustart (22.11., verifiziert)
- PR #270 gemerged (`5701180b`), Hub live auf genau diesem Stand: `version.json` == HEAD,
  `dirty:false`, Health 200 nach 2 s, Inference-Route antwortet (401 ohne Token).
- Live im Browser belegt: Pane-Titel **„Inferenz“** (kein roher Schlüssel mehr), Prompt-Cache
  zeigt nur noch gemeldete Zeilen (6 statt 12), **0** „—“-Werte in den Kacheln, kein
  Overflow; „Im Moment“ zeigt während eines laufenden Requests gehaltene Token 97.316.
- Review-Token widerrufen, Datei geshreddert, ohne Token wieder 401; Browser geschlossen.
- Neuer Skill `hub-neustart-live` (Wachhund, version.json gegen HEAD, K7-Rekonstruktion,
  PWA-Cache beim Blick, Token-Widerruf) + README-Zeile; `check:skills`-Budget 4316 → 4560
  (243 Zeichen neue Beschreibung). `check:skills` OK (19 Skills).

## Titel als roher Schlüssel — Gate-Lücke geschlossen (22.11., verifiziert)
- Live zeigte der Pane-Titel `COMMON.INFERENCE`: P61-Commit `338a82e9` hat
  `common.inference`/`common.inference_title` aus den Katalogen gelöscht. de/en-Parität
  (`check:i18n`) konnte das nicht sehen — beide Kataloge verloren den Schlüssel zugleich.
- Neu im Gate: jeder literal benutzte `t("…")`-Schlüssel muss im de-Katalog stehen
  (Prüfung über `.ts` **und** `.tsx`; die Strings-Ratchet bleibt bei `.tsx`, damit ihre
  Baseline gültig bleibt). Rot-dann-grün belegt: ohne Schlüssel meldet der Gate
  „4 fehlende Schlüssel — ROT“ und die E2E fällt; mit Schlüssel beides grün.
- Außerdem: Prompt-Cache/Gerät/Summen-Kacheln zeigen nicht gemeldete Zeilen nicht mehr
  (kein `—`-Stapel), und eine Karte ganz ohne Messwert wird gar nicht gerendert.
- Belege: `check:i18n` OK, Playwright `inference-tempo` 5/5 (neu: kein roher Schlüssel,
  keine Halogen-Cache-Zeilen bei Strata), Vitest 60/60, Typecheck/Lint/arch/context grün.

## Nachzug P79 — zweite Runde (22.11., verifiziert)
Vier Defekte, die erst der Blick auf die **live gerenderte Seite** gezeigt hat:
- **Auslastung 10.000 %** und **CPU 860 %**: die Engines sind uneinheitlich — Strata
  meldete `gpu_util` schon als 0,87 und als 100, `cpu` als 56 und als 860 (Summe über
  alle Kerne). Neu: `anteilNormalisieren()` im Kern (0..1, 0..100, Kern-Summe),
  unplausibel bleibt null. Live jetzt 6 % / 1,8 %.
- **Verlaufs-Linien liefen aus ihrer Box**: `verlauf()` zeichnet in 32 Höhe, der
  `viewBox` der neuen Karte hatte 26 → LinienMal überlappen die Beschriftung. Gemessen:
  SVG-Höhe jetzt 32, Reihen ohne Überlappung.
- **`pcie_frac` kam als String** (`"0.15"`) → Feld verschwand still. `num()` nimmt jetzt
  zahlenreiner Text, sonst null.
- **„Letzte Anfragen" ohne Zeit**: die Requests standen anonym da, obwohl `at` im Vertrag
  liegt und der i18n-Schlüssel existierte. Jetzt erste Spalte `Zeit` (HH:MM:SS, hour12:false).
- Layout: Container-Breakpoints auf 560/700/1024 (Seitenpane ist schmaler als der Viewport —
  bei Viewport 710 misst das Pane nur 362 px, dort ist einspaltig richtig), drei Werte-Spalten
  erst ab 1024 px, Live-Kachel hält zwei breite Spalten für Textwerte (Phase).
Belege: Kern 17/17, PWA-Format 10/10, Playwright `inference-tempo` 5/5 (Desktop + Mobile,
inkl. Zeitspalte), Typecheck/Lint/i18n/arch/context grün, Screenshots 1280/710/390 ohne
Überlauf und ohne geklemmte Zellen.

## Nachzug P79 (22.11., verifiziert)
- Inferenz-Seite war gegen tokdeck unvollständig. Nachgezogen und im Live-JSON des
  echten Strata geprüft: Engine-Bauart (Kontext, KV `int8`, Experten 10 116/24 576,
  Arena 47 962 MiB, Batch-Slots, Drafting `mtp`, Spec 6, Vorbehandlungskappe,
  Pool-Worker, PCIe-Anteil), Slot-Halt (größter Slot), CPU 56 % + Disk, RAM live statt
  Verlaufsrest, Sekunden-Reihen als eigene Karte, PCIe getrennt nach **Slot-Max Gen 4
  × 16 bei Karte Gen 5** — der Engpass sitzt im Mainboard, nicht in der GPU.
- Messlatte: Kern 15/15, PWA-Format 9/9, E2E `inference-tempo` 5/5 (neue Assertions),
  Typecheck/Lint/i18n/arch/context grün.

## Einsatzstand (21.11., verifiziert)
- PR #264 ist gemerged (`11aeb4fe`), Quellzweig gelöscht. Der Hub läuft auf `main`
  (`4fa1f921`), ausgelieferte `version.json` == HEAD, `dirty:false`, health 200 nach 2 s.
- Nach dem Neustart rekonstruiert der Tracker die Request-Historie aus dem JSONL
  (`inference: 179 Requests rekonstruiert`) und schreibt weiter — K7 im Live-Betrieb.
- Wachhund: `/tmp/hub-neustart.sh` (Rückfall auf den zuletzt gesunden Stand, danach
  `git checkout main`).

## Terminal-Tab live genommen (23.11., verifiziert)
- PR #348 gemerged (`5dcd2525`; danach #349–#355 bis `a25ff1bf`), Hub live auf
  genau diesem Stand: `version.json` == HEAD, `dirty:false`, health 200 nach 2 s
  (Wachhund `/tmp/hub-sicher-neustart.sh`, Rückfall-Stand `9cde7892` nicht gebraucht).
- K7 nach dem Neustart: `recovery finished, recovered:6, failed:0`; laufende
  Session schreibt weiter (events.jsonl 1663 → 1665 Zeilen in 6 s).
- Live-PWA (Chromium, Service-Worker + Caches vorher entfernt, Gerätetoken
  danach widerrufen, Route ohne Token wieder 401): Terminal-Tab listet die
  Allowlist (evox2, Hub-Host) **plus** automatisch erkannte Shells des Hub-Hosts
  (sh, git-shell, rbash, systemd-home-fallback-shell — zsh/fish nicht installiert,
  bash vom Config-Ziel belegt); „Einfügen“/„Kopieren“-Knöpfe vorhanden, Verbindung
  auf lokalem bash steht, Puffer ohne ^V-Artefakte. Tastatur-Paste ist per
  Playwright-E2E belegt („Ctrl+V fügt ein und Enter führt aus“, rot ohne Fix);
  Headless-Chromium verweigert ohne Clipboard-Rechte den Systemclipboard-Weg —
  dort läuft der Knopf-Pfad auf den ehrlichen Fehlerhinweis.
- BUG-0273 (Strg+V wirkungslos) damit erledigt; Issue #347 vom Merge geschlossen.

## Wiederaufnahme nach Hub-Neustart (falls diese Antwort abbricht)
- Der Hub ist ein systemd-User-Service (`ancientvoid-hub.service`, `Restart=always`,
  `KillMode=process`) — Session-Worker überleben, der Hub kommt von allein hoch.
- Nach dem Neustart prüfen: `systemctl --user is-active ancientvoid-hub`,
  `curl -s 127.0.0.1:7373/api/health`, `curl -s 127.0.0.1:7373/version.json`
  (sha muss auf `feat/p79-inferenz-token-tempo` zeigen), `/tmp/hub-neustart.log`.
- Falls der Wachhund zurückgerollt hat (`HEAD` = Rückfall-Stand): `git checkout main`,
  Ursache im Log suchen, dann neu starten. Der Zweige-Zweig `feat/p79-…` existiert
  nicht mehr — P79 liegt in `main` (PR #264).
- Konfigurations-Backup: `/tmp/hub.config.vor-p79.json`.

## Nächste Schritte
1. `git fetch origin` → `origin/main` in `feat/p79-inferenz-token-tempo` mergen,
   Gates erneut (lint/typecheck/gezielte Tests).
2. `npm run -w @ancientvoid/pwa build`.
3. `hub.config.json`: Abschnitt `inference` ergänzen.
4. Neustart-Skript `/tmp/hub-sicher-neustart.sh` (detached): stoppen, starten,
   Health-Check; bei Ausfall Rückkehr auf den vorherigen Stand und erneuter
   Start. Log: `/tmp/hub-neustart.log`.
5. Live-Review der Seite im Browser (1280 / 710 / 365 px) mit echten
   Strata-Zahlen; Mängel beheben.
6. Push/PR, sobald GitHub-Zugang vorhanden.

## Entscheidungen
- **Eigene Spur neben `aimetrics` (P59), nicht dort andocken**: P59 liefert
  skalarisierte Felder im 10-s-Takt; Verteilungen brauchen eine engmaschige
  Request-Historie. Preis: ein zusätzlicher `/metrics`-Abruf je Engine und Takt.
  Begründung im Epic `epics/EPIC-P79-inferenz-token-tempo.md`.
- **Historie pro Quelle getrennt** (Feld `source` in jedem Request-Datensatz):
  gemischte Perzentile über zwei Engines wären eine falsche Aussage — durch den
  Test gefunden und korrigiert.
- **Keine erfundenen Verteilungen**: Engines ohne Einzel-Requests (llama.cpp,
  Halogen) liefern `features.perRequest=false`, die Seite zeigt den Grund.
- **PWA im Hautton der App**, nicht als schwarzes Terminal: übernommen ist die
  Disziplin (Herkunft an jeder Zahl, fehlende Blöcke verschwinden), nicht die
  Green-on-Black-Optik von tokdeck.

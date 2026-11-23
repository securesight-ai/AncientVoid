# EPIC-P52 — Repo-Galaxie: der Graph als navigierbare Galaxie

**Status:** Code steht, Exit offen (Frame-Abstand unter Interaktion und vollständiger Gate-Nachweis) · **Phase:** P52 · **Dauer:** 1,5–2,5 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — baut auf P48 (Repo-Graph, umgesetzt), ADR-0062 und dem
Fensterprotokoll (ADR-0053) auf. Nutzerauftrag vom 12.11.2026, läuft quer zur Kette (Präzedenz
P47–P51). Berührungspunkt mit P43 §3.5 (Reiter der Session): wer zuerst merged, zieht den anderen nach.

Quelle: Nutzermeldung vom 12.11.2026: „Die Graph-Ansicht sieht nicht gut aus, alles ist in einem
Rechteck angeordnet. Ich hätte es gern eher wie eine Galaxie (Vorbild: mein Repo `brain-galaxy`),
simpel gehalten, gut navigierbar: exakt sehen, welche Dateien wie zusammenhängen, Dateien suchen
und finden. Am Handy im Graph-Modus so viel Bildschirm wie möglich nutzen.“
Vorbild gesichtet: `~/notes/brain-galaxy` (Themen als Spiralgalaxien mit hellem Kern,
Verbindungen als Filamente, Hineinzoomen in eine Galaxie mit Brotkrumen, deterministisches,
überlappungsfreies Layout). **Übernommen wird die Gestaltungsidee, kein Code und keine
3D-Technik.** Code-Befund heute: `graph-model.ts` klemmt Knoten an die Ränder der Zeichenfläche
(`PAD`) und passt am Ende in das Rechteck ein; daher die Kastenform. Suche und eine Ansicht
„was hängt an dieser Datei“ gibt es nicht; am Handy teilt sich der Graph den Schirm mit
Kopfzeile, Reitern und Dock.

## 1. Ziel

Der Repo-Graph sieht aus wie eine Galaxie und beantwortet drei Fragen ohne Umweg: **Wo liegt
diese Datei?** (Suche, Hinflug), **Womit hängt sie zusammen?** (Fokus mit eingehenden und
ausgehenden Verbindungen, als Bild und als Liste) und **Wie ist das Repo gegliedert?** (Bereiche
als eigene Sternsysteme, hineinzoomen und zurück). Am Handy füllt der Graph den ganzen Schirm.
Alles, was P48 kann, bleibt. Messlatten: K2 (flüssig, auch bei 4000 Dateien), K3-nah (Datei
öffnen in einem Tipp), K10 (ehrliche Zustände, Bewegung reduzierbar).

## 2. Scope (In / Out)

**In:** neues, reines Galaxie-Layout (Bereiche als Spiralsysteme, runde Gesamtform, deterministisch,
überlappungsfrei); Darstellung als Sternfeld mit Detailstufen je Zoom; Fokus auf eine Datei mit
Richtungsanzeige und Nachbarliste; Suche mit Hinflug; Hineinzoomen in einen Bereich mit
Brotkrumen; Vollbild-Graph am Handy mit schwebender Bedienung und Blatt von unten; Tastatur am
PC; Erhalt aller P48-Funktionen (Legende/Filter, tote Dateien, „Prüfen“ mit roten Knoten,
Kappungs-Hinweis, Datei öffnen, eigenes Fenster, Farbgruppen, Akzentfarbe).

**Out:** 3D/WebGL/three.js und jede neue Abhängigkeit (Canvas 2D bleibt, ADR-0062); Hand- und
Sprachsteuerung aus `brain-galaxy`; Themen-Erkennung über Community-Algorithmen (Bereiche kommen
aus dem Pfad); Änderungen am Graph-Contract oder an der Erhebung im Core (`GraphReport` bleibt,
alles Neue wird im Client aus `path`, `in`, `out`, `edges` abgeleitet); Pfadsuche zwischen zwei
Dateien, Zeitreise, Bearbeiten von Dateien; Fleet-/Remote-Graph über den Stand von P48 hinaus.

## 3. Design-Details

### 3.1 Gestaltungsprinzip: wenig Bild, viel Antwort
Die Galaxie ist Mittel, nicht Zweck. Drei Regeln: (1) **Ruhe im Überblick** — herausgezoomt
sieht man Systeme, Kerne und wenige helle Filamente, keine 4000 Linien. (2) **Schärfe im
Fokus** — wer eine Datei wählt, sieht genau ihre Verbindungen, alles andere tritt zurück.
(3) **Jede Bildaussage steht auch als Text** — Nachbarliste, Zähler, Namen; niemand muss
Linien zählen.

### 3.2 Layout (rein, `features/graph/galaxy-layout.ts`)
- **Bereiche („Systeme“)** aus dem Pfad: bei `packages/<x>/…` und `apps/<x>/…` die ersten zwei
  Segmente, sonst das erste Segment; Dateien in der Wurzel bilden das System „Wurzel“.
  Systeme mit weniger als 4 Dateien wandern in ein Sammelsystem „Übriges“. Die Regel ist eine
  kleine, getestete Funktion und bewusst nicht konfigurierbar (YAGNI); reicht sie in einem
  echten Repo nicht, ist das ein Befund für ein Folge-Epic.
- **Im System:** Dateien nach Grad (`in + out`) absteigend, bei Gleichstand nach Pfad. Die
  stärksten bilden den **Kern** (dichte Scheibe), der Rest liegt auf **zwei Spiralarmen**
  (logarithmische Spirale, Abstand wächst mit dem Rang; Platzierung per goldenem Winkel im
  Kern). Mindestabstand zwischen Sternen ist garantiert (keine Überlappung, Test bis 10 000).
  Systemradius wächst mit der Wurzel der Dateizahl.
- **Zwischen Systemen:** das System mit den meisten Verbindungen nach außen liegt in der Mitte,
  die anderen auf Ringen darum, stärker verbundene näher beieinander (wenige Schritte einer
  Kraftrelaxation **nur über Systemkreise**, höchstens einige Dutzend Körper, danach
  eingefroren). Systeme überlappen nie. Die Gesamtform ist rund; **nichts wird an die
  Zeichenfläche geklemmt**. Die Kamera passt den Umkreis ein.
- **Deterministisch:** gleiche Knoten und Kanten ⇒ gleiches Layout, unabhängig von Reihenfolge
  und Fenstergröße (Saat aus Pfad-Hash wie heute). Das Layout rechnet in eigenen Weltkoordinaten;
  Breite und Höhe gehen nur noch in die Kamera ein. Rechenzeit ≤ 150 ms bei 4000 Dateien auf dem
  Messgerät, sonst in rAF-Portionen wie heute.
- `graph-model.ts` (`computeLayout`) entfällt erst, wenn das neue Layout alle Tests trägt.

### 3.3 Darstellung
- **Sterne:** Größe aus dem Grad (gedeckelt), Farbe aus der Gruppe wie in P48 (`--accent`,
  `--graph-code`, `--graph-config`, `--graph-other`), weicher Schein; Kernsterne heller. Tote
  Dateien gedimmt, Fehlerknoten `--err`. Hintergrund `--bg` mit kaum sichtbarem Systemnebel in
  der jeweiligen Mehrheitsfarbe.
- **Filamente:** herausgezoomt nur **gebündelt zwischen Systemen** (eine Linie je Systempaar,
  Stärke nach Anzahl); ab mittlerem Zoom die Kanten der sichtbaren Sterne, dünn und leise. Die
  Lichtpulse aus P48 bleiben, laufen aber nur im sichtbaren Ausschnitt und im Fokus.
- **Detailstufen:** (1) fern: Systemnamen, Kerne, Bündel; (2) mittel: alle Sterne, Namen der
  gradstärksten; (3) nah: Namen aller sichtbaren Sterne (Dateiname, Pfad im Blatt). Namen
  überdecken sich nicht (einfache Kollisionsprüfung, wichtigere zuerst).
- **Bewegung mit Bedeutung:** Schein-Puls leise wie heute; Kameraflug 400–600 ms bei Suche,
  Fokus und Hineinzoomen. „Bewegung reduzieren“ (System und Einstellung): kein Puls, keine
  Partikel, Kamerasprung statt Flug.

### 3.4 Navigation: genau sehen, was zusammenhängt
- **Auswahl** (Tipp/Klick auf Stern): der Stern und seine direkten Nachbarn bleiben hell, alles
  andere fällt auf 15 % Deckkraft; Kanten des Sterns werden deutlich gezeichnet, **eingehend**
  und **ausgehend** unterscheidbar durch Farbe **und** Laufrichtung der Pulse **und**
  Pfeilspitze (nie nur Farbe). Die Kamera rahmt Stern samt Nachbarn.
- **Blatt/Seitenfeld zur Auswahl:** Dateiname, Pfad, Gruppe, Hinweise (tot, Fehlerzahl), Taste
  „Öffnen“ (wie heute: Datei-Reiter bzw. Datei-Fenster), darunter zwei Listen **„Wird verwendet
  von (n)“** und **„Verwendet (n)“** mit Art der Kante (Import, Verweis, Asset). Tipp auf einen
  Listeneintrag wählt diesen Stern (Hinflug), so wandert man Verbindung für Verbindung. Ein
  Schalter „2 Schritte“ zeigt zusätzlich die Nachbarn der Nachbarn (schwächer).
- **Suche:** Feld (Handy: Lupe oben, PC: `/` oder Strg+F in der Graph-Fläche). Treffer nach
  Dateiname vor Pfad, unscharf über Teilfolgen, höchstens 50, mit Gruppe und System. Auswahl
  fliegt hin und wählt aus. Kein Treffer ist ein sichtbarer Zustand. Die Suche durchsucht den
  geladenen Graphen, keinen neuen Index.
- **Bereiche:** Tipp auf einen Systemnamen (oder Doppeltipp ins System) zoomt hinein;
  Brotkrume „Repo › packages/core“; „Zurück“ bzw. Esc zoomt hinaus. Filter-Chips (Gruppen, „nur
  tote“, „nur Fehler“) dimmen statt zu entfernen, damit die Lage stabil bleibt.
- **Gesten/Tasten:** Ziehen verschiebt, Pinch/Rad zoomt um den Zeiger, Doppeltipp zoomt hinein,
  Taste „Einpassen“. PC: Pfeiltasten wandern zum nächsten Nachbarn in der Richtung, Enter öffnet,
  Esc hebt Auswahl bzw. Ebene auf. Kürzel werden bei der Registry aus P51 angemeldet, sobald
  sie existiert.
- **Zugänglichkeit:** Die Listen im Blatt sind der vollwertige Weg ohne Zeiger; die
  DOM-Trefferflächen aus P48 (E2E/Tastatur) bleiben für die sichtbaren, gradstärksten Sterne.

### 3.5 Handy: der Graph bekommt den ganzen Schirm
- Im Graph-Reiter auf schmalen Geräten (< 700 px) startet der **Vollbild-Modus**: Kopfzeile,
  Reiter, Statuszeile, Composer und Dock sind ausgeblendet, die Zeichenfläche füllt
  `100dvh` unter Beachtung der sicheren Ränder; Quer- und Hochformat.
- **Schwebende Bedienung, vier Elemente:** oben links „Zurück“ (verlässt den Modus, zurück zum
  vorigen Reiter), oben rechts Lupe und „Mehr“ (Filter/Legende, Prüfen, Einpassen, eigenes
  Fenster am PC); die Brotkrume erscheint nur innerhalb eines Systems. Trefferflächen ≥ 44 px,
  halbtransparent, nach 4 s ohne Berührung auf 40 % Deckkraft.
- **Blatt von unten** für die Auswahl: eingeklappt eine Zeile (Name, Zähler, „Öffnen“),
  aufgezogen die Nachbarlisten bis zur halben Höhe; der Graph bleibt darüber bedienbar und
  rahmt die Auswahl in den freien Teil.
- Die System-Zurück-Geste/-Taste schließt in dieser Reihenfolge: Blatt → Auswahl → System →
  Vollbild (über die bestehende Hash-Route, kein eigener Verlauf).
- Hinweise wie Kappung oder Diagnosequellen erscheinen als einzeiliger, wegtippbarer Streifen
  bzw. im „Mehr“-Blatt, nie als dauerhafte Leiste.
- Tablet/PC: kein erzwungener Vollbild-Modus; dort gibt es eine Taste „Vollbild“ in der
  Graph-Fläche, das Auswahlfeld liegt rechts als Seitenfeld (320 px).

### 3.6 Erhalt und Grenzen
- Funktionsliste P48, die nachweislich bleibt: Legende mit Zählern, tote Dateien, „Prüfen“
  (Diagnosequellen, Fehlerzähler, rote Knoten), Kappungs-Hinweis mit Zahlen, Tooltip am PC,
  Datei öffnen, Graph als eigenes Fenster, Einstieg von der Übersichtskarte, Hash-Route.
  `e2e/specs/repo-graph.spec.ts` bleibt grün oder wird im selben Commit mit dem Weg angepasst.
- Zustand der Ansicht (Kamera, Auswahl, System, Filter) ist Gerätezustand je Ziel, kein
  Session-Zustand (K7); nach Reload sitzt die Kamera wieder dort.
- Kosten je Bild proportional zu den sichtbaren Sternen; herausgezoomt wird gebündelt statt
  gezeichnet. Kein Bild > 16 ms im Leerlauf bei 4000 Dateien auf dem Messgerät, sonst senkt die
  Darstellung die Detailstufe sichtbar („vereinfachte Darstellung“), nie stilles Ruckeln.

## 4. Aufgaben (Checkliste T52.m)

- [x] **T52.1** Galaxie-Layout als reine Funktion mit Unit-Tests: Systemregel, Kern/Arme, Mindestabstand (Property-Test bis 10 000 Knoten), Systeme überlappungsfrei, Determinismus unabhängig von Reihenfolge und Fenstergröße, Zeitbudget. **K2**.
- [x] **T52.2** Darstellung: Sternfeld, Nebel, gebündelte Filamente, drei Detailstufen, Namen ohne Überdeckung, Kamera mit Einpassen/Flug, „Bewegung reduzieren“; `computeLayout` ablösen. **K2/K10**.
- [x] **T52.3** Fokus: Auswahl mit Dimmen, Richtungsanzeige (Farbe + Laufrichtung + Pfeil), Auswahlfeld/Blatt mit beiden Nachbarlisten, Wandern über die Liste, Schalter „2 Schritte“. **K3**.
- [x] **T52.4** Suche mit Hinflug, Trefferliste, Leerzustand; Bereiche mit Hineinzoomen, Brotkrume, Zurück; Filter dimmen statt entfernen. **K2**.
- [x] **T52.5** Handy-Vollbild: Ausblenden der Session-Bedienung, schwebende Bedienung, Blatt von unten, Zurück-Reihenfolge, Quer-/Hochformat; „Vollbild“-Taste und Seitenfeld auf Tablet/PC. **K2**.
- [x] **T52.6** Erhalt P48: Legende/Filter, tote Dateien, Prüfen, Kappung, eigenes Fenster, Karten-Einstieg; Tastatur am PC; Ansichtszustand je Ziel wiederherstellen. **K7/K10**.
- [x] **T52.7** Abnahme: `e2e/specs/repo-galaxie.spec.ts` (Handy/Tablet/PC), K2-Messlauf (Skill `messlauf`, 400/4000 Dateien, Leerlauf und Zoom), Vorher-/Nachher-Bilder unter `docs/assets/`, Geräteabnahme am Handy, Retro. **K2/K10**. — Spec, Messlauf und Bilder auf `main` (13.11.); Geräteabnahme am Handy nach P000 verschoben; Rest siehe T52.8.
- [ ] **T52.8** Messlauf-Nachtrag: Bildzeit p95 bei 4000 Dateien (AC-P52-6 teilweise); PC-Kachel: gespeicherten Stand nach Reload erneut prüfen (AC-P52-8 teilweise). **K2/K10**.

Reihenfolge: T52.1 → T52.2 → T52.3 → T52.4 → T52.5 → T52.6 → T52.7; je Aufgabe eigener Branch/MR.

## 5. Acceptance Criteria (AC-P52-k)

- **AC-P52-1:** Das Layout ist rund und in Systeme gegliedert; kein Stern liegt näher als der Mindestabstand an einem anderen, kein System überlappt ein anderes (Property-Test); gleiche Eingabe ergibt byte-gleiche Positionen bei jeder Fenstergröße.
- **AC-P52-2:** Eine Datei ist über die Suche in höchstens drei Interaktionen gefunden, angeflogen und ausgewählt (Spec auf Handy und PC); „kein Treffer“ ist sichtbar.
- **AC-P52-3:** Für eine ausgewählte Datei zeigen Bild und Listen dieselben Nachbarn; ein- und ausgehend sind ohne Farbe unterscheidbar; die Zähler stimmen mit `in`/`out` des Reports überein (Spec gegen Fixture-Repo).
- **AC-P52-4:** Am Handy (412×915 und quer) belegt die Zeichenfläche im Graph-Modus die volle Fläche abzüglich sicherer Ränder; keine Kopfzeile, Reiter oder Dock sichtbar; jede Bedienfläche ≥ 44 px; Zurück schließt in der Reihenfolge Blatt → Auswahl → System → Vollbild.
- **AC-P52-5:** Alle P48-Funktionen aus §3.6 sind erreichbar (Spec je Funktion); Graph im eigenen Fenster verhält sich gleich.
- **AC-P52-6:** K2-Messlauf: bei 4000 Dateien Layout ≤ 150 ms bzw. portioniert ohne blockierten Hauptfaden > 50 ms, Leerlauf-Bild ≤ 16 ms p95, Zoom/Pan ohne Bild > 33 ms p95 auf dem Messgerät; bei Überschreitung sichtbare vereinfachte Darstellung.
- **AC-P52-7:** Mit „Bewegung reduzieren“ läuft keine Schleifenanimation und kein Kameraflug; jede Aussage bleibt lesbar.
- **AC-P52-8:** Kamera, Auswahl, System und Filter überleben Reload und Fensterwechsel je Ziel.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Schön, aber unlesbar** (zu viele Linien, zu wenig Text) → Bündelung im Überblick, Detailstufen, jede Aussage zusätzlich als Liste; AC-P52-3 prüft Bild gegen Liste.
2. **Die Pfadregel für Systeme passt nicht zum echten Repo** (ein Riesensystem, viele Zwerge) → Sammelsystem für Kleine, Test gegen dieses Repo und ein flaches Fixture; Befund statt Konfigurationsschalter.
3. **Handy-Vollbild sperrt den Nutzer ein oder frisst die Zurück-Geste** → feste Schließ-Reihenfolge über die Hash-Route, „Zurück“ immer sichtbar, Spec für jede Stufe.
4. **4000 Dateien ruckeln am Handy** → Kosten nur für Sichtbares, Bündel statt Kanten im Überblick, Messlauf als Gate, sichtbare Vereinfachung.
5. **P48-Funktionen gehen beim Umbau verloren** → Erhalt-Liste §3.6 als Specs vor dem Umbau grün (heutige Wege), Umbau ändert Weg und Test gemeinsam.
6. **Kollision mit P43 (Reiter, Herauslösen) und P51 (Kürzel)** → Änderungen an `SessionTail` auf das Ein-/Ausblenden im Graph-Modus begrenzen; Kürzel erst an die Registry hängen, wenn sie da ist; wer zuerst merged, zieht nach.
7. **Layout springt bei jeder Dateiänderung** → Systeme und Rang sind stabil gegen kleine Änderungen (Sortierung nach Grad, dann Pfad); Kamera bleibt, Auswahl bleibt, neue Sterne erscheinen ohne Neuflug.

## 7. Definition of Done

Alle T52.* und AC-P52-* mit aktueller Evidenz. `npm run gate` und PWA-Build grün; Pipeline-Job
`e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt.
Jede neue UI-Funktion und jeder Ablauf hat einen Spec in `e2e/specs/`; Geräteabnahme am Handy
separat, Skip ≠ Pass. Kein neuer Contract, keine neue Abhängigkeit; `design-system.md` und der
Graph-Abschnitt der Doku beschreiben den neuen Stand; K2-Messlauf abgelegt; die Graph-Ansicht
ist über Karte, Reiter, eigenes Fenster und Hash-Route erreichbar. Kein TODO ohne Epic-Bezug.
Retro (Skill `retro`) angehängt.

## Retro

Zeitraum 2026-11-12 bis 2026-11-13. T52.1 lag schon auf main (`galaxy-layout.ts`). T52.2–T52.7 liegen auf `feat/p52-galaxie-darstellung`, ein Branch statt sieben, weil die Session den Epic-Abschluss in einem Merge bekommen hat.

| AC | Stand | Beleg |
|---|---|---|
| AC-P52-1 | erfüllt | `galaxy-layout.test.ts` |
| AC-P52-2 | erfüllt | `repo-galaxie.spec.ts` „Suche, Nachbarn und Filter“ auf mobile, tablet, desktop |
| AC-P52-3 | erfüllt | derselbe Spec, Zähler `Verwendet (1)` / `Wird verwendet von (1)` gegen `src/main.ts` → `src/auth.ts` |
| AC-P52-4 | teilweise | Viewport 412×915 und 915×412 in „System, Zurück-Reihenfolge und Vollbild“; kein Lauf auf einem physischen Handy |
| AC-P52-5 | erfüllt | `repo-graph.spec.ts` auf mobile und desktop, Klick öffnet über „Datei öffnen“ |
| AC-P52-6 | teilweise | Layout-Median 13,5 ms bei 4000 Dateien, [Messlauf](../docs/messlauf/2026-11-13-p52-galaxie-k2.md); Bildzeit p95 nicht gemessen, Deckel im Code (`FRAME_BUDGET_MS`) |
| AC-P52-7 | erfüllt | `data-motion=off` im Spec „Ansicht überlebt Reload“ |
| AC-P52-8 | teilweise | Reload auf der Hash-Route (mobile) stellt die Auswahl wieder her; die PC-Kachel verwirft die Graph-Route beim Neuladen, der gespeicherte Stand ist dort nicht erneut geprüft |

Nachher-Bild: [docs/assets/p52-galaxie-handy.png](../docs/assets/p52-galaxie-handy.png). Ein Vorher-Bild des Klemmlayouts gibt es nicht mehr, der Stand ist mit diesem Branch ersetzt.

Premortem: unlesbar (1) nicht eingetreten — Namen und Listen. Pfadregel (2) nicht am echten Repo geprüft, nur am Fixture und am Property-Test. Vollbild-Falle (3) nicht eingetreten im Spec. Ruckeln (4) offen, weil die Bildzeit fehlt. P48-Verlust (5) nicht eingetreten. Kollision mit P43 (6) nicht eingetreten, `SessionTail` nur um die Klasse `graph-full` ergänzt. Layout-Sprung (7) nicht beobachtet.

Erkenntnisse:

1. Die reine Layout-Funktion war der schnelle Teil; die Kamera und die Listen haben die Specs getragen.
2. Auf der PC-Kachel überlebt `#/sessions/…/graph` einen Reload nicht. Das ist älter als diese Galaxie und hat den Persistenz-Spec auf dem Desktop-Projekt scheitern lassen.
3. Ein Playwright-Viewport ist kein Gerät. Die DoD-Zeile „Skip ≠ Pass“ bleibt für das physische Handy offen.

Action Items:

- AI-P52-1: Bildzeit p95 im Browser bei 4000 Dateien messen und an den Messlauf hängen — zurück als: nächste Messaufgabe, kein neues Epic.
- AI-P52-2: Graph-Route auf der PC-Kachel über Reload halten — zurück als: Bug, sobald es jemanden beim Arbeiten stört.
- AI-P52-3: Abnahme auf einem physischen Handy — zurück als: offene DoD-Zeile dieser Epic, kein neues Epic.


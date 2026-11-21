# ADR-0092 — die Diktat-Aufnahme bleibt da, damit sie neu erkannt werden kann

## Lage

Seit ADR-0090 (und BUG-0214) sagt der Hub ehrlich, ob die eigene Spracherkennung läuft.
Aber: war sie in dem Moment nicht erreichbar, war das Diktat weg — die Aufnahme wurde nach
dem Versuch verworfen, und der Mensch sollte nochmal sprechen. Ebenso ärgerlich nach dem
Modellwechsel (large-v3-turbo → large-v3) oder wenn ein Durchlauf ein Fachwort verhört hat:
das gesprochene Audio existierte gerade eben noch, ist aber nirgends mehr.

Der Ton liegt in der App vor, bevor er überhaupt zum Hub geht — `LocalRecorder` hält die
Chunks als Blob. Genau dort wird angesetzt.

## Entscheidungen

1. **Aufnahme bleibt auf dem Gerät, nicht am Hub.** Die Rohaufnahme (Opus/WebM, wie sie der
   `MediaRecorder` liefert) wandert in IndexedDB (`ancientvoid.stt-recordings.v1`). Kein
   Endpoint, keine Sync, kein Sessions-Teilen. Sprache verlässt das Gerät nur, wenn sie
   erkannt wird — speichern ist lokal.
2. **Wenige, kleine, wegwerfbare Stücke.** Merkwürdig sind die **drei** neuesten Aufnahmen,
   höchstens 12 MB gesamt; das Älteste fliegt zuerst. Aufnahmen sind kein Archiv und werden
   durch Löschen der Browserdaten entsorgt.
3. **Gemerkt wird, was unser Rekorder hatte — Erfolg wie Misserfolg.** Eine gelungen lokal
   erkannte Aufnahme darf neu erkannt werden (besserer Durchlauf, anderes Modell). Eine
   **fehlgeschlagene** (Erkennung nicht erreichbar, leeres Ergebnis) bleibt ebenso liegen und
   kann später neu erkannt werden, sobald die Erkennung wieder läuft.
4. **Nicht gemerkt: der Browser-/Cloud-Weg.** Nutzt die App die Browser-Erkennung, gehört das
   Mikro dem Browser; wir haben die Bytes nie. Das ist eine ehrliche Grenze, kein Fehler.
5. **Neu-Erkennung nutzt denselben Weg wie bisher:** `POST /api/stt` → Hub → whisper.cpp
   auf der Radeon. Kein zweiter Endpunkt, kein zweiter Token, kein Cloud-Umweg.
6. **Ersetzen statt Anhäufen — aber nur wenn nichts kaputtgeht.** Der neue Text ersetzt den
   alten im Feld **nur dann**, wenn der alte dort noch unverändert steht. Hat der Mensch
   inzwischen von Hand edited, wird der neue Text angehängt und die Blende sagt das. Kein
   stilles Überschreiben von Handarbeit.
7. **Sichtbar und wegwerfbar.** Solange eine Aufnahme wartet, steht über dem Nyx-FAB eine
   Zeile: „Aufnahme gemerkt (12 s) — neu erkennen / weg“. Sie verschwindet von selbst, wenn
   die Aufnahme neu erkannt wurde oder mit „weg“ verworfen wird.

## Abgewogen

- *Warum nicht gleich automatisch neu erkennen?* Weil der zweite Durchlauf Zeit kostet und
  der erste Text schon brauchbar sein kann. Die Entscheidung bleibt beim Menschen; die
  Gelegenheit ist aber da, statt das Audio wegzuwerfen.
- *Warum nicht am Hub speichern?* Der Hub kennt Sessions und Projekte; eine Rohaufnahme dort
  wäre ein neuer, personenbezogener Datenbestand mit Löschpflicht — für einen Nutzen, den
  das Gerät auch ohne ihn hat.

## Grenze (bewusst)

Die App ist ein Browser-Fenster: Was der Browser nicht hatte (Browser-Erkennung, andere
App), kann sie nicht neu erkennen. Und nach drei neuen Diktaten ist die älteste Aufnahme weg.

## Nachtrag 2026-11-21 — zurückgebaut

Nutzerentscheidung: die Zeile „Aufnahme gemerkt (Ns) — neu erkennen / weg“ über den
Composer-Knöpfen nahm Platz weg und lenkte ab; sie ist entfernt. Damit entfiel die einzige
Oberfläche der Neu-Erkennung — und mit ihr die ganze Vorhaltung: Der Stash
(IndexedDB), das Speichern nach dem Diktat und die Neu-Erkennung sind aus der PWA
entfernt, Aufnahmen werden wieder verworfen. Die Entscheidungen oben gelten damit als
überholt; ein Wiederaufbau braucht ein neues ADR.

## Nachtrag 21.11.2026 (Abend) — Wiederaufnahme in der Ablage

Zweite Nutzerrunde am selben Tag: Der Platz über den Composer-Knöpfen bleibt frei, aber
die Neu-Erkennung ist es wert, greifbar zu bleiben. Die gemerkte Aufnahme liegt weiter
wie in den Entscheidungen oben (drei Stück, 12 MB, nur dieses Gerät), heißt jetzt
**Sprachnachricht** und wird im Ablage-Blatt geführt — eigener Abschnitt unter den
Stufen, Aktionen „neu erkennen“ und „weg“. Die Zahl am Ablage-Knopf im Composer zählt
sie mit; am Eingabefeld selbst steht nichts mehr. Die Ersetzen/Anhängen-Regel
(Entscheidung 6) gilt unverändert.

---
id: BUG-0281
slug: geraetekennung-am-desktop-heisst-handy
status: done
severity: S3
area: pwa
instance: dev
commit: pending
forge: "https://github.com/securesight-ai/AncientVoid/issues/414"
epic: P3
created: 2026-11-24
reporter: Kai
---

# BUG-0281 — Am Desktop steht „Du · handy" über der eigenen Nachricht

## Gesehen

Kai am Desktop-Browser: „Warum wird angezeigt, dass ich auf dem Handy bin,
obwohl ich am Desktop bin?" Die Meta-Zeile seiner eigenen Nachricht zeigt
nämlich das **Gerätekürzel**, und sein Desktop-Browser benutzt dasselbe Token wie
das Telefon.

## Messung

* `EventRow.tsx` rendert für `session.prompt`: `t("session.you_suffix", { suffix: " · <actor>" })`,
  `actor` ist der **Name des Geräte-Tokens** aus dem Hub.
* `GET /api/tokens` (hubctl token list) auf diesem Hub: `handy`
  (zuletzt benutzt 2026-11-24T06:30:56Z) und `tablet`. Der Desktop-Browser ist
  mit `handy` angemeldet — deshalb die Meldung.
* Die tatsächliche Geräteanzeige daneben ist korrekt: „Anzeigemodus:
  Browser-Tab", „Fenster-Ausrichtung: quer", „App-Stand: 75bae8e5".

## Erwartet

Die Zeile soll sagen, **von welchem Ort** die Eingabe kam, ohne ein veraltetes
oder mehrdeutiges Token zu wiederholen — oder sie soll es nur zeigen, wenn
mehrere Geräte im Spiel sind.

## Sofortmaßnahme (ohne Code)

Pro Gerät ein eigenes Token: für den Desktop-PC ein Token mit dem Label `pc`
ausstellen (`npm run hubctl -- token issue pc`), am Gerät dort eintragen, das
Handy-Token widerrufen. Dann liest die Zeile „Du · pc".

## Vorschlag für eine echte Lösung

Der Hub kennt die Geräte nicht, nur die Tokens. Zwei Wege:
1. **UI:** Absenderzeile standardmäßig „Du", das Kürzel erst beim Drüberfahren
   oder im Filter — und ein Hinweis in den Einstellungen, wenn ein Token auf
   mehreren Geräten benutzt wird (letzter Zugriff je Gerät ist schon vorhanden).
2. **Contract:** `session.prompt` bekommt zusätzlich eineclient-seitige
   Gerätebeschreibung (Browser-Tab/Installierte App + Fenstergröße — existiert
   bereits als `client-report`, ADR-0113) als optionales Feld; die PWA zeigt das
   statt des Token-Namens. K5: kurze Felder, K7: nichts Neues zu persistieren.

## Repro

1. Desktop-Browser mit dem Handy-Token öffnen.
2. Nachricht senden.
3. Meta-Zeile der eigenen Nachricht lesen: „Du · handy".

## Umgebung

Windows 11, PWA im Browser-Tab, Token `handy`, Hub-Stand `75bae8e5`.

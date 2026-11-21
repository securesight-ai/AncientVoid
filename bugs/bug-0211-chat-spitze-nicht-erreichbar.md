---
id: BUG-0211
slug: chat-spitze-nicht-erreichbar
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/150"
epic: "EPIC-P43 (Lesbarkeit des Chats), ADR-0085 (betroffen: Lesestelle halten)"
created: 2026-11-18
reporter: Nutzer (Kai, Handy/PWA) + Agent (Harness nachgemessen)
numbered: zuerst als BUG-0209 gefuehrt, nach Kollision mit PR #144 auf 0211 umnummeriert
---

# BUG-0211 — lange Gespräche hören nach 500 Einträgen auf: hochscrollen kommt nicht an den Anfang

## Gesehen

Im Chat einer längeren Session (PWA) bleibt beim Nach-oben-Scrollen eine unsichtbare Wand
stehen: „irgendwie schneidet der bei mir jetzt hier im Chat alte Sachen ab — wenn ich weiter
hoch scrolle, kann ich nicht bis an den Anfang des Chats scrollen.“ Es gibt keinen Knopf, kein
Nachladen, keine Meldung: der Verlauf beginnt einfach „irgendwo mitten drin“.

Im E2E-Harness gemessen (Dummy mit 544 Ereignissen in einer Session): das Lager des Clients
hielt die letzten **500** — die älteste im Chat stehende Folge war **45**, die Spitze (Folge 1)
war nicht vorhanden, und am oberen Rand gab es nichts zu holen.

## Erwartet

Wer nach oben scrollt, erreicht den Anfang des Gesprächs. Die Lesestelle darf dabei nicht
springen: der Eintrag, der vorher oben stand, bleibt oben. Und die Spitze bleibt erreichbar,
während unten neue Einträge einlaufen.

## Repro

1. Fixture-Hub mit `dummyAutoStop: 0` und `dummyEventsPerSecond: 20` (unter der
   Resync-Grenze von `MAX_WS_BUFFER = 100` pro Socket — bei 100/s kippt der Harness in die
   Resync-Schiene und verwischt das Bild).
2. Session anlegen, Verlauf öffnen, ~30 s laufen lassen: der Client wirft alles außer den
   letzten 500 weg (`tailWindow(merged, 500)` im Schwanz-Flush).
3. Mausrad nach oben: die älteste Folge im DOM bleibt stehen (45), Nachladen gibt es nicht.

## Umgebung

Windows-PC, Chromium-/Mobile-Projekt des E2E-Harness, Stand des Zweigs
`fix/pwa-live-stream-scroll` (PR #142). Chat- und Verlauf-Projektion teilen sich das Ereignis-
Lager, der Defekt gilt für beide.

## Ursache

Der Hub liefert den ganzen Schwanz in Seiten zu 100 (`apps/hub/src/modules/sessions/ws.ts`,
`GET /api/sessions/:id/events` bis 2000 pro Aufruf). Der Client mischte in
`apps/pwa/src/features/session/SessionTail.tsx` zwar alles zusammen, warf aber mit
`tailWindow(merged, 500)` bei **jedem** Flush alles außer den letzten 500 Ereignissen weg —
ohne Spur, ohne Möglichkeit, ältere zu holen. Die Grenze war als Render-Budget gedacht
(K2: Kacheln mit 500 Zeilen), galt aber auch im fokussierten Chat, wo gar kein Budget dafür
existierte.

## Tests

`e2e/specs/chat-aeltere-laden.spec.ts` (BUG-0211): nach dem Nachladen steht die **Spitze
(Folge 1)** im Verlauf, die Haltezeile bleibt innerhalb von 24 px an ihrem Randabstand, die
Spitze bleibt bei nachlaufenden Ereignissen erreichbar, und im Chat ist der allererste Auftrag
sichtbar. `apps/pwa/test/features/last-prompt.test.ts` hält die Fensterregel: ab der geladenen
Unterkanze wird nichts mehr verworfen, darüber gilt weiter die Grenze von 500.

## Eingrenzung

Neu seit der Schwanz-Grenze von 500 (K2-Arbeit an den Kacheln); im fokussierten Chat wirkte
sie als hartes Abschneiden. Daten gehen nicht verloren — der Hub hat alles, es war nur nie
holbar.


## Fix

Behoben: `9ca279b9` / PR #150. Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

Fix: `tailWindow(events, limit, floorSeq)` hält, was der Leser sich hochgeladen hat;
`loadOlder()` holt Seiten über `GET /api/sessions/:id/events`; am oberen Rand (und per Knopf
`data-testid="load-older"` wird nachgeladen, ein `useLayoutEffect`-Anker hält die Lesestelle
auf ihrer Ansichtsposition (nicht Dokumentposition — die rückt um die vorgelagerte Strecke).

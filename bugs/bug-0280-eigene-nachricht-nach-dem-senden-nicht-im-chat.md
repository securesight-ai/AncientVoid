---
id: BUG-0280
slug: eigene-nachricht-verschwindet-nach-dem-senden-aus-dem-chat
status: open
severity: S2
area: pwa
instance: dev
commit: ""
forge: ""
epic: P7
created: 2026-11-24
reporter: Kai
---

# BUG-0280 — Nach dem Senden ist die eigene Nachricht im Chat weg

## Gesehen

Kai: „Warum sehe ich unmittelbar nach dem Absenden meine Nachricht nicht mehr?"
Er sendet in einer **laufenden** Session. Im Chat-Tab erscheint kein Satz mit
seinem Text; erst viel später (oder nach einem Neuladen) steht sie im Verlauf.

## Messung (Live-Hub, Desktop-Viewport 1920 × 1080, eigene Sitzung)

* Einfaches `Enter` im Eingabefeld **sendet nicht** — der Composer definiert
  Enter als Zeilenumbruch, senden ist **Strg/⌘ + Enter**
  (`composer.send_hint`: „⌘/Ctrl+Enter senden"). Der Text bleibt dann im Feld
  stehen, was wie „weg" aussehen kann, wenn man danach etwas anderes tippt.
* Mit `Strg + Enter` gesendet: im Hub **kein** `session.prompt`-Ereignis, dafür
  ein DOM-Knoten `class="queue-text"` bei y = 905 — die Nachricht liegt in der
  **Warteschlange** (`GET /api/sessions/:id/queue`), nicht im Chat.
* Der Chat-Container (`.tail-scroll`, Höhe 561 px bei PC-Breite) enthält diesen
  Text weder sofort noch nach 2 s; `scrollHeight` unverändert (7801) — es wird
  also nichts zusätzlich gerendert.

## Erwartet

Direkt nach dem Senden steht die eigene Nachricht **im Chat**, deutlich als
„wartet/zugestellt" markiert — nicht nur als kleiner Streifen unterhalb des
Chats, den man bei großer Schrift und breitem Fenster leicht übersieht.

## Ursache (vermutet, zu prüfen)

Vorgemerkte Eingaben (ADR-0085) werden nur in `QueueList` dargestellt; erst die
Auslieferung erzeugt das `session.prompt`-Ereignis, das `turnsOf` als
Zeilenanfang rendert. Zwischen Senden und Auslieferung gibt es keine Zeile.

## Vorschlag

Vorgemerkte eigene Eingabe als eigene Chat-Zeile mit Status („wartet auf den
Zug") rendern, identischer Text wie im Eingabefeld, mit den bestehenden
Aktionen Bearbeiten/Entfernen. Dann ist der Weg „getippt → gesendet → sichtbar"
durchgängig, und der Warteschlangen-Streifen bleibt die Verwaltung, nicht der
einzige Nachweis.

## Repro

1. Session mit `adapter: pi` starten und laufen lassen.
2. Nachricht tippen, **Strg + Enter**.
3. Chat-Tab beobachten: keine eigene Zeile; unten ein Warteschlangen-Eintrag.

## Umgebung

Windows 11, Hub 127.0.0.1:7373 (Stand `75bae8e5`), Adapter `pi`,
Auslieferung „nächste Gelegenheit".

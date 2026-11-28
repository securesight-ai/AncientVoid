---
id: BUG-0293
slug: chat-historie-touch-und-seitenluecke
status: fixed
severity: S2
area: pwa
instance: dev
commit: "b8055d90"
forge: "https://github.com/securesight-ai/AncientVoid/issues/480"
epic: P90
created: 2026-11-28
reporter: "Kai"
---

# BUG-0293 — Mobiler Chat lädt ältere Nachrichten am oberen Rand nicht vollständig nach

In einer Chat-Sitzung mit 2.800 älteren Fixture-Ereignissen endet das
sichtbare Fenster am oberen Rand. Die unmittelbar vorherige Antwort fehlt
nach dem Wischen. Erwartet ist eine zusammenhängende, begrenzte Seite
älterer Nachrichten bei gleichbleibender Leseposition.

## Repro und Ursache

Der mobile Chromium-Repro in
[`chat-aeltere-laden.spec.ts`](../e2e/specs/chat-aeltere-laden.spec.ts)
setzt die Leseposition an die obere Kante und wischt dort nach unten.
Vor dem Fix erschien die Antwort direkt vor der ersten sichtbaren Seite
nicht. `SessionTail` reagierte auf ein weiteres Scroll-Ereignis, das bei
einer Geste an der Kante ausbleiben kann. Der Abruf begann zudem bei
Sequenz 0 und übersprang bei mehr als 2.000 älteren Ereignissen die
angrenzende Seite.

## Verifikation

Der mobile Repro lief vor dem Fix rot und danach grün. Touch und Mausrad
können direkt an der Kante nachladen. Der Abruf fordert bis zu 500
Ereignisse unmittelbar vor dem Fenster an. Der Scrollanker wartet auf
die neue Seite, auch wenn ihre erste Folge in der Chat-Projektion
keine sichtbare Zeile erzeugt.

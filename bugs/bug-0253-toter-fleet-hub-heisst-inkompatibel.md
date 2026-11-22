---
id: BUG-0253
slug: toter-fleet-hub-heisst-inkompatibel
status: done
severity: S2
area: core
instance: prod
commit: "92dc27b9"
forge: ""
epic: ""
created: 2026-11-21
reporter: Pi-Session 2026-11-21 (Nutzerbericht „kaisgamingdesk nicht mehr sichtbar“ + Live-Befund)
---

# BUG-0253 — ein abgeschalteter Hub wird als „inkompatibel“ gemeldet

## Gesehen

`kaisgamingdesk` (Windows 11, Hub über `tailscale serve`) war nach einem Update nicht
mehr in der Flotte. Der Host war gekoppelt (`fleet_peers` vorhanden), aber der
Hub-Prozess auf dem Gegenüber lief nicht mehr: `tailscale serve` antwortete auf
`/api/fleet/hello` mit **502 und leerem Body**.

`GET /api/fleet` lieferte daraufhin:

```
hostId kaisgamingdesk | state "incompatible" | detail "Protokoll undefined statt 1"
```

Die PWA zeigte also einen Versionskonflikt, den es nicht gibt. Ein Nutzer, der seinen
Rechner vermisst, wird in die Irre geführt (Reparaturversuch über Neu-Kopplung statt
Hub-Start).

## Erwartet

Ohne antwortenden Hub ist der Host **offline**, mit dem Grund aus der Antwort
(„kein Hub auf <host> (Antwort 502)“). `incompatible` ist nur erlaubt, wenn das
Gegenüber sich als Hub zu erkennen gibt und eine andere Protokollversion meldet.

## Repro

1. Hub A mit `tailscale serve` auf einem Rechner, Hub B mit `npm run hub` darunter.
2. A mit B koppeln (`/api/fleet/peers`).
3. Hub B stoppen, so dass nur `tailscale serve` weiter 502 liefert (leerer Body).
4. `GET /api/fleet` auf A → vor der Heilung `state: "incompatible"`.

## Ursache

`apps/hub/src/modules/fleet/fleet.routes.ts` prüfte die Protokollversion **vor** dem
HTTP-Status. Ein leerer 502-Body hat kein `protocolVersion` → Vergleich gegen
`FLEET_PROTOCOL_VERSION` schlägt fehl → „incompatible“.

## Heilung (Commit `92dc27b9`)

Zuerst Status und Erkennbarkeit prüfen, erst dann die Protokollversion:

- `hello.status !== 200` oder kein `hostId` → `offline` mit
  `kein Hub auf <host> (Antwort <status>)`
- `protocolVersion` abweichend (bei antwortendem Hub) → wie bisher `incompatible`

Test: `apps/hub/test/modules/fleet/fleet-aggregate.test.ts` — ein Stub-Hub, der nach
dem Koppeln nur noch 502 ohne Body liefert, erwartet `state: "offline"` und
`detail` mit „Antwort 502“. Datei 5/5 grün, `eslint` und `tsc -p .` grün.

## Nebenbefunde am selben Bildschirm (ebenfalls `92dc27b9`)

1. **Hostname abgeschnitten**: `hostLabel()` kürzte Host-Ids auf 8 Zeichen, die
   Hosts-Karte zeigte „kaisgami“. Host-Ids sind lesbare Slugs → keine Kürzung mehr.
2. **Statusleiste hinter der Icon-Leiste**: in `21-icon-rail.css` setzte die Kurzform
   `inset: 0 auto 0 0` im 700er-Block `bottom` auf 0 und überschrieb damit das
   `bottom: 28px` des 1280er-Blocks. Die Leiste lief unter die Statusleiste und
   verdeckte deren linkes erstes Item. Gemessen vor der Heilung: railBottom 633 =
   Viewport, `elementFromPoint` auf der Statusleiste lieferte das Sidebar-Element;
   nach der Heilung railBottom 605 = barTop 605, Überlappung 0.

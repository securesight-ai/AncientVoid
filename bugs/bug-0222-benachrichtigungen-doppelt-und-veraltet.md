---
id: BUG-0222
slug: benachrichtigungen-doppelt-und-veraltet
status: done
severity: S2
area: pwa
instance: dev
commit: "a2daa730"
forge: "https://github.com/securesight-ai/AncientVoid/issues/192"
epic: ""
created: 2026-11-19
reporter: "Kai (Nutzerreport)"
---

# BUG-0222 — Benachrichtigungen werden doppelt angezeigt und alte Meldungen kommen erneut

## Gesehen

Die Glocke zeigt dieselbe Nachricht mehrfach als eigene Zeile, und bereits
gezeigte (veraltete) Meldungen tauchen erneut als Toast auf. Nutzerbericht
2026-11-19: „Nachrichten werden häufig doppelt angezeigt oder sind veraltet."

## Erwartet

Jede Benachrichtigung (`hostId#id`) erscheint genau einmal in der Liste und
wird höchstens einmal als Toast gemeldet. Ein träger oder überlappter Poll
darf nichts nachspielen.

## Repro

Voraussetzung: PWA offen, Hub erreichbar; ein Fleet-Peer, der langsam
antwortet (oder ein Hub, der > 4 s für `/api/notifications` braucht).

1. PWA öffnen — erster Poll füllt die Liste still (Cursor `lastIds` steht).
2. Eine neue Benachrichtigung entstehen lassen (z. B. Zug-Ende).
3. Der nächste Poll braucht länger als `POLL_MS` (4 s) — Peers werden im
   selben `poll()` mit `await Promise.all(...)` abgewartet, `api()` hat
   keinen Fetch-Timeout. `setInterval` feuert derweil erneut.
4. Beide Antworten enthalten dieselben neuen Meldungen; beide laufen durch
   `take()`.

**Ergebnis nach Schritt 4:** Jede Antwort toastt ihre Seite komplett
(`take()` filtert nicht `id <= known`) und stellt sie vorne in die Liste
(`setItems` dedupliziert nicht nach `key`). Dieselbe Meldung steht zweimal
in der Glocke und toastet doppelt; eine späte alte Antwort spült bereits
überholte Meldungen erneut auf den Bildschirm („veraltet").

**Häufigkeit:** manchmal — sofort reproduzierbar, sobald ein Poll > 4 s dauert.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal / Tailscale-Fleet |
| Commit | `a2daa730` |
| Node-Version | 26.7.0 |
| Adapter | beliebig |
| Repro-Weg | PWA (Test-Repro: E2E mit Fault-Injection) |

## Logs

Keine Hub-Logs (rein clientseitig). Netzwerk-Tab: zwei überlappende
`GET /api/notifications?after=<gleich>` mit identischem Body, danach
doppelte `.notif-item[key]`-Zeilen bzw. wiederholter Toast.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/notifications/merge.test.ts` | nicht vorhanden |
| E2E | `e2e/specs/notifications.spec.ts` (Race-Szenario) | nicht vorhanden |

Ohne Fix rot: die Merge-Einheit (doppelte `key`s bleiben doppelt, `id <=
known` wird durchgestellt) und die E2E (zwei überlappende Antworten →
Toast/Zeile kommt zweimal).

## Eingrenzung

`apps/pwa/src/features/notifications/Notifications.tsx`

- `take()` (:151–190): toastt die ganze Seite statt `id > known`; Merge
  ohne Key-Dedup.
- Poll-Loop (:216–254): `setInterval(() => void poll(), 4000)` ohne
  In-Flight-Guard; `poll()` wartet eigene + alle Peer-Abrufe ab.
- `apps/pwa/src/shared/api.ts:1041`: kein `limit` — RouteDefault 50.

Nebenfunde (hier nur festgehalten, kein Fix in diesem Bug):

- Server-Cursor `lastId = MAX(id)` global
  (`packages/core/src/modules/sessions/session-manager.ts:2120`) trotz
  `LIMIT 50`: bei > 50 neuen Meldungen zwischen zwei Polls (Hintergrund-
  Drossel des Browsers, Event-Sturm) wird der mittlere Rest nie geliefert.
  Der Client hebt sein Fenster auf `limit=200` (Route-Kappgrenze), um den
  realistischen Rückstand abzudecken; ein Paging-Protokoll wäre die volle
  Lösung, ist für eine „Zuletzt"-Glocke aber Übermaß.
- `packages/core/src/modules/push/push.ts:152` setzt den Claim vor dem
  Versand — ein fehlgeschlagener Send geht verloren (nicht doppelt).
- Zwei offene Tabs toasten unabhängig voneinander (Cursor ist pro Instanz
  im Speicher). Brauchte eine Produktentscheidung (BroadcastChannel),
  nicht stillschweigend mitgefixt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix`

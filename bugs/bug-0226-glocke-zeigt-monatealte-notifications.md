---
id: BUG-0226
slug: glocke-zeigt-monatealte-notifications
status: done
severity: S2
area: server
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/204"
epic: ""
created: 2026-11-20
reporter: "Kai (Nutzerreport: „noch immer uralte Notifications von ganz alten Sessions", besonders wenn der Hub nicht erreichbar ist)"
---

# BUG-0226 — die Glocke zeigt Notifications von vor zwei Monaten, auch zu längst gelöschten Sessions

## Gesehen

Die Notification-Glocke der PWA zeigt beim App-Start (und offline) Meldungen,
die Wochen alt sind — auch zu Sessions, die inzwischen gelöscht sind. Der
Bestand wird nie kleiner. Live am produktiven Hub (read-only in die DB
gesehen, 2026-11-20):

```text
notifications: 3176 Zeilen, älteste 2026-09-23T11:49:19Z, neueste 2026-11-20T07:19:58Z
verwaist (session_id nicht mehr in sessions): 22 Zeilen
```

## Erwartet

- Meldungen zu gelöschten Sessions verschwinden mit der Session.
- Der Feed hat eine nachvollziehbare Horizontgrenze (Alter und/oder Menge);
  Uralt-Zeilen werden nicht bei jedem App-Start als aktueller Bestand gefüllt.
- Offline/Hub-down wird der gecachte Bestand als alt gekennzeichnet bzw.
  stillschweigend stehen gelassen, nicht wie ein erfolgreicher Poll
  eingespielt.

## Repro

Voraussetzung: produktiver Hub (läuft), PWA auf dem Handy.

1. Read-only in die Hub-DB schauen (Zeilen zählen, älteste `created_at`,
   Verwaiste zählen) — siehe Logs.
2. PWA neu laden (App-Start): erster Poll läuft mit `after=0`
   (`lastIds.current[""] ?? 0`, Cursor ist Speicher-pro-Instanz) und füllt
   die Liste still mit den 50 (Route-Default) neuesten Tabellenzeilen —
   unabhängig von Alter und Session-Status.
3. Hub stoppen/Offline: der Service Worker serviert die zuletzt gecachte
   `/api/notifications`-Antwort (`X-AncientVoid-Cached-At`) als normale 200-
   Antwort — die PWA behandelt sie wie einen erfolgreichen Poll.

**Ergebnis nach Schritt 3:** alte Zeilen bleiben stehen und „frieren" ein;
der Eindruck „uralte Notifications" entsteht genau in der Phase, in der der
Hub nicht erreichbar ist.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), produktiv |
| Commit | Code-Prüfung `42de8052`; laufender Hub `6ec37473` |
| Node-Version | 26.7.0 |
| Adapter | beliebig |
| Repro-Weg | DB (read-only) + PWA-Codepfad |

## Logs

Read-only DB-Abfrage am laufenden Hub, 2026-11-20 ~07:20Z:

```text
SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM notifications;
→ 3176 | 2026-09-23T11:49:19.402Z | 2026-11-20T07:19:58.239Z

SELECT COUNT(*) FROM notifications
WHERE session_id IS NOT NULL
  AND session_id NOT IN (SELECT id FROM sessions);
→ 22
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/…/session-manager*.test.ts` | nicht vorhanden |

Ohne Fix rot müssten: (a) ein Test, der nach `delete(sessionId)` keine
`notifications`-Zeilen der Session mehr findet; (b) ein Test, dass
`notifications(0)` Zeilen oberhalb der Horizontgrenze nicht ausliefert.

## Eingrenzung

- `packages/core/src/modules/sessions/session-manager.ts:2107-2119` —
  `notifications()` selektiert `WHERE id > ?` ohne Altersgrenze und ohne Join
- `session-manager.ts:2412-2414` — `delete()` räumt `workspace_services`,
  `workspace_operations`, `sessions`, aber **nicht** `notifications` →
  verwaiste Zeilen (22 live).
- Repo-weit existiert kein `DELETE FROM notifications` — keine Retention.
- `apps/pwa/src/features/notifications/Notifications.tsx:230` — erster Poll
  mit `after=0` füllt die Liste still mit dem Tabellen-Anfangsbestand.
- `apps/pwa/public/sw.js:125,140-149` — `/api/notifications` ist gecacht;
  offline wird die Seite als normale Antwort nachgeserviert (kein
  Ablauf/Markierung im Client-Pfad).

Nebenfund (kein Fix hier): `unread`-Badge (`Notifications.tsx:271`) zählt auf
einem Gerät mit leerem Read-Mark alle Altzeilen als ungelesen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` oder offen lassen


## Fix (2026-11-23)

Drei Teile:

1. **Horizont + Retention (core):** `notifications()` liefert nur Zeilen ab
   `NOTIFICATION_HORIZON_DAYS = 14` (`notificationHorizonCutoff`) und kappt
   ältere gedrosselt (max. 1×/h, erster Lesezugriff = Start-Aufräumung).
2. **Offline-Kennzeichnung (pwa/api):** `hubApi.notifications` liefert
   `cachedAt` (aus `X-AncientVoid-Cached-At` des Service Workers) mit; der
   Poll zählt eine gecachte Antwort als Hub-Ausfall (gleiche Warnung wie bei
   totem Hub) und spielt sie nicht in die Liste ein.
3. Verwaiste Zeilen beim Session-Löschen waren bereits mit BUG-0246 erledigt
   (`purgeSessionSidecars`).

Rot ohne Fix: Unit `session-manager.test.ts` „BUG-0226" (Altzeile wurde
ausgeliefert), E2E `notifications.spec.ts` „BUG-0226" (ohne Client-Fix fehlt
die Hub-down-Warnung, per Stash belegt). Grün mit Fix: Unit 61/61
(session-manager + notifications), E2E grün, lint, typecheck.
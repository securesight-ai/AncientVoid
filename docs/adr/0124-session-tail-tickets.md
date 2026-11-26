# ADR-0124 — Kurzlebige Tickets für den Session-Tail

- Status: angenommen (EPIC-P82 T82.4/T82.5)
- Bezug: ADR-0017 (Flotte und Widerruf), ADR-0087 (Stream-Tickets), PRD §8 und K2

Browser und hubctl holen mit Bearer-Header ein Ticket per
`POST /api/events/:id/tail-ticket`. Für entfernte Sessions nutzen sie
`POST /api/hosts/:hostId/events/:id/tail-ticket` auf dem Heim-Hub.
Die Ausgabe erfordert dieselben Leserechte wie der jeweilige Stream.
Die Antwort ist `201` mit `{ ticket, expiresAt }` und `Cache-Control: no-store`.
Beim Upgrade steht nur das Ticket in der URL.

Der ausstellende Hub hält höchstens 512 offene Tickets für je 30 Sekunden
im Speicher. Er speichert den Ticket-Hash, die Zielroute und den Hash des
ausstellenden Gerätetokens. Ein passender Upgrade verbraucht das Ticket
synchron. Fehlende, abgelaufene, widerrufene oder falsch gebundene Tickets
enden mit WS-Code 4401. Beim Hub-Neustart verfallen die Tickets. Clients holen danach neue.

Hub-zu-Hub-Verbindungen und andere WS-Clients mit Header-Unterstützung
können sich weiter per Bearer-Header authentifizieren. Für offene Streams
prüft der Hub den vom Auth-Hook aufgelösten Hash beziehungsweise den
Aussteller des Tickets alle zwei Sekunden auf Widerruf. Bei Flotten-Streams
prüfen beide Hubs ihre jeweiligen Zugangsdaten. URL-Log-Redaction bleibt aktiv.

Die alte `?token=`-Authentifizierung für den Session-Tail entfällt. Hub,
PWA und hubctl müssen gemeinsam aktualisiert werden. Flotten-Hubs
verwenden für den Upstream Bearer-Header.

# ADR-0118 — Team: Verbindung, Identität, Kopplung und Widerruf

**Status:** angenommen (Nutzerentscheide E1, E2, E4, E6 vom 24.11.2026; §6 durch E3 geändert, siehe ADR-0121) · **Betrifft:** EPIC-P83,
künftig `packages/contracts/src/team/`, `packages/core/src/modules/team/`,
`apps/hub/src/modules/team/`, `packages/contracts/src/approvals/policy.ts` ·
**Bezug:** ADR-0017, ADR-0021, ADR-0073, ADR-0077, ADR-0087, PRD §8, P45

## Kontext

Mehrere Menschen sollen mit ihren Hubs zusammenarbeiten. Die Flotte (ADR-0017) verbindet eigene
Rechner eines Menschen und bleibt dafür zuständig. Vergleich, Messung und Threat Model:
[Recherche](../2026-11-24_team-kollaboration-recherche.md).

## Entscheidung

1. **Begriff.** Team nach ADR-0123: Menschen mit ihren Instanzen und Agenten.
2. **Eigene Vertrauensdomäne.** Team-Peers erhalten kein Device-Token und erreichen nie die
   Fastify-App unter `/api`. Eigener `https`-Server mit nur einem WebSocket-Pfad `/team/v1`.
3. **Standardmäßig aus.** `team.listen` fehlt in der Konfig → kein Socket. Erlaubt sind nur
   Loopback, RFC 1918, 100.64.0.0/10 und fc00::/7; Wildcard und öffentliche Adressen sind ein
   Startfehler. Das gilt unabhängig von anderen Bind-Optionen. Ausgehende Ziele unterliegen derselben
   Prüfung nach der Namensauflösung, die geprüfte Adresse wird gewählt (kein DNS-Rebinding).
4. **TLS 1.3, beidseitig.** `minVersion: TLSv1.3`, `requestCert`, `rejectUnauthorized: true`,
   `ca` = genau die gepinnten Zertifikate, zusätzlich SPKI-SHA-256-Vergleich je Verbindung vor der
   ersten Nachricht. Kein 0-RTT, keine Wiederverwendung von Sitzungen durch den Client. ALPN
   `av-team/1`. `permessage-deflate` aus, `maxPayload` 64 KiB.
5. **Instanzidentität.** ECDSA-P-256-Schlüssel, `instanceId` = SHA-256 über den SPKI (base64url).
   Selbst signiertes Zertifikat (CN = `instanceId`, damit Aussteller eindeutig sind), 180 Tage, erzeugt mit `@peculiar/x509` (wird direkte
   Abhängigkeit, kein neues Paket im Baum). Ablage `data/teams/identity/` mit 0600, Verzeichnis 0700;
   falsche Rechte sind ein Startfehler. Der Schlüssel muss im Klartext vorliegen; alle Codes und
   Einladungen nur als Hash.
6. **Person und Gerät.** Eine Instanz kann mehrere Personen führen (`personId`, Name; ADR-0121 §2). Das
   Geräte-Label steht als Angabe der Instanz im Ereignis; bewiesen ist nur die Instanz.
7. **Kopplung** in dieser Folge:
   1. A legt eine Einladung an (Passkey; ohne Passkey nur `hubctl team invite`). Inhalt: Version,
      Adresse, SPKI-Hash und Zertifikat von A, `teamId`, 128-Bit-Geheimnis. 10 Minuten, einmalig,
      Präfix `avteam1.`, Text und nie URL. Gespeichert wird der Hash.
   2. Nur im offenen Fenster lauscht ein getrennter Kopplungs-Server (`team.pairPort`, ALPN
      `av-team-pair/1`; Node prüft Zertifikate je Server, nicht je ALPN). Er nimmt unbekannte
      Zertifikate an, ausschließlich für die Kopplungsnachricht, Frist 5 s, danach Socket zu.
   3. B prüft den Pin, sendet Geheimnis und Profil. Fünf Fehlversuche schließen das Fenster.
   4. Beide Seiten leiten zwei achtstellige Codes aus dem TLS-Exporter ab (Labels
      `EXPERIMENTAL-ancientvoid-team-pair-a|b`, Kontext = `teamId` und beide SPKI-Hashes). Das
      RFC-9266-Label wird nicht zweckentfremdet.
   5. B liest Code B über einen anderen Kanal vor, A tippt ihn ein; A liest Code A vor, B tippt ihn
      ein. Je drei Versuche, beide bestätigen mit Passkey bzw. `hubctl`.
   6. Erst nach beiden Bestätigungen werden die Pins gespeichert. Abbruch, Neustart oder Zeitablauf
      verwirft alles.
   7. Startrolle ist Beobachter ohne Projektrechte.
8. **Weitere Mitglieder** koppeln paarweise mit jedem Mitglied; der Gründer schlägt das Mitglied
   vor, jede Instanz bestätigt selbst. Höchstens acht Instanzen je Team. Kein transitives Vertrauen.
9. **Widerruf.** Lokal in einem Schritt: Pin löschen, TLS-Kontext ersetzen, alle Sockets dieses
   Peers schließen, Ausgangspost verwerfen, offene Freigaben des Peers ablehnen, Blob- und
   Git-Zugriffe sperren, betroffene Sessions parken, Ereignis schreiben. Reihenfolge fail-closed:
   Sperreintrag zuerst dauerhaft. Danach erfahren es verbundene Mitglieder. Andere Mitglieder
   trennen nur, wenn der Gründer oder sie selbst widerrufen. Wiederaufnahme nur durch neue Kopplung.
   Bereits übertragene Daten sind nicht rückholbar; das sagt der Dialog.
10. **Rotation.** Alter Schlüssel signiert `identity.rotate` mit neuem SPKI, Zertifikat und
    Zeitpunkt. Der Peer bestätigt, höchstens 24 h Überlappung, dann nur noch neu. Automatisch
    60 Tage vor Ablauf, sonst per Passkey. Bei Verdacht auf Diebstahl ist Rotation verboten:
    widerrufen und neu koppeln. Wer länger als die Restlaufzeit offline war, koppelt neu.
11. **Wiederverbindung.** Wählt die Seite mit hinterlegter Adresse; bei zwei Verbindungen bleibt die
    der kleineren `instanceId`. Backoff 1 s bis 60 s mit Zufallsanteil. Ping 15 s, tot nach 45 s.
12. **Version.** `hello` trägt Protokollversion und Fähigkeiten. Andere Hauptversion: sichtbarer
    Zustand `inkompatibel`, kein Datenaustausch. Unbekannte Ereignisarten werden gespeichert und
    als „unbekannt“ gezeigt, nie ausgeführt und nie verworfen.
13. **Reserve Relay.** Ein blindes Byte-Relay bleibt möglich, ohne dieses Protokoll zu ändern. Es
    ist nicht freigegeben, solange P45 §7 gilt.

## Verworfen

iroh und WebRTC in js-libp2p (native Module), Matrix (eigener Dienst, öffentlich erreichbar),
öffentlicher Port (P45), MLS (Aufwand ohne speichernden Vermittler), geteilte Tokens, TOTP,
Codevergleich per Klick. Erweiterung der `fleet:`-Tokens (für eigene Geräte).

## Konsequenzen

- Neue Konfig `team`, neue Policy-Operationen, zwei private Ports.
- `@peculiar/x509` wird direkte Abhängigkeit; Updates sind sicherheitsrelevant.
- K7: Pins, Sperren und Schlüsselwechsel stehen im Journal; private Schlüssel nur im Backup. Ohne
  Schlüssel ist eine Instanz neu zu koppeln.
- K9/K10: Verbindungszustand sichtbar unter 60 s, letzter Stand mit Zeit.

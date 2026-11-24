# Team-Kollaboration: Bestandsaufnahme, Recherche, Threat Model (Stand 2026-11-24)

Eingefrorene Analyse zu [EPIC-P83](../epics/EPIC-P83-team-kollaboration.md). Entscheidungen:
[ADR-0118](adr/0118-team-verbindung-identitaet-kopplung.md),
[ADR-0119](adr/0119-team-koordination-und-agentengrenze.md),
[ADR-0120](adr/0120-begleiter-profile.md), [ADR-0121](adr/0121-geteilte-sessions.md),
[ADR-0122](adr/0122-sandbox-fuer-worker.md), [ADR-0123](adr/0123-swarm-und-team.md). Abläufe, Ansichten und Feinscoping:
[Feinkonzept](2026-11-24_team-feinkonzept.md).

Kennzeichnung: **[C]** Code/Repo gelesen · **[Q]** Primärquelle gelesen · **[S]** nur
Suchtreffer oder Sekundärquelle · **[M]** selbst gemessen · **[A]** Annahme/Entwurf.

## 1. Ergebnis

1. **Verbindung:** ein eigener, standardmäßig ausgeschalteter Team-Listener mit gegenseitig
   gepinntem **TLS 1.3 (mTLS)** und WebSocket darüber. Er lauscht nur auf Loopback oder einer
   privaten Overlay-Adresse. Als Weg durch NAT dient ein vorhandenes Overlay: Tailscale-Node-Sharing,
   alternativ Headscale oder WireGuard. Kein öffentlicher Port; P45 bleibt eingehalten.
2. **Vertrauen:** das Overlay ist nur Transport. Identität ist der Schlüssel der Instanz, die
   Kopplung braucht Einladung, zwei vorgelesene Codes und Passkey.
3. **Konsistenz:** je Aufgabe genau eine Heim-Instanz als Schreiber, signiertes Append-only-Log.
   Kein CRDT, kein Konsens.
4. **Rechte:** die Gegenseite kann Vorschläge und Nachrichten senden und eine ausdrücklich geteilte
   Session steuern, aber nie eine Freigabe entscheiden. Ausführung nur in der Sandbox.
5. **Relay:** später ohne Protokollbruch möglich, weil TLS Ende-zu-Ende läuft. Ein Relay wäre
   ein öffentlicher Endpunkt und braucht deshalb die ausdrückliche Aufhebung des P45-Entscheids.

## 2. Bestandsaufnahme

### 2.1 Wiederverwendbar [C]

| Baustein | Beleg | Nutzung |
|---|---|---|
| DAG-Prüfung, Generationen, stale-Regel | `packages/core/src/modules/team/engine.ts` (`validatePlan`, `applyOutcome`) | Vorbild für Aufgabenmodell |
| Journal + Snapshot, Schreib-Queue | `packages/core/src/modules/team/store.ts` | Muster für K7 |
| Swarm als lokale Ausführung | `packages/contracts/src/team/team.ts` (`TeamStart`) | angenommene Team-Aufgabe kann lokal einen Swarm starten |
| Einmalcode (Hash, 10 min, Fehlversuchsgrenze) | `packages/core/src/modules/fleet/fleet.ts`, `apps/hub/src/modules/fleet/fleet.routes.ts` | Muster für Einladung |
| Policy-Tabelle, fail-closed | `packages/contracts/src/approvals/policy.ts` | neue `team.*`-Operationen |
| Passkey, signierte Freigaben | `apps/hub/src/modules/identity/webauthn.ts`, `packages/contracts/src/approvals/` | Kopplung, Rechteänderung |
| Daten-statt-Anweisung-Rahmen | `packages/core/src/modules/issues/issue-bridge.ts` (`buildIssuePrompt`) | Übergabe fremder Texte |
| Gatekeeper, Harness-Fähigkeiten | `packages/core/src/modules/gatekeeper/`, `packages/contracts/src/harness/adapter.ts` | zusätzliche Rückfragen |
| Worktrees, Apply, Main-Sync | `packages/core/src/modules/workspace/`, ADR-0016, ADR-0088 | Repo-Arbeit |
| WebSocket-Bibliothek, X.509 in reinem JS | `apps/hub/package.json` (`ws`), `package-lock.json` (`@peculiar/x509` 2.1.0, transitiv über `@simplewebauthn/server`) | Transport, Zertifikate ohne natives Modul |
| Nyx-Zustände und Atlas | `apps/pwa/src/features/nyx/nyx-state.ts`, `apps/pwa/public/nyx/` | Begleiter-Standardform |
| Offline-Stand mit Zeit | `apps/pwa/src/features/team/team-cache.ts` | K10 |

### 2.2 Lücken [C]

| # | Befund | Folge |
|---|---|---|
| B1 | ADR-0077 belegt „Team“ mit Agenten-Orchestrierung | Umbenennung in Swarm, ADR-0123 |
| B2 | Device-Tokens und Flotte sind für eigene Geräte gebaut | andere Menschen bekommen eine eigene, engere Domäne |
| B3 | Der Hub kennt Geräte-Labels, keine Personen (auch P74 F9) | `Person`, ADR-0121 §2 |
| B4 | Dispatches tragen den Akteur fest `"team"` | Auftraggeber ergänzen, T83.1 |
| B5 | Fehlermeldung in `applyOutcome` nennt nach dem Umsetzen immer „stale“ | Nebenfund, eigener Bug |
| B6 | `TeamsPane` nimmt `?host=`, die Flotte leitet `/api/teams` nicht weiter (nicht live geprüft) | Nebenfund, eigener Bug |
| B7 | Werkzeug-Rückfragen sind je Harness verschieden (`docs/harness-matrix.md`) | Grenze per Sandbox, ADR-0122 |

### 2.3 Überschneidungen mit Epics

| Epic | Verhältnis |
|---|---|
| P60 Swarms | Ausführungsschicht; „Cross-Host-Dispatch“ ist dort out of scope und bleibt es |
| P6 Flotte | eigene Rechner; getrennte Vertrauensdomäne |
| P45 Zugang ohne Tailnet | **No-go** für öffentlichen Zugang (10.11.2026), gilt weiter |
| P82 Audit-Räumen | offen; WS-Widerruf und Session-Schnitt vor unseren Eingriffen in Sessions |
| P74 Knowledge | Personenbezug dort ungeklärt (F9); teilt Team-Identität nicht automatisch |
| P61 i18n | alle Texte als Kataloge de/en |
| P80, P81 | keine fachliche Abhängigkeit |
| P30, P31 | zurückgestellt, unberührt |

### 2.4 Widersprüche und Umgang

| Quelle | Aussage | Umgang |
|---|---|---|
| PRD §1.1, §2 | eine Person, „eigene Maschinen“ | Erweiterung, Nutzerentscheid E1 |
| PRD §1.3, §8.1 | Tailscale-only, kein öffentlicher Port | kein öffentlicher Port bleibt; WireGuard/LAN als Erweiterung (E2) |
| PRD §6.1 | „Keine Spielerei“, Zustand vor Dekoration | Bewegung nur aus echten Ereignissen, Chat ohne Bühne vollständig (E7) |
| P45 §7 | kein Relay, kein öffentlicher Endpunkt | Relay nicht Teil von P83 (E2) |
| ADR-0077 §1 | „Team“ nicht für Menschen | ersetzt durch ADR-0123 |
| ADR-0021 | Agent schreibt nie direkt | `auto` ist eine befristete menschliche Freigabe (E5) |
| ADR-0073 | kein Token in URL/QR | Einladung ist Text, nie URL; QR nur am Bildschirm gegenüber |
| epic-creation | neue Phase erst bei grünem Vorgänger | Planung auf ausdrücklichen Auftrag; Start gesperrt (E8) |

## 3. Verbindungsvarianten

| Kriterium | V1 Overlay + mTLS | V2 iroh | V3 js-libp2p | V4 eigenes Relay + mTLS | V5 Matrix-Föderation | V6 öffentlicher HTTPS-Port |
|---|---|---|---|---|---|---|
| NAT | Overlay: direkt, sonst Relay des Overlays [Q1] | Hole-Punching, Relay-Rückfall [Q2] | DCUtR über Relay [S1] | nur ausgehend | Server erreichbar nötig | Portfreigabe |
| E2E-Schutz | WireGuard **und** eigenes TLS | ja, Relay liest nicht mit [Q2] | Noise/TLS [A] | eigenes TLS durch das Relay [M] | HTTPS, signierte PDUs; Server sieht Klartext ohne Raum-E2EE [Q3/A] | TLS bis Hub |
| Öffentlicher Angriffspunkt | keiner | Relay (fremd oder eigen) | Relay | **ja** | **ja** | **ja** |
| Repo-Regel „keine nativen Module“ | erfüllt | verletzt: napi-rs-Binärdateien [S2] | WebRTC-Weg zieht `node-datachannel` [Q4] | erfüllt | eigener Dienst | erfüllt |
| Latenz | direkt am besten, DERP langsamer [Q1] | vergleichbar [A] | abhängig vom Relay [A] | +1 Hop | +Server, Zustandsauflösung | direkt |
| Offline | Warteschlange im Hub | ebenso | ebenso | ebenso | Server puffert | ebenso |
| Betrieb | Einladung im Overlay | Relay + Binärupdates | Relay + großer Stack | Server, Domain, Härtung | Homeserver + DB | Domain, Härtung, Scans |
| Fremde Kontrolle | Tailscale-Koordination; Headscale selbst betreibbar | eigenes Relay möglich [Q2] | eigenes Relay | keine | keine | keine |
| Urteil | **empfohlen** | nein (Regelbruch) | nein (Aufwand, natives Modul) | Reserve, nur mit E2 | nein | nein (P45) |

MLS (RFC 9750) löst Gruppenverschlüsselung über einen untrauenswürdigen Zustelldienst und braucht
Authentifizierungs- und Zustelldienst sowie eine geordnete Commit-Folge [Q5]. Bei höchstens acht
Instanzen mit direkten Paarverbindungen ist das Mehraufwand ohne Gewinn; bei einem speichernden
Relay wäre es neu zu bewerten. A2A 1.0 bietet Aufgabenzustände und Bindings [Q6], setzt aber eine
eigene Autorisierung voraus. Wir übernehmen die Idee des Zustandsmodells, nicht das Protokoll:
kein fremder Agent soll direkt einen Agenten ansprechen.
`node:quic` bringt in Node keine Basis: die Dokumentationsseite war am 24.11.2026 nicht abrufbar
(404), der Reifegrad ist damit **unbelegt**; wir verzichten darauf.

### 3.1 Belege zu V1

- Geteilte Maschinen sind in Quarantäne: sie nehmen Verbindungen an, starten aber keine [Q7].
  Deshalb genügt, dass **eine** Seite teilt und die andere wählt; der Kanal ist danach beidseitig.
- Das Teilen gilt je Maschine, ist widerrufbar und in allen Plänen verfügbar; Link-Sharing ist
  Beta, getaggte Maschinen sind nicht teilbar [Q7]. Mit Tailnet Lock sind Signaturen nötig [Q7].
- Alle Tailscale-Wege sind WireGuard-verschlüsselt; direkt ist am schnellsten, DERP Rückfall [Q1].
- Ob Headscale Node-Sharing kann, sagt dessen Feature-Seite nicht [Q8]. Für Headscale ist daher ein
  gemeinsames Netz mit restriktiver ACL vorzusehen. **Vor Zusage am Gerät prüfen.**
- Der Team-Listener nutzt keine Identitätsheader des Overlays.
- ACL-Empfehlung: geteilter Zugriff nur auf den Team-Port, sonst sähe die Gegenseite auch den
  Hub-Port der geteilten Maschine. Der Assistent zeigt die Regel an und prüft das Ergebnis nicht
  selbst (keine Tailscale-API).

### 3.2 Machbarkeitsprobe [M]

24.11.2026, Skript außerhalb des Repos, nur 127.0.0.1, Node 26.12.0, OpenSSL 3.6.5, ECDSA P-256,
Zertifikate mit `@peculiar/x509` erzeugt:

| # | Versuch | Ergebnis |
|---|---|---|
| 1 | Zertifikat ohne openssl-Binary | erzeugt |
| 2 | beidseitig gepinnt, TLS 1.3 | verbunden; Exporter-Werte gleich |
| 3 | fremdes Client-Zertifikat | abgelehnt, 0 Anwendungsbytes |
| 4 | falscher Server-Schlüssel | abgelehnt |
| 5 | Client nur TLS 1.2 | abgelehnt |
| 6 | TLS durch blindes Byte-Relay | verbunden, Markertext am Relay nicht sichtbar |
| 7 | Handshake+Echo / 4-KiB-Rundlauf | p50 1,89 ms, p95 2,56 ms / p50 0,05 ms, p95 0,09 ms |
| 8 | Widerruf bei offener Verbindung | getrennt nach 1,12 ms |
| 9 | Neuverbindung nach Widerruf | abgelehnt |
| 10 | Resumption nach Widerruf mit Kontextwechsel | abgelehnt |
| 11 | Resumption **ohne** Kontextwechsel | verbindet, `authorized=true` |

Zeile 11 ist die wichtigste: Wer nur die CA-Liste ändert, aber den TLS-Kontext behält, lässt alte
Sitzungen durch. Pflicht sind Kontextwechsel **und** Pin-Prüfung je Verbindung. Localhost-Zahlen
sagen nichts über Internetlatenz; die Messung zwischen zwei Standorten ist T83.12. Nicht geprüft:
WebSocket-Ebene, Node 22/24, Windows/macOS, mehr als ein Peer im Kontext.

## 4. Kopplungsvarianten

| Variante | Sicherheit | Bedienung | Urteil |
|---|---|---|---|
| K1 geteiltes Token | Diebstahl = voller Zugang, kein Nachweis wer | einfach | nein |
| K2 Einmalcode wie Flotte | Abfangen genügt | einfach | nein, allein zu schwach |
| K3 TOTP zusätzlich | nicht phishing-resistent [Q9] | mittel | nein |
| K4 Codes vergleichen und bestätigen | NIST: Vergleichen mit Zustimmen nicht mehr akzeptabel [Q9] | sehr einfach | nein |
| **K5 Einladung mit Schlüsselpin + zwei eingetippte Codes + Passkey** | bindet beide Kanäle und beide Menschen | ca. 2 min, einmalig | **empfohlen** |
| K6 OIDC/Fremdkonto | Anbieterabhängigkeit | einfach | nein (local-first) |

Danach gibt es kein Passwort und kein Bearer-Token mehr; der private Instanzschlüssel authentisiert
jede Verbindung. Codes unter 64 Bit brauchen Versuchsgrenzen [Q9]; wir erlauben drei.

## 5. Threat Model

Schutzgüter: private Schlüssel, Code und Secrets auf jeder Maschine, Werkzeug-Ausführung, Freigaben,
Nachvollziehbarkeit. Vertrauensgrenzen: Instanz↔Instanz, fremder Text↔Agent, Agent↔Mensch,
PWA↔Hub. Annahme: das eigene Gerät und der eigene Hub sind nicht kompromittiert.

| ID | Bedrohung | Gegenmaßnahme | Restrisiko | Test |
|---|---|---|---|---|
| TM1 | Kompromittierter Partner sendet gültige Befehle | kein Fernstart, lokale Annahme, lokale Rechte schneiden Team-Rechte, Ratenlimit, Widerruf | sieht alles bisher Geteilte; kann täuschen | T83.4, T83.6 |
| TM2 | Einladung gestohlen | 10 min, einmalig, 128 Bit, nur Hash gespeichert, zwei Codes, Passkey | Mensch liest Code im gestohlenen Kanal vor | T83.3 |
| TM3 | Einladung ausgetauscht (MITM) | Pin in Einladung, Codes aus Exporter der echten TLS-Verbindung, in beide Richtungen | beide Kanäle übernommen | T83.3 |
| TM4 | Privatschlüssel gestohlen | Datei 0600, nie im Log/Export, Rotation, Widerruf | bis Entdeckung Nachahmung möglich | T83.5 |
| TM5 | Replay | TLS-Records, 0-RTT aus, `commandId`, Zielgruppe, Sequenz, Ablauf 7 Tage | keines bekannt | T83.4 |
| TM6 | Widerruf umgangen (Resumption, offener Socket) | Pin je Verbindung, Kontextwechsel, Sockets schließen | offline Dritte erfahren es später | T83.5 |
| TM7 | Prompt-Injection über Nachricht, Titel, Artefakt, Repo | Vorschau, Datenrahmen, Klasse `teamTaint` **nur in der Sandbox** | Rahmen ist keine Sicherheitsgrenze; Mensch gibt Schadhaftes frei | T83.8 |
| TM8 | Fremdausgelöste Shell/Tools | kein Werkzeugbefehl im Protokoll; Sandbox, Netz nur per Egress-Liste, kein Host-Home | siehe TM23 | T83.8 |
| TM9 | Datenabfluss durch eigenen Agenten | ausgehendes Schreiben braucht Freigabe, Secret-Scan, Größenlimit, Vorschau | Scan erkennt nicht alles | T83.7 |
| TM10 | Partner leitet Daten weiter | nur Geteiltes sichtbar, Hinweis beim Teilen | **nicht verhinderbar** | – |
| TM11 | Heim-Instanz fälscht Urheberschaft | Befehle vom Absender signiert, im Ereignis eingebettet | Instanz kann eigenen Menschen falsch angeben | T83.4 |
| TM12 | Heim zeigt zwei Wahrheiten | Hash-Kette, Vergleich der Köpfe zwischen Mitgliedern | Erkennung erst bei Kontakt; bei zwei Mitgliedern nur über den eigenen Verlauf | T83.4 |
| TM13 | Rücksicherung eines alten Backups | Kopfvergleich vor dem Schreiben, eigene Ereignisse nachladen | ohne erreichbaren Peer unentdeckt | T83.9 |
| TM14 | Überlast | Limits je Peer, Nachrichten-, Blob- und Speicherquote, K8-Test | Overlay-Ebene | T83.12 |
| TM15 | Schadhaftes Repo/Bundle | Quarantäne-Repo, fsck, keine Hooks, kein Checkout ohne Mensch | Schadcode wird nach Freigabe ausgeführt | T83.10 |
| TM16 | Identität nachgeahmt (Name, Nyx) | Instanzabzeichen immer sichtbar, Namensprüfung | ähnliche Formen | T83.11 |
| TM17 | XSS/Markup | nur escapter Text, keine fremden Bilder/SVG/Links automatisch | – | T83.7 |
| TM18 | SSRF über Peer-Adresse | nur private Bereiche, kein Redirect, kein Proxy, Pin vor Daten | Ziel im eigenen Overlay erreichbar, liefert aber nichts | T83.2 |
| TM19 | Overlay-Anbieter bösartig | eigenes mTLS innerhalb des Overlays | Metadaten, Ausfall | T83.2 |

OWASP führt für Agenten u. a. Zielübernahme (ASI01), Identitätsmissbrauch (ASI03), unerwartete
Codeausführung (ASI05) und unsichere Agentenkommunikation (ASI07); die Namen sind nur über
Sekundärquellen belegt, die Landingpage listet sie nicht [S3].

## 6. Entscheidungen (Nutzer, 24.11.2026)

| ID | Frage | Entscheid |
|---|---|---|
| E1 | Mehrpersonen-Scope | ja; Begriffe Swarm und Team (ADR-0123) |
| E2 | Transport | Overlay/privates Netz plus mTLS, kein Relay |
| E3 | Personen | mehrere Menschen verfolgen und steuern eine Session (ADR-0121) |
| E4 | Kopplung ohne Passkey | nur `hubctl` am Rechner |
| E5 | Agentennachrichten | konfigurierbar, Standard fragen (ADR-0119 §7) |
| E5b | beide Richtungen automatisch | nur in der Sandbox |
| E6 | Widerruf während Arbeit | parken, nichts senden |
| E7 | Darstellung | Chat mit animierten Begleitern und Tippen, keine Spielmechanik |
| E8 | Start | nach grünem P82 |
| E9 | Code-Austausch | gemeinsamer Git-Remote zuerst |
| E10 | Aufbewahrung | Verlauf lokal unbegrenzt, Blobs 90 Tage |
| E11 | Ausführungsgrenze | Sandbox direkt integriert (ADR-0122) |
| E12 | Öffentlichkeit | Repo bleibt öffentlich; jeder Nutzer kann die Funktion im privaten Netz sicher einrichten |

| ID | Zusätzliche Bedrohung | Gegenmaßnahme | Restrisiko | Test |
|---|---|---|---|---|
| TM20 | Übernommene Partner-Instanz steuert geteilte Session | Freigabe je Session, Ablauf, Sandbox, Freigaben nur beim Gastgeber | Eingaben bis zur Rücknahme, lesbarer Verlauf | T83.14 |
| TM21 | Geheimnis im geteilten Verlauf | Standard „ab jetzt“, Schwärzung, Daueranzeige, Sandbox ohne Host-Geheimnisse | Muster unvollständig | T83.14 |
| TM22 | Agentenschleife oder Abfluss bei `auto` | Limits, Pause, Pflicht-Sandbox, Egress-Liste | Projektinhalt im erlaubten Rahmen | T83.8 |
| TM23 | Ausbruch aus der Sandbox | ADR-0122 §3–8, Selbsttest, Red-Team | Kernel-Lücke | T83.8 |

## 7. Quellen (Abruf 24.11.2026)

- [Q1] Tailscale, Connection types: <https://tailscale.com/docs/reference/connection-types>
- [Q2] iroh, Relays: <https://docs.iroh.computer/concepts/relays>
- [Q3] Matrix Server-Server API: <https://spec.matrix.org/latest/server-server-api/> (Auszug gelesen)
- [Q4] js-libp2p WebRTC, `package.json`: <https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/package.json>
- [Q5] RFC 9750, MLS Architecture: <https://www.rfc-editor.org/rfc/rfc9750> (bis §5.3 gelesen)
- [Q6] A2A-Spezifikation: <https://a2a-protocol.org/latest/specification/> (Auszug; Abschnitt 13 nicht gelesen)
- [Q7] Tailscale Sharing und Tailnet Lock: <https://tailscale.com/docs/features/sharing>, <https://tailscale.com/docs/features/tailnet-lock>
- [Q8] Headscale Features: <https://headscale.net/stable/about/features/>
- [Q9] NIST SP 800-63B-4, Authenticators: <https://pages.nist.gov/800-63-4/sp800-63b/authenticators/>
- [Q10] RFC 8446: <https://www.rfc-editor.org/rfc/rfc8446>, abgelöst durch RFC 9846 (Juli 2026, nur Ankündigung/Index gesichtet): <https://www.rfc-editor.org/info/rfc9846/>
- [Q11] RFC 9266, Channel Bindings: <https://www.rfc-editor.org/rfc/rfc9266>
- [Q12] Node.js TLS: <https://nodejs.org/api/tls.html> (teils Zusammenfassung)
- [Q13] git-fetch, git-bundle: <https://git-scm.com/docs/git-fetch>, <https://git-scm.com/docs/git-bundle>
- [Q14] WCAG 2.2: <https://www.w3.org/TR/WCAG22/>
- [S1] libp2p Hole-Punching: <https://github.com/libp2p/specs/blob/master/connections/hole-punching.md> (Suchauszug)
- [S2] iroh JavaScript: <https://docs.iroh.computer/languages/javascript> (Suchauszug)
- [S3] OWASP Agentic Top 10: <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>; Liste nach <https://www.promptfoo.dev/docs/red-team/owasp-agentic-ai/>

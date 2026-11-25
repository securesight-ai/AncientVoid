# Team-Kollaboration: Feinkonzept (Stand 2026-11-24)

Eingefrorene Planung zu [EPIC-P83](../epics/EPIC-P83-team-kollaboration.md). Regeln stehen in
ADR-0118 bis 0123 und werden hier nicht wiederholt. Alle Aussagen sind Entwurf, noch kein Code.

## 1. Ort im Code

Die Orte `team/` werden erst nach der Umbenennung des Bestands in `swarm/` frei (T83.1, ADR-0123).

| Schicht | Ort | Inhalt |
|---|---|---|
| Verträge | `packages/contracts/src/team/`, `companions/` | zod-Schemas, Grenzen, Fehlercodes |
| Kern | `packages/core/src/modules/team/` | `identity`, `pairing`, `journal`, `engine` (rein), `sync`, `outbox`, `service` |
| Hub | `apps/hub/src/modules/team/` | `team.routes.ts` (PWA), `team-listener.ts`, `team-dialer.ts` |
| CLI | `apps/hubctl/src/team.ts` | `invite`, `join`, `confirm`, `list`, `revoke`, `rotate` |
| PWA | `apps/pwa/src/features/team/`, `nyx/` | Ansichten, Begleiter |
| Gateway | `apps/gateway-mcp/src/operations.ts` | `team.task.read` (read), `team.say` (write) |

Eine Naht ist echt: `TeamLink` (senden, empfangen, schließen) hat zwei Umsetzungen, WSS/mTLS und
In-Memory-Paar im Test. Weitere Schnittstellen entstehen nicht auf Vorrat.

### 1.1 Routen (nur eigener Hub, nie über die Flotte)

| Route | Policy |
|---|---|
| `GET /api/teams`, `GET /api/teams/:id`, `GET /api/teams/:id/events?after=` | `team.read` |
| `POST /api/teams`, `POST /api/teams/:id/invites`, `POST /api/teams/join`, `POST /api/teams/pairings/:id/confirm` | `team.manage` |
| `POST /api/teams/:id/members/:m/{role,revoke}`, `PUT /api/teams/:id/projects/:p` | `team.manage` |
| `POST /api/teams/:id/tasks`, `POST /api/teams/:id/tasks/:t/{offer,accept,decline,start,submit,review,handover,reassign,block,cancel}` | `team.task` |
| `POST /api/teams/:id/messages` | `team.say` |
| `POST/DELETE /api/sessions/:id/shares[/:share]`, `GET /api/teams/:id/shared/:share` | `team.share` / `team.read` |
| `POST /api/teams/:id/shared/:share/{prompt,interrupt,stop,answer,queue-edit,queue-remove}` | `team.share` |
| `POST /api/teams/:id/tasks/:t/give-to-agent` | `team.task` + `sessions.create`/`prompt` |
| `WS /api/teams/:id/live` | `team.read`, Einmal-Ticket (Muster ADR-0087) |

`operationOf` liefert für jede dieser Routen eine Operation, auch für GET; ein Test zählt alle Routen.

### 1.2 Konfig

`team: { listen: { address, port, pairPort } | null, dialTimeoutMs: 10000, maxTeams: 8 }`. Standard
`null`. Ohne `listen` kann eine Instanz beitreten, sofern die andere lauscht.

## 2. Abläufe

### 2.1 Koppeln

```text
Ada (A)                                   Ben (B)
Team anlegen, Einladung, Passkey
Text über eigenen Kanal  ───────────────> einfügen, Vorschau (Name, Adresse, Pin kurz)
                         <── TLS, Pin ok ─ Passkey, verbinden
zeigt: „Anfrage von Ben“                  zeigt Code B 4821 9036
tippt Code B ein         <── vorgelesen ──
zeigt Code A 7714 2208   ─── vorgelesen ─> tippt Code A ein
Passkey                                    Passkey
            beide Pins dauerhaft → verbunden, Rolle Beobachter
Rolle und Projekte festlegen (je Seite)
```

Fehler: Code falsch (Restversuche), abgelaufen, Einladung benutzt, Pin falsch („Das ist nicht die
Instanz aus der Einladung“), Version, Netz. Jeder hat eigenen Text und nächsten Schritt.

### 2.2 Gemeinsame Aufgabe

1. Ada erstellt „Login absichern“, Projekt, Ziel, Abnahmekriterien, Prüfer Ada, zuständig Ben.
2. Optional teilt Ben seine Session mit Ada: verfolgen oder steuern (ADR-0121).
   Ben bekommt Push „Ada bietet dir eine Aufgabe an“ (nur Titel, keine Aktion am Sperrbildschirm).
3. Ben prüft und nimmt an. „An Agent geben“ zeigt Vorschau und Kennzeichnung; Session startet bei Ben
   unter Bens Akteur.
4. Ohne Teilen sieht Ada nur **Metadaten** (Zustand, Dauer, Zähler); mit Teilen den Verlauf live.
5. Bens Agent will Adas Agenten etwas fragen → Freigabe bei Ben (oder `auto`, ADR-0119 §7.6) → Nachricht im Aufgabenraum → Ada
   gibt sie (mit Vorschau) an den eigenen Agenten → Antwort mit Adas Freigabe zurück.
6. Ben reicht ein: Text, Branch, SHA, Testnachweis. Ada prüft, nimmt ab oder verlangt Änderungen.
7. Merge ist Adas lokale Handlung im bestehenden Ablauf.

### 2.3 Abbruch und Konflikt

| Fall | Verhalten | Anzeige |
|---|---|---|
| Verbindung weg | lokale Arbeit läuft, Befehle vorgemerkt | „getrennt seit 14:02 · Stand 14:01 · 3 vorgemerkt“ |
| Vorgemerkt > 7 Tage | verfällt, Mensch kann neu senden | „nicht zugestellt: abgelaufen“ |
| Hub-Neustart | Journal, offene Rückfragen bleiben | Zustand wie vorher |
| Heim offline | Aufgabe nur lesbar, Entwürfe möglich | „wartet auf Adas Hub“ |
| Zwei Änderungen | erste gilt, zweite `conflict` | Unterschied + „auf neuem Stand wiederholen“ |
| Zuständiger fällt aus | nach 15 min `stalled`, keine Automatik | Ersteller: warten / neu vergeben |
| Altes Ergebnis nach Neuvergabe | `stale`, einsehbar | „Versuch 1, überholt“ |
| Gleiche Dateien | Hinweis, kein Sperren | beide Aufgaben verlinkt |
| Verlauf widerspricht sich | Strom eingefroren | rote Meldung, beide Köpfe, Export |
| Widerruf | sofort, siehe ADR-0118 §9 | „Zugriff beendet von … um …“ |
| Disk voll | keine Bestätigung, Verbindung pausiert | Fehler mit Pfad und Bedarf |

## 3. Kommunikation und Nachvollziehbarkeit

Drei Orte: **Team-Raum** (Mensch↔Mensch), **Aufgabenraum** (alle), **Verlauf** (jedes Ereignis).
Jede Zeile zeigt: wer (Begleiter, Name, Instanz, Mensch/Agent) · was · wann (Zeit des Heims, eigene
Empfangszeit im Detail) · warum · im Auftrag von. Filter nach Person, Agent, Art, Aufgabe;
Export als JSONL mit Signaturen, `hubctl team verify <datei>` prüft offline. Agententext ist mit
„Agent“ beschriftet und nie wie eine Systemmeldung gestaltet. Keine Lesebestätigung in v1, kein
automatisches Laden von Links, keine Markdown-Bilder.

Benachrichtigungen: Angebot, Rückfrage, Prüfung, Ausfall, Widerruf, Sicherheitsereignis. Chat nur bei
Erwähnung; je Team stummschaltbar, Sicherheitsereignisse nicht.

## 4. Oberfläche

Neue Seite `#/teams?id=<id>&task=<id>` mit **Gespräch | Aufgaben | Liste**. Die bisherige Seite wird
`#/swarms` (ADR-0123); alte Links führen dorthin.

### 4.1 Idee: das lebendige Gespräch

Kern ist ein **Chat**, in dem jeder Agent als animierter Begleiter auftritt. Spielnah ist nur das Bild:
Figuren, Bewegung, Tippen. Keine Punkte, Level, Ranglisten oder Spielregeln. Die Gestaltung ist eigen.

Über dem Chat steht eine schmale **Bühne**: alle beteiligten Begleiter nebeneinander. Spricht einer
mit einem anderen, wendet er sich ihm zu und eine Sprechblase läuft hinüber; arbeitet er, sieht man
das; wartet er auf einen Menschen, hebt er die Hand. Menschen erscheinen als Initialen-Abzeichen,
nie als Figur, damit Mensch und Agent nie verwechselt werden.

| Echtes Ereignis | Begleiter | Text dazu |
|---|---|---|
| thinking-Frames | denkt, Blasenpunkte | „denkt nach“ |
| assistant-Frames | Mund/Glanz, **Text tippt live** | – |
| tool_use / tool_result | Werkzeugpose je Art (liest, schreibt, führt aus, sucht) | „liest auth.ts“ |
| Nachricht an Agent X | Zuwenden, Blase läuft | „an Moos · Ben“ |
| wartet auf Freigabe/Frage | Hand, Laterne | „braucht Ada“ |
| Übergabe / Abnahme | reicht Kapsel / kurzes Nicken | Aufgabe und Person |
| Fehler / getrennt / Ruhe | wie Nyx-Zustände | Grund, Zeit |

**Ehrlichkeit (ADR-0083, „kein Fake Streaming“):** Echt live getippt wird, wo der Adapter Frames
liefert (heute claude, pi). Andere liefern Blöcke; dort zeigt die Figur Arbeit und der Block erscheint
mit der vorhandenen Tipp-Darstellung (`apps/pwa/src/shared/typewriter.ts`, P58-Schalter gilt). Eine
Nachricht, die noch auf Freigabe wartet, zeigt beim Partner nur „wartet auf Freigabe“, keinen Text.
Ohne Ereignis gibt es nur die Ruheanimation. Dieselbe Ansicht nutzt auch der lokale Swarm:
Auftrag, Rückfrage und Ergebnis erscheinen als Nachrichten zwischen Koordinator und Workern.

### 4.2 Desktop (≥ 1024 px)

```text
┌ Teams  [Gespräch|Aufgaben|Liste]   Team: Nordlicht ▾   ● 38 ms                     [+ Aufgabe] ┐
├──────────────┬──────────────────────────────────────────────────┬──────────────────────────────┤
│ Team         │  (Nyx·Ada) ──"…"──▶ (Moos·Ben)   (Lumen·Ben) ✋   │ Aufgabe: Login absichern     │
│ Ada ●  Ben ● │ ──────────────────────────────────────────────── │ zuständig Ben · Prüfer Ada   │
│ Gespräche    │ 14:02 Nyx·Ada → Moos·Ben  im Auftrag von Ada     │ [Details|Dateien|Verlauf]    │
│ # Team       │   Nutzt ihr Argon2 schon?                        │ Session: Moos                │
│ # Login    2 │ 14:03 Moos·Ben  liest auth.ts …                  │ Team: Ada steuert · Ben host │
│ Braucht mich │   Ja, in hash.ts, ich prüfe die Para▌            │ [Teilen] [Stopp]             │
│              │ [ Nachricht an: Alle ▾ ……………………………… ➤ ]     ⏸   │ [Abnehmen] [Änderungen]      │
└──────────────┴──────────────────────────────────────────────────┴──────────────────────────────┘
```

### 4.3 Mobil (390 px)

```text
┌ ‹ # Login absichern      ● 38 ms ┐   Bühne 72 px, wischbar, antippbar.
│ (Nyx) ─▶ (Moos) (Lumen✋)     ⏸ │   Chat füllt den Rest. Leiste
│ Nyx·Ada → Moos·Ben               │   „Lumen braucht dich“ klebt über
│  Nutzt ihr Argon2 schon?         │   der Eingabe. Details als Blatt.
│ Moos·Ben  schreibt …             │   Tastatur offen: Bühne klappt auf
│  Ja, in hash.ts, ich prü▌        │   eine Zeile ein.
│ [An: Alle ▾  Nachricht       ➤ ] │
└──────────────────────────────────┘
```

### 4.4 Ansichten

V1 Leerzustand · V2 Gespräch mit Bühne · V3 Aufgabenliste (Tabelle) · V4 Aufgabe · V5 Aufgabe anlegen ·
V6 Kopplung · V7 Mitglied (Rolle, Projekte, Schlüssel, Widerruf) · V8 „An Agent geben“ · V9
Verlauf/Export · V10 Begleiter-Werkstatt · V11 Sicherheitsereignis · V12 **Session teilen** (Person,
Stufe, Dauer, Verlauf, Hinweis) · V13 **geteilte Session** (Verlauf, wer sieht zu, wer schreibt,
Warteschlange mit Namen, Stopp) · V14 Agentennachrichten einstellen (E5, Folgen im Klartext).

### 4.5 Barrierearmut und Leistung

- Der Chat ist eine normale Liste und enthält alles; die Bühne ist Beiwerk, einklappbar und per
  Tastatur erreichbar. Screenreader hören fertige Nachrichten, nie einzelne Zeichen; höchstens eine
  Ansage je 5 s, Rückfragen sofort.
- Pausenknopf (WCAG 2.2.2), `prefers-reduced-motion` und `data-ctx-motion="off"`: Standbild, Text ohne
  Tippen. Ziele über `--target`, mindestens 24 px (2.5.8). Form und Text neben Farbe (1.4.1).
- Nur `transform`/`opacity`; höchstens 12 bewegte Figuren, 3 gleichzeitig tippende Nachrichten, Rest
  steht. Liste virtualisiert ab 200 Einträgen. Versteckter Tab: aus. K2: kein Frame über 200 ms, p95
  ≤ 32 ms bei 40 Agenten und 30 Ereignissen/s. Chunk ≤ 60 KiB gzip plus benötigte Formen.

### 4.6 Begleiter-Werkstatt

Große Vorschau links, Wahl rechts (mobil untereinander): Name, Form, Palette, Accessoire, Emblem,
Satzfarbe, Bewegung. Vorschau zeigt alle sechs Zustände in hell und dunkel sowie „So sehen dich
andere“. Prüfungen sofort: Kontrast, Verwechslung im Team. Speichern wirkt lokal sofort, bei
anderen nach Sync; „Standard-Nyx“ setzt zurück. Zuordnung: Hub, Adapter, Rolle.

## 5. Feinscoping (concept-phase)

Gemeinsame Dimensionen: **Fidelity** echte TLS-Sockets auf Loopback, Testadapter in echter
Sandbox; **Reuse** siehe Recherche §2.1; **Dependencies** T83.0; **Non-functional** Ziele
in Epic §3.

```text
Aufgabe: T83.3 Kopplung
Evidence: ADR-0118 §7; fleet.ts createInvite/redeem; webauthn.ts
Slices:
  - S1 Einladung anlegen, Hash, Ablauf — contracts→core→hub→PWA V6 — test: core/test/modules/team/pairing.test.ts
  - S2 Kopplungsserver, Pin, Exporter-Codes — core→hub — test: hub/test/modules/team/pairing.integration.test.ts
  - S3 Codes tippen, Passkey/hubctl, Pins — hub→PWA/hubctl — test: e2e/specs/team-pairing.spec.ts
Edges: Neustart mitten drin, zweite Anfrage gleichzeitig, Uhr falsch, Fenster offen bei Absturz, IPv6
Fragility: TLS-Optionen in neuen Node-Versionen; Exporter-Kontext ändert Codes → Protokollversion
Out of scope: QR-Scan aus der Ferne, Kopplung zu dritt
Annahme: Passkey ist auf beiden Hubs einrichtbar, sonst hubctl
Open questions: keine
```

```text
Aufgabe: T83.4 Journal und Synchronisation
Evidence: ADR-0119 §1–4; heutiger team/store.ts (künftig swarm/); K5 in sessions/event.ts
Slices:
  - S1 Umschlag, Signatur, Hash-Kette, Prüffolge — contracts→core — test: team/envelope.test.ts
  - S2 Journal, Recovery, kaputte Zeile — core — test: team/journal.test.ts
  - S3 Abgleich über Socket, sichtbar im Verlauf V9 — hub→PWA — test: team/sync.integration.test.ts, team-verlauf.spec.ts
Edges: Abriss nach fsync vor ACK, doppelte ID mit anderen Bytes, 4096/4097 Byte, altes Backup, Disk voll
Fragility: unbekannte Ereignisart muss hash-fest gespeichert werden (Bytes, nicht geparstes Objekt)
Out of scope: Kompaktierung, Weiterleitung über Dritte
Open questions: keine
```

```text
Aufgabe: T83.8 Sandbox und Agentengrenze
Evidence: ADR-0119 §7; ADR-0122; packages/workers; issue-bridge.ts buildIssuePrompt
Slices:
  - S1 teamTaint am Session-Record, überlebt Neustart/Fork/Übergabe — contracts→core — test: sessions/team-taint.test.ts
  - S2 Sandbox: Hülle, Klon, Selbsttest, 422 — contracts→workers→hub→PWA-Grund — test: workers/test/sandbox.integration.test.ts
  - S3 Egress-Proxy und Session-Socket — core→hub — test: hub/test/modules/sandbox/egress.integration.test.ts
  - S4 Pi, dann Claude, Codex im Testkit — adapter — test: je Adapter sandbox.test.ts
  - S5 „An Agent geben“ mit Vorschau — hub→PWA V8 — test: e2e/specs/team-agent-boundary.spec.ts
Edges: laufende saubere Session bekommt Team-Text, Kind-Session, Auto-Resume, Warteschlange, Loop, Adapterwechsel
Fragility: jeder neue Session-Erzeuger kann teamTaint vergessen → Test über alle Aufrufer von SessionManager.create
Edges Sandbox: kein userns, bwrap fehlt, Symlink/Hardlink nach außen, bösartige .git-Konfig, DNS auf private IP, Worker-Übernahme
Out of scope: macOS/Windows-Ausführung
Open questions: keine
```

```text
Aufgabe: T83.11 Begleiter
Evidence: ADR-0120; Nyx.tsx ATLAS; 42-nyx.css; design-system.md Nyx-Blatt
Slices:
  - S1 Profil lokal, Werkstatt, Nyx unverändert als Standard — contracts→core→hub→PWA — test: companions.test.ts, team-companion.spec.ts
  - S2 fünf Formen mit Masken — PWA — test: Atlas-Prüfung (Bilder, Größe, Prüfsumme)
  - S3 Sync, Schemen, Verwechslungshinweis — core→PWA — test: profile-sync.integration.test.ts
Edges: Emoji-Grapheme, RTL, 24/25 Grapheme, unbekannte Form, offline, gleiche Namen
Fragility: Zustandsnamen im Atlas sind Vertrag mit nyx-state.ts
Out of scope: Uploads, Stimme
Open questions: keine
```

```text
Aufgabe: T83.14 Geteilte Session
Evidence: ADR-0121, ADR-0122; session-queue.ts (actor je Eintrag); sessions/ws.ts (drop-on-slow); ADR-0083
Slices:
  - S1 observe: teilen, Verlauf ab jetzt, Daueranzeige — contracts→core→hub→PWA V12/V13 — test: team/share.integration.test.ts
  - S2 Live-Frames, Resync, langsamer Zuschauer bremst Gastgeber nicht — hub→PWA — test: team/share-live.integration.test.ts
  - S3 steer: sechs Befehle, Warteschlange, Konflikt, Stopp — core→hub→PWA — test: e2e/specs/team-shared-session.spec.ts
Edges: Ablauf mitten im Zug, Widerruf, Gastgeber offline, zwei Antworten zugleich, Archiv, Fork, Adapter ohne Sandbox
Fragility: neue Steuerart darf nicht automatisch fernnutzbar werden → feste Liste, Test über alle SteerInput-Arten
Out of scope: Werkzeugfreigabe aus der Ferne, Terminal, Anhänge
Open questions: keine
```

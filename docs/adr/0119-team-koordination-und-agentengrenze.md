# ADR-0119 — Team: Aufgaben, Synchronisation, Rechte und Agentengrenze

**Status:** angenommen (Nutzerentscheide E5, E5b, E6, E9–E11 vom 24.11.2026) · **Betrifft:**
EPIC-P83, künftig `packages/contracts/src/team/`, `packages/core/src/modules/team/`,
`packages/contracts/src/sessions/` (Feld `teamTaint`), `packages/contracts/src/swarm/`
(additives `origin`), `apps/gateway-mcp/src/operations.ts` · **Bezug:** ADR-0018, ADR-0021,
ADR-0024, ADR-0064, ADR-0077, ADR-0118, ADR-0121, ADR-0122, ADR-0123, PRD §8.5

## Entscheidung

### 1. Ein Schreiber je Aufgabe

Die erstellende Instanz ist **Heim** der Aufgabe und ordnet alle Änderungen. Andere senden signierte
Befehle; das Heim nimmt an oder lehnt sichtbar ab und schreibt ein Ereignis. Team-Verwaltung
(Mitglieder, Rollen) hat das Gründer-Heim. Chat ist je Absender ein eigener Strom. Kein CRDT, kein
Konsens. Ist das Heim offline, bleiben Befehle als „vorgemerkt“ beim Absender.

Heimwechsel: ausdrückliches `task.rehomed` des alten Heims mit höherer Epoche. Ist das Heim verloren,
legt ein Mensch eine neue Aufgabe mit `supersedes` an. Kein automatischer Wechsel.

### 2. Umschlag

```text
Befehl   { v, commandId, teamId, taskId|null, from, to, actor, onBehalfOf, reason, issuedAt,
           expiresAt, expectedRev, kind, body }                  ≤ 2 KiB
Ereignis { v, teamId, stream, epoch, seq, prevHash, at, kind, command|null, commandSig|null, body } ≤ 4 KiB
Draht    { bytes, sig }   sig = ECDSA-P-256/SHA-256 über genau diese Bytes, Präfix "av-team-v1\0"
```

Signiert werden die übertragenen Bytes; es gibt keine Kanonisierung. `actor` ist
`{ kind: human|agent, memberId, agentId?, deviceLabel?, sessionRef? }`; `onBehalfOf` ist die
verantwortliche Person, bei Agenten Pflicht. `reason` ist bei Zuweisung, Ablehnung, Freigabe,
Abbruch und Rechteänderung Pflicht. Text über 1 KiB wird Blob (SHA-256, ≤ 8 MiB, Prüfung nach
Empfang, nur auf Abruf).

### 3. Zustellung und Idempotenz

Mindestens einmal, dauerhaft dedupliziert über `commandId`; gleiche ID mit anderen Bytes ist ein
Sicherheitsereignis. Prüffolge: Größe → Signatur und `from` = TLS-Peer → `teamId`/`to` → Sperrliste →
Ablauf → Duplikat → Rolle → `expectedRev` → Zustandsregel. Ablehnungen tragen feste Codes:
`revoked`, `forbidden`, `expired`, `conflict`, `bad_signature`, `too_large`, `rate_limited`,
`invalid_transition`, `incompatible`. Uhren ordnen nichts; Abweichung über 2 min wird angezeigt,
Ablauf hat 5 min Toleranz.

Beim Verbinden tauschen beide Seiten je Strom `(epoch, seq, headHash)`. Fehlendes wird seitenweise
nachgeladen (100 Ereignisse). Ungleicher Hash bei gleicher Sequenz → Strom **eingefroren**, rote
Meldung, Mensch entscheidet. Kennt der Peer mehr von *meinem* Strom als ich (altes Backup), lade ich
meine signierten Ereignisse zurück, bevor ich schreibe.

### 4. Persistenz (K7)

`data/teams/<teamId>/events.jsonl` und `outbox.jsonl`, fsync vor Bestätigung, `snapshot.json` atomar.
SQLite nur als ableitbarer Index. Defekte letzte Zeile wird abgeschnitten und gemeldet; Lücke oder
falscher Hash in der Mitte friert den Strom ein und lädt nach. Offene Rückfragen überleben den Start.

### 5. Aufgabenzustände

`draft → offered → accepted → working → submitted → done`; dazu `declined`, `withdrawn`, `blocked`,
`stalled`, `changes_requested`, `failed`, `cancelled`.

| Übergang | Wer | Regel |
|---|---|---|
| draft→offered | Ersteller (Mensch) | genau eine zuständige Person, Grund |
| offered→accepted/declined | zuständige Person | Agent nie |
| accepted→working | zuständige Instanz | Abhängigkeiten `done` |
| working→submitted | zuständige Person | Ergebnis, Commit-SHA, Prüfnachweise |
| submitted→done/changes_requested | Prüfer, nicht die zuständige Person | bei Zwei-Personen-Team der Ersteller; ist er selbst zuständig, die andere Person |
| →blocked | zuständig | Grund, worauf gewartet wird |
| →stalled | Heim | 15 min ohne Lebenszeichen bei `working`; nur Anzeige |
| Übergabe | abgebend bietet an, aufnehmend nimmt an | `generation+1`, Übergabenotiz Pflicht |
| Neuvergabe bei Ausfall | Ersteller | `generation+1`; alte Ergebnisse werden `stale` |
| →cancelled/withdrawn | Ersteller | Grund; laufende Session wird geparkt |

Abhängigkeiten nur innerhalb eines Teams, Zyklusprüfung am Heim; über mehrere Heime hinweg wird ein
Zyklus nur im bekannten Stand erkannt und sonst als `blocked` sichtbar. Jede Aufgabe hat immer genau
eine verantwortliche Person; Agenten sind Ausführende.

### 6. Rechte

| Recht | Beobachter | Mitwirkend | Gründer | Agent |
|---|---|---|---|---|
| Team lesen | ja | ja | ja | nur Aufgabe seiner Session |
| Nachricht | nein | ja | ja | mit Freigabe seines Menschen |
| Aufgabe anbieten | nein | ja | ja | nein (Entwurf mit Freigabe) |
| annehmen, einreichen | nein | eigene | eigene | nein |
| prüfen | nein | als Prüfer | als Prüfer | nein |
| Mitglied, Rolle, Widerruf | eigene Verbindung | eigene Verbindung | Team | nein |

Zusätzlich entscheidet jede Instanz je Projekt: nicht geteilt (Standard), Metadaten, Aufgaben,
Artefakte. Es gilt die Schnittmenge, lokal gewinnt. **Außerhalb
ausdrücklich geteilter Sessions (ADR-0121) existiert kein Befehl** für Session oder Prompt; für
Werkzeug, Freigabe, Terminal, Datei, Einstellung, Token oder Flotte existiert nie einer.

Policy neu: `team.read` (human/agent allow, agent gefiltert), `team.say` (human allow, agent
approve), `team.task` (human allow, agent deny), `team.manage` (human allow, sonst deny). `fleet`,
`bridge`, `companion`, `display` überall deny; die Einladung und jede Rechteausweitung zusätzlich
Passkey oder `hubctl`.

### 7. Agentengrenze (PRD §8.5)

1. Fremder Inhalt wird nie automatisch in eine Session, einen Plan, Systemprompt, Skill oder eine
   `AGENTS.md` geschrieben.
2. „An Agent geben“ ist eine Handlung eines Menschen mit voller Vorschau und Datenrahmen. Der Rahmen
   dient der Lesbarkeit, er ist keine Sicherheitsgrenze.
3. Eine so gestartete oder ergänzte Session trägt dauerhaft `teamTaint: { teamId, refs }`, auch nach
   Neustart, Fork, Übergabe und in Kind-Sessions eines Swarms.
4. Für `teamTaint` gilt serverseitig: Sandbox nach ADR-0122 ist Pflicht, sonst 422; keine Loop-,
   Factory- oder Automationsziele; Freigaben zeigen die Herkunft.
5. Enthält ein übernommener Git-Stand Team-Commits, gilt die Session ebenfalls als `teamTaint`.
6. Agentennachrichten sind je Aufgabe und Richtung einstellbar (E5): `ausgehend: ask | auto`,
   `eingehend: preview | auto`. Standard ist `ask`/`preview`. `auto` setzt ein Mensch der jeweiligen
   Seite mit Passkey oder `hubctl`, befristet auf höchstens 24 h. Technisch ist es eine dauerhafte
   menschliche Freigabe mit einem `team.auto_released`-Ereignis je Nachricht; die Invariante aus
   ADR-0021 bleibt. Immer aktiv: Secret-Scan, 30 Nachrichten je Aufgabe und Stunde, nach sechs
   Agentenzügen ohne Menschen Pause, Not-Stopp. Eingehend `auto` ist eine eng begrenzte Ausnahme von
   §7.1–2 und von der AGENTS.md-Regel zu Agenten-Output; sie gilt nur für eine Session, die bereits
   `teamTaint` ist, und braucht vor der Umsetzung eine AGENTS.md-Ergänzung.
   Beide Richtungen `auto` auf derselben Seite sind nur möglich, weil und solange die Session in der
   Sandbox läuft (E5b); Egress-Liste und Secret-Scan bleiben aktiv.
7. Ausgehend: Secret-Scan (Muster aus `scripts/check-secrets.mjs`), Treffer sperrt; ein Mensch kann
   mit Grund überstimmen. Vorschau zeigt die exakten Bytes.

### 8. Repo und Arbeitsordner

Kein gemeinsamer Arbeitsordner und kein Netzlaufwerk. Jede Instanz arbeitet im eigenen Worktree, Sandbox-Sessions im eigenen Klon (ADR-0122 §4).
Repo-Identität: Menge der Root-Commits plus von Menschen bestätigte Zuordnung; Remote-URLs ohne
Zugangsdaten nur als Hinweis. Standard: gemeinsamer Remote mit je eigenem Konto, Branch
`team/<kurz-id>/<instanz-kurz>`; das Team tauscht nur Branch und SHA aus. Pfadansprüche sind Hinweise
und zeigen Überschneidungen, entscheidend bleibt der Git-Merge durch einen Menschen.

Ohne Remote (T83.10): `git bundle` ≤ 8 MiB als Blob, Import in ein leeres Bare-Repo mit
`transfer.fsckObjects=true`, `core.hooksPath=/dev/null`, ohne Submodule, `bundle verify`, Zeit- und
Größenlimit; danach als `refs/team/…`, nie direkt auf einen Branch.

### 9. Swarms

`Swarm` (ADR-0123) bekommt additiv `origin: { teamTaskRef, actor } | null`; der Dispatch trägt den auslösenden
Akteur statt des festen `"team"`. Statusübergänge aus ADR-0064 bleiben.

### 10. Grenzen

Je Peer: 20 Befehle/s, Stoß 100; 60 Nachrichten/min; 4 Blobs parallel; 1 GiB Blobspeicher je Team;
10 000 offene Aufgaben. Überschreitung: `rate_limited` und sichtbares Ereignis.

## Konsequenzen

- Heim offline heißt: die Aufgabe ruht sichtbar. Dafür gibt es keine Verzweigung.
- Adapter ohne Sandbox-Nachweis sind für Team-Inhalte gesperrt.
- K5 (4 KiB), K7 (Journal), K8 (Lasttest), K10 (Offline). Contracts erst nach Annahme dieses ADR.

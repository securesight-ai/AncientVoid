# EPIC-P83 — Team: gemeinsam arbeiten über mehrere AncientVoid-Instanzen

**Status:** In Umsetzung — Starttor T83.0 am 25.11.2026 genommen (Betreiberbestätigung der Bind-Regeln nach ADR-0118 §3 und der Egress-Regeln nach ADR-0122 §5 liegt vor; Aufgabenbündelung je PR freigegeben, Tests je Aufgabe getrennt) · **Phase:** P83 · **Dauer:** 13–18 Agenten-Wochen · **Abhängigkeit:** [P82 abgeschlossen](EPIC-P82-audit-raeumen-inventar-schnitt-haertung.md) und im [Nightly auf `4f8533cf`](https://github.com/securesight-ai/AncientVoid/actions/runs/45566415645) enthalten, P6/P60 fachlich umgesetzt, P45-No-go bleibt, P30/P31 On hold unberührt. Tracker-Issue: #421.

Grundlagen: [Recherche und Threat Model](../docs/2026-11-24_team-kollaboration-recherche.md) ·
[Feinkonzept](../docs/2026-11-24_team-feinkonzept.md) ·
[ADR-0118](../docs/adr/0118-team-verbindung-identitaet-kopplung.md) ·
[ADR-0119](../docs/adr/0119-team-koordination-und-agentengrenze.md) ·
[ADR-0120](../docs/adr/0120-begleiter-profile.md) ·
[ADR-0121](../docs/adr/0121-geteilte-sessions.md) ·
[ADR-0122](../docs/adr/0122-sandbox-fuer-worker.md) ·
[ADR-0123](../docs/adr/0123-swarm-und-team.md)

## 1. Ziel

Zwei bis acht Menschen koppeln ihre Hubs sicher, verteilen Aufgaben, lassen ihre eigenen Agenten daran
arbeiten und sehen jeden Schritt: wer, was, wann, warum, in wessen Auftrag. Mehrere Menschen verfolgen
und steuern eine ausdrücklich geteilte Session; Werkzeugfreigaben bleiben beim Gastgeber. Alles ist
self-hosted, im privaten Netz und für jeden Nutzer des öffentlichen Repos einrichtbar. Ein Widerruf
wirkt sofort.

## 2. Scope (In / Out)

**In:** Kopplung, Identität, Rotation, Widerruf; signiertes Protokoll; Aufgaben, Übergaben, Prüfung;
Räume und Verlauf; Agentengrenze; Repo-Austausch; Sandbox (ADR-0122); Umbenennung zu Swarm (ADR-0123);
geteilte Sessions (ADR-0121); Chat mit animierten Begleitern; Begleiter-Profile; Anleitung für LAN, WireGuard und Tailscale.

**Out:** öffentlicher Port, Relay, Cloud-Dienst; Fernstart von Sessions, Fern-Freigaben;
gemeinsame Arbeitsordner; unterschiedliche Rechte der Personen eines Hubs; automatischer Merge; Datei-Uploads für Begleiter; Ausführung auf macOS/Windows;
Änderungen an der Flotte (ADR-0017).

## 3. Design-Details

Regeln in den ADRs, Abläufe und Ansichten im Feinkonzept. Messziele:

| Ziel | Wert | Messlatte |
|---|---|---|
| Ereignis sichtbar beim Partner | p95 ≤ 1 s direkt, ≤ 2 s über Overlay-Relay | K1-nah |
| Widerruf lokal / bei verbundenen Mitgliedern | ≤ 1 s / ≤ 5 s | K1 |
| Getrennter Peer sichtbar | ≤ 60 s (Soll 45 s) | K9 |
| Wiederherstellung 10 000 Ereignisse | 100 %, < 3 s | K7 |
| Befehl / Ereignis | ≤ 2 KiB / ≤ 4 KiB | K5 |
| Last | 8 Instanzen, 20 Sessions, 30 ev/s, kein Verlust | K8 |
| Gespräch mit Bühne | kein Frame > 200 ms, p95 ≤ 32 ms | K2 |
| Offline | letzter Stand mit Zeit, keine weiße Seite | K10 |
| Gateway mit zwei neuen Operationen | statisch < 1 000 Token | K4 |

### Reihenfolge

```text
T83.0 → T83.1 → T83.2 → T83.3 → T83.4 → T83.5 → T83.6 → T83.7 → T83.8 → T83.9
                                                    ├→ T83.10 (Bundle, optional nach E9)
        T83.11 S1–S2 ab T83.0 möglich, S3 ab T83.4 ─┴→ T83.12 → T83.13
        T83.14 nach T83.5 und T83.8, vor T83.13
```

T83.5 (Widerruf) liegt bewusst vor jeder Nutzfunktion.

## 4. Aufgaben (Checkliste)

- [x] **T83.0** Entscheidungstor: P82 grün geprüft, [AGENTS.md](../AGENTS.md) ergänzt. Betreiberbestätigung der Bind-Regeln nach [ADR-0118 §3](../docs/adr/0118-team-verbindung-identitaet-kopplung.md#entscheidung) und der Egress-Regeln nach [ADR-0122 §5](../docs/adr/0122-sandbox-fuer-worker.md#entscheidung) erteilt am 25.11.2026 (Betreiber; beide Regelwerke unverändert bestätigt). Kein Code davor.
- [x] **T83.1** Umbenennung Agenten-Team → Swarm nach ADR-0123 (reiner Rename mit Migration, eigener PR), danach Auftraggeber statt fest `"team"` und additives `Swarm.origin`. Altdaten-Fixture, Automationen, Redirect-Spec `e2e/specs/swarm.spec.ts`. **K7/K10** — umgesetzt 25.11.2026: Module/Routen/Assets in `swarm/` umbenannt, `data/team/`→`data/swarm/`-Migration mit `run`/`teamId`-Toleranz, `#/runs`+`#/teams`→`#/swarms`-Redirects, `/api/teams` 404, Swarm-Ursprung mit Auftraggeber-Akteur; belegt durch `swarm.test.ts` (32, inkl. Altdaten-Fixture), Integrationstests, E2E `swarm.spec.ts` (Redirects), Tier-A-Suite, Lint, Typecheck.
- [x] **T83.2** Instanz und Link: Schlüssel, Listener/Dialer, Adressprüfung, Pins, Zustand in V7. Tests: Wildcard/öffentliche Adresse = Startfehler, TLS 1.2, fremder Schlüssel, Resumption, DNS-Rebinding, kein `/api`. **K9** — umgesetzt 25.11.2026: `data/teams/identity/` (ECDSA-P-256, instanceId=SHA-256(SPKI) base64url, x509-Selbstsignatur 180 Tage, 0600/0700 als Startfehler), TLS-1.3-Listener mTLS mit ALPN `av-team/1`, SPKI-Pin vor erster Nachricht, ein WS-Pfad `/team/v1`, Dialer mit Rebinding-Schutz, Config `team.listen` (Standard null = kein Socket); Link-Zustand `TeamLinkState`/`TeamPeerPin` im Contract (V7-Ansicht folgt mit T83.3, wo Mitglieder existieren). Belegt: `identity.test.ts` (6), `net.test.ts` (9, inkl. DNS-Rebinding + Wildcard/öffentlich = Startfehler), `link.integration.test.ts` (6: TLS 1.2, fremder Schlüssel, fehlender ALPN, gültiger Dial, resume=0, `/api` 404), Tier-A 3326 grün, Lint, Typecheck.
- [ ] **T83.3** Kopplung über PWA und `hubctl` (Feinkonzept §5). Spec `e2e/specs/team-pairing.spec.ts`. **K1**
- [ ] **T83.4** Journal, Signatur, Abgleich, Verlauf. Spec `team-verlauf.spec.ts`. **K5/K7**
- [ ] **T83.5** Widerruf und Rotation Ende-zu-Ende, `hubctl team revoke` auch ohne laufenden Hub. Spec `team-revoke.spec.ts`. **K1/K7**
- [ ] **T83.6** Aufgaben: anbieten bis abnehmen, Abhängigkeiten, Übergabe, Ausfall, Konflikt; Rollen und Projektfreigabe. Ansichten V1, V3–V5. Spec `team-task.spec.ts`. **K1/K10**
- [ ] **T83.7** Räume, Benachrichtigung, Secret-Scan, Export/`verify`. Spec `team-room.spec.ts`. **K5**
- [ ] **T83.8** Sandbox nach ADR-0122 (Hülle, Klon, Egress, Selbsttest, Adapter Pi → Claude → Codex), dann Agentengrenze `teamTaint`, „An Agent geben“, `team.say`. Spec `team-agent-boundary.spec.ts`. **K1/K4/K7**
- [ ] **T83.9** Ausfall: Neustart, Abriss, altes Backup, eingefrorener Strom, Disk voll. Test `team/recovery.integration.test.ts`. **K7/K10**
- [ ] **T83.10** Repo: gemeinsamer Remote mit SHA-Nachweis und Überschneidungshinweis; danach optional Bundle-Quarantäne (E9). Test `team/repo.integration.test.ts`. **K3**
- [ ] **T83.11** Begleiter-Profile, Werkstatt, fünf Formen, Sync. Spec `team-companion.spec.ts`. **K2/K10**
- [ ] **T83.12** Lebendiges Gespräch (Chat, Bühne, Tippen, auch für lokale Swarms), Barrierearmut, Lastlauf und Latenzmessung zwischen zwei Standorten (`docs/messlauf/`). Spec `team-chat.spec.ts`. **K2/K8**
- [ ] **T83.14** Geteilte Session: verfolgen, dann steuern; Personen je Hub (Feinkonzept §5). Spec `team-shared-session.spec.ts`. **K1/K2/K8**
- [ ] **T83.13** Zielszenario `e2e/specs/team-zielszenario.spec.ts`, unabhängiges Red-Team gegen TM1–TM23, `docs/security.md`, How-to (Tailscale, WireGuard, LAN) und englischer Guide, Funktionsinventar, i18n, Retro. **K1–K10**

Jede Aufgabe ist ein eigener Branch und PR, rot-dann-grün, mit Erreichbarkeit in Oberfläche oder CLI.

## 5. Acceptance Criteria

- **AC-P83-1:** Ohne `team.listen` ist kein Team-Socket offen; Wildcard und öffentliche Adresse verhindern den Start.
- **AC-P83-2:** Kopplung gelingt nur mit Pin, Einmalgeheimnis, beiden richtigen Codes und Bestätigung auf beiden Seiten; je ein fehlender Faktor, Ablauf und Wiederverwendung scheitern im Test ohne gespeicherten Pin.
- **AC-P83-3:** Ein gekoppelter Peer erreicht keine `/api`-Route und kann außerhalb einer gültigen `steer`-Freigabe mit keiner Nachricht eine Session beeinflussen und nie ein Werkzeug freigeben (Fuzz über alle Ereignisarten plus Negativtests).
- **AC-P83-4:** Wiederholung, Fälschung, falsche Zielgruppe, Ablauf, Übergröße und doppelte ID mit anderem Inhalt werden mit dem festgelegten Code abgelehnt und sind sichtbar.
- **AC-P83-5:** Nach Widerruf ist der offene Socket ≤ 1 s zu, Neuverbindung und Resumption scheitern, vorgemerkte Post ist weg, verbundene Mitglieder sehen es ≤ 5 s; das gilt auch nach Neustart.
- **AC-P83-6:** Rotation ohne Ausfall; alter Schlüssel nach 24 h abgelehnt.
- **AC-P83-7:** Jeder Zustandsübergang aus ADR-0119 §5 ist positiv und negativ getestet; jede Aufgabe hat jederzeit genau eine verantwortliche Person.
- **AC-P83-8:** Abriss an jeder Stelle des Versands verliert und verdoppelt nichts; Wiederherstellung 10 000 Ereignisse 100 % in < 3 s; altes Backup schreibt nicht doppelt.
- **AC-P83-9:** Zu jedem Verlaufseintrag sind wer, was, wann, warum und Auftraggeber sichtbar; Export verifiziert offline, eine geänderte Zeile fällt auf.
- **AC-P83-10:** Team-Text erreicht eine Session nur nach menschlicher Vorschau; die Session ist dauerhaft `teamTaint`, läuft ausschließlich in der Sandbox, sonst 422; alle Session-Erzeuger sind abgedeckt.
- **AC-P83-11:** Standard ist `ask`/`preview`; `auto` gibt es nur nach menschlicher, befristeter Freigabe je Richtung, mit Ereignis je Nachricht, Limits und Pause nach sechs Zügen; ein Test-Secret wird immer gesperrt.
- **AC-P83-16:** `observe` kann nichts ändern; `steer` kann genau die sechs Befehle; Freigaben, Terminal, Dateien und andere Sessions sind im Test abgelehnt; Ablauf und Rücknahme wirken ≤ 1 s; ein langsamer Zuschauer bremst die Session nicht.
- **AC-P83-17:** Im Chat ist jede Figurenbewegung einem echten Ereignis zugeordnet, Live-Text stammt aus Frames, nicht freigegebener Text verlässt den Hub nicht.
- **AC-P83-19:** In der Sandbox sind Host-Home, Hub-Daten, Hub-Port, private Netze und nicht freigegebene Hosts unerreichbar; Ausbruchstests über Git-Hooks/-Konfig, Links, Sockets und DNS scheitern; ohne bestandenen Selbsttest startet nichts.
- **AC-P83-20:** Nach der Umbenennung sind Alt-Swarms, Automationen und Links zu 100 % nutzbar; kein Altwert wird als Team von Menschen gelesen.
- **AC-P83-18:** Ein Fremder richtet die Funktion allein nach Anleitung im LAN ohne Tailscale ein; keine festen Namen, Hosts oder Konten im Code.
- **AC-P83-12:** Alle Abläufe V1–V14 gehen bei 390 px und 1440 px, per Tastatur, mit reduzierter Bewegung und im Chat ohne Bühne; Offline zeigt Stand und Zeit.
- **AC-P83-13:** Begleiter sind anpassbar, überleben Neustart, synchronisieren; gleiche Namen bleiben durch Person und Abzeichen unterscheidbar; unbekannte Form zeigt „Schemen“.
- **AC-P83-14:** Messziele aus §3 sind mit datiertem Messlauf belegt.
- **AC-P83-15 (Zielszenario):** Zwei `TestHub`-Instanzen mit getrennten Datenordnern, Schlüsseln und Browserkontexten: koppeln → Aufgabe anbieten → annehmen → Session beider Seiten mit Testadapter in der Sandbox → Session teilen, zweiter Mensch verfolgt und steuert → Agentenfrage mit zwei Freigaben → einreichen → Änderungen → abnehmen → Verlauf auf beiden Seiten gleich (Kopf-Hash) → Widerruf während laufender Arbeit → Zugriff gesperrt, Session geparkt, nichts mehr zugestellt.

Menschen-Abnahmen (zwei Standorte, echte Geräte, Verständlichkeit des Gesprächs) sind nach P000 verschoben: T000.34–T000.36.

## 6. Premortem

1. **Die Grenze wird aus Bequemlichkeit aufgeweicht** („Ben soll nur schnell starten dürfen“). Mitigation: Steuern nur je geteilter Session mit fester Befehlsliste; AC-P83-3/16 als Dauertest; Änderung nur per ADR.
2. **Ein neuer Session-Erzeuger vergisst `teamTaint`.** Mitigation: Feld wird im Kern aus der Herkunft abgeleitet, Test über alle Aufrufer.
3. **Freigabe-Müdigkeit:** jede Agentennachricht fragt, Menschen tippen blind. Mitigation: Entwürfe je Aufgabe bündeln, Kennzahl Freigaben je Aufgabe im Messlauf; Lockerung nur mit neuem Entscheid.
4. **Sandbox läuft auf einer Distribution nicht** (keine User-Namespaces). Mitigation: Selbsttest mit Klartextgrund, Verfolgen bleibt möglich, Matrix in der Anleitung.
5. **Overlay-Einrichtung scheitert beim Partner.** Mitigation: Diagnose mit einzelnen Schritten (erreichbar, Port, Pin, Version), Anleitung Tailscale/Headscale, Gerätetest vor Zusage.
6. **Heim offline blockiert.** Mitigation: klare Anzeige, Heimwechsel, `supersedes`; Dauer im Messlauf beobachten.
7. **Backup-Rücksicherung erzeugt zwei Wahrheiten.** Mitigation: Kopfvergleich vor Schreiben, Einfrieren, AC-P83-8.
8. **Widerruf wirkt, aber Resumption läuft durch.** Im PoC nachgewiesen. Mitigation: Pin je Verbindung und Kontextwechsel, AC-P83-5.
9. **Die Bühne wird Spielerei und langsam.** Mitigation: nur Ereignisse bewegen, Chat ohne Bühne vollständig, Budgets im Test.
10. **Umfang läuft weg.** Mitigation: nach T83.8 nutzbarer Stand ohne Bühne; T83.10 Bundle optional.
11. **Die Sandbox wird löchrig, weil ein Harness mehr Zugriff „braucht“.** Mitigation: Profile je Adapter im Testkit, Ausbruchstests, Erweiterung nur per ADR.
12. **Umbenennung trifft Altbestand.** Mitigation: zwei PRs, Altwerte bedeuten immer Swarm (ADR-0123), Fixtures.

## 7. Definition of Done

- Alle T83.* und AC-P83-* mit Beleg; gezielte Tests, `npm run lint`, `npm run typecheck` je PR;
  `npm run gate` lokal grün; GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün;
  jede neue UI-Funktion und jeder Ablauf mit Spec in `e2e/specs/`. Rote CI allein wegen der Umgebung
  wird benannt, nie als Pass gezählt.
- Alle Ansichten sind über Dock/Teams, Kommandoleiste und `hubctl` erreichbar, Texte de/en.
- Contracts erst nach angenommenem ADR; K5- und K7-Nachweis je Zustandsquelle; Backup/Restore erprobt.
- Red-Team-Befunde behoben oder mit Nutzerentscheid benannt; keine Schlüssel oder Codes in Logs.
- Lebende Dokumente nachgezogen, `npm run check:context` und `npm run check:epics` grün.
- Defekt-PRs mit `Fixes #<nr>`, Tracker-Issues gesichtet, Menschen-Abnahmen in P000.

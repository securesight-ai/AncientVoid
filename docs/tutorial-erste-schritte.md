# Erste 15 Minuten — vom Klon zum ersten gesteuerten Agenten

**Art:** tutorial

Stand 2026-11-23 (Frischhalte-Review, drift 31 > 30 nach BUG-0255/0256- und
Ralph-PRs): Wizard-Pfad (`./setup.sh --yes --adapter=dummy`), Device-Token und
`/api/ready` unverändert; der Erststart-Ablauf (Dock → Session → Nachricht)
bleibt derselbe. Neue Oberflächen-Details ändern ihn nicht: Icon-Leisten-
Tooltips stehen rechts neben dem Icon (BUG-0255), die Glocke trägt ihre
Zahl links außen (BUG-0256), und `ralph-hub` ist der zu registrierende
Ralph-Loop für freie Adapterwahl ([loops.md](loops.md)) — alles nach dem
Erststart-Thema dieses Tutorials. Main-Sync, Statuspunkte und
Prompt-Verbessern bleiben wie zuvor beschrieben.

Ziel: Du hast einen laufenden Hub, dein Handy zeigt ihn an, und du hast von
dort aus eine Nachricht an eine laufende Agent-Session geschickt. Wir nehmen
den eingebauten Übungsagenten `dummy` — er braucht kein Konto und keinen
API-Schlüssel und kann nichts kaputt machen. Einen echten Agenten bindest du
danach an ([`onboarding.md`](onboarding.md) §6). Zeitplan: Hub ≤ 5 Minuten,
Handy erreicht den Hub ≤ 10, erste Nachricht ≤ 15 (Richtwerte, noch nicht
gemessen — EPIC-P57 T57.10).

Du brauchst: Node 22.18+, 24 oder 26+, git, npm, curl, ein Handy und
[Tailscale](https://tailscale.com) auf Rechner und Handy (nur für Schritt 6).

Bezeichner wie `<…>` sind Platzhalter. Befehle in Blöcken mit `tutorial-step`
werden im Test gegen einen echten Hub ausgeführt; `tutorial-manual` sind
Schritte, die auf deinem Rechner oder Handy passieren.

## 1. Klonen und Wizard starten

```bash tutorial-manual
git clone <repo-url> AncientVoid && cd AncientVoid
./setup.sh --yes --adapter=dummy
```

Der Wizard prüft die Voraussetzungen, legt `hub.config.json` an, installiert,
baut die PWA, stellt ein **Device-Token** aus und startet den Hub. Er
schlägt laut fehl, wenn etwas fehlt; die Exit-Codes stehen in
[`referenz-wizard.md`](referenz-wizard.md). Ein zweiter Lauf ist sicher.

**Kopiere das angezeigte Token jetzt** — es wird nur einmal gezeigt (der Hub
speichert nur einen Hash). Verloren? `hubctl token revoke` und neu ausstellen
([Token-Rollen](security.md)).

Erwartetes Ende der Ausgabe: `bereit: http://127.0.0.1:7373 (GET /api/ready = 200)`.

## 2. Prüfen, dass der Hub läuft

```bash tutorial-step
curl -sf "$ANCIENTVOID_URL/api/ready"
node apps/hubctl/src/cli.ts adapters
# erwartet: dummy
```

Siehst du `dummy` in der Liste, ist der Übungsagent angebunden. Siehst du
nichts, hilft [`referenz-wizard.md`](referenz-wizard.md) (Exit-Code) oder der
Skill `setup-wizard`.

## 3. Projekt-Wurzeln eintragen

Sessions laufen in deinen Repos. Am einfachsten beim Wizard:

```bash tutorial-manual
./setup.sh --projects=/home/du/repos
```

(das Flag trägt `projectRoots` in `hub.config.json` ein — Ordner, dessen
**direkte Unterordner** deine Git-Repos sind, Tiefe 1). Ohne das Flag bleibt
die Projektliste leer und der Erststart hängt an dieser Stelle
([BUG-0153](../bugs/bug-0153-erstinstallation-ohne-projektwurzeln.md)).

Alternativ von Hand: Öffne `hub.config.json` im Repo (Felder:
[`referenz-config.md`](referenz-config.md)):

```json
"projectRoots": ["/home/du/repos"]
```

Der Hub liest die Config beim Start — einmal neu starten (beide Befehle,
siehe auch [`howto-provider-wechseln.md`](howto-provider-wechseln.md)):

```bash tutorial-manual
scripts/hub.sh stop && scripts/hub.sh start
```

**Erwartet:** der Hub meldet sich mit `bereit` bzw. `GET /api/ready = 200`.
Danach findest du in „Neue Session“ dein Repo als Projekt.

## 4. Am Rechner anmelden und eine Session starten

Öffne `http://127.0.0.1:7373`, trage unter **Device-Token** dein Token ein und
tippe **Verbinden**. Die Übersicht zeigt den Einstieg für den Erststart. Tippe
auf **Probe-Session (dummy)** — oder unten im Dock auf **Neue Session**, wähle
den Adapter `dummy` und dein Projekt und tippe **Starten**. Die Session
startet auf dem aktuellen `origin/main` und erscheint in der Übersicht; sie
füllt sich mit Ereignissen.

```bash tutorial-step
node apps/hubctl/src/cli.ts sessions
# erwartet: dummy
```

## 5. Handy erreicht den Hub (Tailscale)

Der Hub lauscht nur lokal; fürs Handy gibt es **keinen** offenen Port, sondern
`tailscale serve` (Ende-zu-Ende im privaten Tailnet).

```bash tutorial-manual
scripts/setup-tailscale-serve.sh 7373
```

Das Skript druckt `https://<rechnername>.<tailnet>.ts.net`. Öffne diese
Adresse im Handy-Browser (das Handy muss im selben Tailnet angemeldet sein).

## 6. Handy koppeln

Das Gerät braucht ein **eigenes** Token, damit du es einzeln widerrufen kannst:

```bash tutorial-manual
node apps/hubctl/src/cli.ts token issue handy --db data/hub.db
```

Bringe das Token auf einem selbst gewählten sicheren Weg aufs Handy
(Passwortmanager, „an mich selbst senden“) und gib es im Handy-Browser unter
**Device-Token** ein, dann **Verbinden**. Hänge es **nie** an eine URL
(Browserverlauf). Warum es hier kein Scannen/Koppeln per Code gibt:
[ADR-0073](adr/0073-handy-kopplung.md).

## 7. Den Agenten vom Handy steuern

Öffne auf dem Handy die `dummy`-Session. Der Übungsagent erzählt kurz
los und beruhigt sich dann von selbst. Schreibe im Eingabefeld eine
Nachricht und tippe **Weiter** — während er erzählt, heißt der Knopf
**Vormerken** und deine Nachricht wartet, bis der Zug endet. Gesendet
erscheint sie im Verlauf — du hast den Agenten vom Handy aus gesteuert.
Mit **Stopp** beendest du den Lauf.

Geschafft. Der Übungsagent verlangt keine Freigaben; das siehst du erst mit
einem echten Agenten (Schritt „Weiter“).

## Weiter

- **Echten Agenten anbinden** (claude, codex, opencode, …): [`onboarding.md`](onboarding.md) §6,
  Adapter-Status in der README-Matrix.
- **Freigaben** (der Agent will etwas schreiben, du entscheidest vom Handy):
  erscheinen unter „Du bist dran“ in der Übersicht.
- **Alle Befehle und Felder nachschlagen:** [`referenz-hubctl.md`](referenz-hubctl.md),
  [`referenz-config.md`](referenz-config.md).
- **Brauche ich VoidWarden?** Das ist ein optionales Zusatzgerät (altes
  Handy/Tablet als Kiosk mit Touch-Freigaben und Sprachausgabe, oder ein
  ESP32-Board nur als Statusanzeige). Du brauchst es nicht, um Agenten zu
  steuern. Wenn du es willst: README-Abschnitt „Zusammenspiel mit VoidWarden“.

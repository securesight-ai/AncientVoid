# EPIC-P34 — Arbeitsfläche: klare Navigation, schöne Einstellungen, bessere Session-Erkennung, eigene Fenster

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P34 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** P29-Exit-Kriterien grün. Fachlich baut es auf P18 (Kacheln), P20 (Zoom, Einstellungen), P22/P24 (Erkennung) und P23 (Desktop-Navigation) auf.

**Einordnung (Entscheidung Jan, 07.11.2026):** P34 wird zwischen P29 und P30 geschoben, die Kette lautet P29 → P34 → P30 → P31 → P32 → P33. P34 startet, sobald P29 abgeschlossen ist; P30 wartet auf P34. Die Nummer bleibt P34, damit bestehende Verweise stabil bleiben.

Auslöser: Wunsch von Jan vom 06.11.2026.

> Voice im Side-Menü ist überflüssig, Medien gehört ins Side-Menü, PC in die Einstellungen. Die Einstellungen sehen unschön aus: bessere Struktur, symmetrischer, einfach zu nutzen. Akzentfarbe per Modal wie in GIMP, Schriftgröße und -art mit direkter Vorschau. Die Session-Erkennung funktioniert nicht wirklich gut und wirkt unsymmetrisch und gestaucht. Einzelne Chat-Kacheln als neue Fenster aus der App ziehen, um mehrere Bildschirme in Sessions und Tools zu verwandeln.

**Entscheidungen vom 07.11.2026 (Jan):**

- Die Empfehlungen aus der Planung gelten: Erkennung nach Variante A (Signal-Deck), T34.1 und T34.2 zuerst, `⧉`-Knopf als Zusage und Ziehgeste nach Spike.
- Sprachzugang außerhalb einer Session wird nicht gebraucht und fällt ersatzlos weg, auch am Handy, samt Tests und Doku (§3.1).

## 1. Ziel

Die Navigation enthält nur noch, was gebraucht wird. Einstellungen und Erkennung nutzen am Desktop die volle Fläche und folgen einem einheitlichen, symmetrischen Raster. Akzentfarbe, Schriftart und Schriftgröße sind pro Gerät wählbar und sofort sichtbar. Die Erkennung zeigt die echten Projekte statt Rauschen und findet auch Codex und Hermes. Jede Session und jedes Werkzeug kann als eigenes Fenster auf einen anderen Bildschirm wandern und wieder zurück.

Messlatten: K1 (Freigabe auch im eigenen Fenster), K2 (flüssiger Tail über mehrere Fenster), K7 (Fensterzustand nach Reload wiederherstellbar), K8 (Hub-Last bleibt im Rahmen), K9/R9.7 (nichts still verwerfen, unbekannt statt geraten), K10 (Schriften und Farben auch offline).

### Ist-Aufnahme (`origin/main` 69f834b, 06.11.2026)

Die Befunde stammen aus dem Code und aus Zählungen auf diesem Rechner. Screenshots aus der laufenden App fehlen noch und entstehen in T34.2 als Vorher-Beleg.

| Thema | Befund | Beleg |
|---|---|---|
| **Gestaucht (Hauptursache)** | Am Desktop rendert `App` alle Seiten in der Listenspalte: Einstellungen, Entdeckt, Medien, PC und Status haben höchstens 420 px, daneben bleiben die Kacheln. Das Problem ist also zuerst das Layout, nicht nur das Styling. | `main.tsx` (`aside.split-list`), `.split` in `02-layout.css` |
| Navigation | `GlobalDock` wird nur von `App` gerendert und ist auf dem Handy die untere Leiste, am Desktop die linke. Eine Änderung wirkt also auf beide. Voice öffnet dort das globale Sheet; die Voice-Taste im Composer der Session ist davon getrennt. | `Dock.tsx`, `App.tsx`, `SessionTail.tsx` |
| Einstellungen | Vier lose Karten nacheinander, nur eine mit Überschrift; Schalter als Knopf mit „an“/„aus“; Inhalte ohne Zusammenhang gemischt. | `Settings.tsx`, `App.tsx` |
| Akzentfarbe | Gute Ausgangslage: Das CSS nutzt `var(--accent)` und `color-mix`, kein fest verdrahtetes Amber außerhalb der Token-Definition. `--accent-ink` muss aber zur gewählten Farbe passen. | `01-base.css`, `git grep` |
| Schriftart | Der Fließtext verwendet `--font-mono`, dasselbe Token wie Code und Diff. Eine proportionale Schrift würde also auch Diffs zerstören. Die Schriften kommen von Google Fonts; das widerspricht local-first und K10. | `01-base.css`, `17-code.css`, `index.html` |
| Schriftgröße | 135 feste `font-size: …px` im CSS und 25 inline in TSX, kein einziges `rem`. Einfaches Ändern der Wurzelgröße wirkt deshalb nicht. Der vorhandene Zoom skaliert per CSS `zoom` das ganze Layout, also auch Abstände. | `app/styles/*`, `ui-scale.ts` |
| Erkennung: Rauschen | 122 von 165 Claude-Projektordnern liegen unter `/tmp`, davon 108 `harnez-exec-*`-Kopien mit zusammen 125 Transkripten. | Zählung `~/.claude/projects` |
| Erkennung: falsche Gruppen | Der Ordnername wird nur per exaktem Treffer auf bekannte Projekte zurückübersetzt. 16 Worktree-Ordner erscheinen deshalb als eigene Projekte mit langem Rohnamen. Dabei steht `cwd` in den Transkriptzeilen. | `unMungeProject`, `groups.ts`, Stichprobe |
| Erkennung: Lücken | Es gibt keine Quelle für Codex (55 Rollouts auf diesem Rechner) und Hermes (`~/.hermes/sessions` vorhanden). P22 hatte beides bewusst ausgelagert. | `apps/hub/src/main.ts`, P22 §2 |
| Erkennung: Karte | Ungleiche Höhen, weil Vorschau, Chips und Aktionen je nach Status fehlen; die volle ID liegt als Chip im Blickfeld; `Spiegeln` steht außerhalb der Aktionszeile. | `Discovery.tsx` |
| Kachel-Zustand | `Workspace` ist reine, getestete Logik, „mehrere Browserfenster synchron halten“ war in P18 ausdrücklich Out. | `tiles.ts`, P18 §2 |

## 2. Scope (In / Out)

**In:**
- Voice aus dem `GlobalDock` und das globale Voice-Sheet samt Tests und Doku entfernen, Medien ins `GlobalDock`, PC in die Einstellungen, Kopfzeile entschlackt.
- Werkzeugfläche am Desktop: Einstellungen, Entdeckt, Medien, PC und Status nutzen die Detailspalte.
- Einstellungen neu: feste Gruppen, gemeinsames Zeilenraster, echte Schalter.
- Akzentfarbe mit Farbwähler-Modal nach GIMP-Art, Schriftart und -größe mit Live-Vorschau, alles pro Gerät und je Theme, selbst ausgelieferte Schriften.
- Erkennung: Gruppierung nach echtem Projekt, Rauschfilter, Scanner für Codex und Hermes, neues Kartendesign.
- Eigene Fenster: Session (samt Reiter Chat/Diff/Code/Bericht) und Werkzeugseiten; Knopf, Ziehgeste und Rückkehr; Wiederherstellen nach Reload.
- `docs/design-system.md` um die neuen Bausteine und Tokens ergänzen.

**Out:**
- Komplettes Redesign anderer Seiten (die neuen Bausteine dürfen später wandern).
- Freie Theme-Editoren für Status-Farben: `--ok`, `--warn` und `--err` bleiben semantisch fest.
- Synchronisierung der Darstellung zwischen Geräten: sie bleibt eine Gerätevorliebe wie Theme und Zoom.
- Eigene Schriftdateien hochladen.
- Native Desktop-App (Electron/Tauri) oder Fenster auf anderen Rechnern.
- Mehr als vier Kacheln je Fenster; eigene Fenster auf Handy oder Tablet unter 1280 px.
- Transkript-Volltextsuche in der Erkennung (wie P22).
- Entfernen der Voice-Taste im Composer und des Voice-Sheets innerhalb einer Session.

## 3. Design-Details

### 3.1 Navigation (T34.1)

```text
Vorher  Dock: Übersicht · Neue Session · Entdeckt · Voice · Einstellungen
        Kopf: ✦ · Medien · PC · Status · ●
Nachher Dock: Übersicht · Neue Session · Entdeckt · Medien · Einstellungen
        Kopf: ✦ · Status · ●
```

Medien übernimmt den Platz von Voice, die untere Leiste am Handy behält also fünf Einträge. Die Hash-Routen `#/medien` und `#/pc` sowie die Befehle in `commands/parse.ts` bleiben bestehen, damit Lesezeichen und „öffne PC“ weiter funktionieren. PC wird in den Einstellungen unter „Geräte“ eingebettet. 
**Aufräumen des globalen Voice-Zugangs (auf Desktop und Handy):**

| Stelle | Änderung |
|---|---|
| `app/App.tsx` | `VoiceSheet`-Import und -Rendering sowie `voiceOpen` entfernen |
| `app/Dock.tsx` | Eintrag und Prop `onVoice` entfernen, veraltete Kommentare korrigieren |
| `shared/TabIcon.tsx` | Icon `voice` entfernen, sofern es dann ungenutzt ist |
| `features/voice/VoiceSheet.tsx` | Das Sheet gibt es nur noch in der Session: Prop `sessionId` und Kommentare auf diesen Stand bringen |
| `e2e/specs/navigation.spec.ts` | Test „das Voice-Sheet öffnet und schließt sich“ entfernen; dazu prüfen, dass das Dock keinen Voice-Eintrag mehr hat |
| Session-Specs | Öffnen und Schließen des Sheets in der Session absichern, damit diese Abdeckung nicht mit dem globalen Test verschwindet |
| `docs/testing-e2e.md` | Zeile zur Navigation auf den neuen Stand bringen |

Bleiben unverändert: Voice-Taste im Composer, Voice-Sheet in der Session samt `voice-local.spec.ts` und dem Sprachblock in `workspace.spec.ts`, die Befehle der Kommandozeile (`✦`). Historische ADRs, Messläufe und der Abschnitt „Herkunft“ in `docs/design-system.md` werden nicht umgeschrieben.

### 3.2 Werkzeugfläche am Desktop (T34.2)

```text
┌─Rail─┬─Liste (bis 420 px)─┬─Detail──────────────────────────┐
│  ⌂   │ Sessions           │ Einstellungen               [×] │
│  +   │ …                  │ volle Breite, Kacheln bleiben   │
│  ⌕   │                    │ darunter gemountet              │
└──────┴────────────────────┴─────────────────────────────────┘
```

Ab 1280 px zeigt die Detailspalte die Werkzeugseite, die Liste bleibt die Sessionliste. **Die Kacheln werden nur verborgen, nicht ausgehängt**, sonst würden WebSockets neu verbinden und ungesendete Entwürfe flackern. `×`, Esc, Zurück oder das Öffnen einer Session schließen die Fläche. „Neu“ und „Freigaben“ bleiben vorerst in der Liste, damit sich der K1-Weg nicht ändert. Das Handy bleibt unverändert.

### 3.3 Einstellungen (T34.3)

Am Desktop zwei gleich breite Spalten, am Handy eine. Jede Gruppe ist eine Karte mit Überschrift. Alle Zeilen teilen sich dasselbe Raster: links Titel und einzeiliger Hinweis, rechts das Bedienelement in fester Breite und rechtsbündig. Neue Bausteine: `SettingsSection`, `SettingRow`, `Switch`.

```text
┌ Darstellung ───────────────────┐  ┌ Geräte ────────────────────────┐
│ Theme            [Dunkel|Hell] │  │ PC-Eingabe          verbunden ›│
│ Akzentfarbe           [■ #…] › │  │ Benachrichtigungen        [ ●] │
│ Schriftart     [JetBrains Mono]│  │ Pinch-Zoom                [ ●] │
│ Schriftgröße      [−] 100 % [+]│  ├ Flotte ────────────────────────┤
│ Zoom              [−] 100 % [+]│  │ Hosts                        3 ›│
│ Schimmer Kontextleiste    [● ] │  ├ Dienste ───────────────────────┤
├ Vorschau ──────────────────────┤  │ Gemini                  aktiv ›│
│ Mini-Chat mit Akzent und Code  │  ├ Sicherheit & Verbindung ───────┤
│                                │  │ Passkey · Token · Adresse      │
└────────────────────────────────┘  └────────────────────────────────┘
```

Die Vorschau bleibt am Desktop beim Scrollen sichtbar. Längere Inhalte (Flotte, Push-Geräte, PC-Einrichtung) klappen innerhalb ihrer Gruppe auf, statt das Raster zu sprengen. „Auf Standard zurücksetzen“ gilt nur für die Darstellung.

### 3.4 Darstellung als reiner Zustand (T34.4)

`apps/pwa/src/app/appearance.ts` folgt dem Muster von `theme.ts` und `ui-scale.ts`: Parsen und Validieren sind rein und getestet, Anwenden passiert vor dem ersten Paint in `main.tsx`.

```ts
interface Appearance {
  accent: { dark: string | null; light: string | null }; // #rrggbb, null = Standard
  fontUi: FontId;
  fontCode: FontId;
  fontScale: number; // 0.85–1.3
}
```

- **Je Theme eine Akzentfarbe:** das dunkle Amber ist auf Weiß schlecht lesbar. Das Modal bearbeitet die Farbe des aktiven Themes.
- **`--accent-ink`** wird nach WCAG-Kontrast berechnet (dunkel oder hell, was besser lesbar ist).
- **Fail loud:** Kaputte Werte im `localStorage` führen zum Standard. Kontrast unter 3:1 zu `--bg-elev` oder Nähe zu `--ok`/`--warn`/`--err` zeigt einen Hinweis, blockiert aber nicht.
- **Fenster-Sync:** Das `storage`-Ereignis überträgt Änderungen sofort in alle offenen Fenster (Voraussetzung für §3.8).

### 3.5 Farbwähler-Modal (T34.5)

Einfach, aber effizient wie in GIMP, ohne neue Abhängigkeit:

```text
┌ Akzentfarbe · Dunkel ─────────────────────┐
│ ┌───────────────────────┐ ┌─┐  Neu  ████  │
│ │                       │ │ │  Alt  ████  │
│ │  Sättigung/Helligkeit │ │H│             │
│ │            ○          │ │u│  H [ 29 ]°  │
│ │                       │ │e│  S [ 76 ]%  │
│ └───────────────────────┘ └─┘  V [100 ]%  │
│ Hex [#ff9a3c]   R [255] G [154] B [ 60]   │
│ ● ● ● ● ● ● ● ●  zuletzt: ● ● ● ●         │
│ ⚠ wenig Kontrast      [Abbrechen] [Übern.]│
└───────────────────────────────────────────┘
```

Fläche und Farbton-Leiste funktionieren mit Maus, Touch (Pointer Events) und Pfeiltasten. Die App färbt sich während der Auswahl live ein. „Alt“ per Klick oder Abbrechen und Esc stellen den Ausgangswert exakt wieder her; gespeichert wird erst beim Übernehmen. Die Umrechnung HSV/RGB/Hex ist rein und per Rundlauf-Test abgesichert. Fokus bleibt im Modal, am Handy ist es ein Vollbild-Sheet.

### 3.6 Schrift (T34.6)

**Token trennen:** neues `--font-ui` für Fließtext und Bedienung; `--font-mono` gilt nur noch für Code, Diff und Terminal. Standardwert von `--font-ui` bleibt JetBrains Mono, damit sich ohne Wahl nichts ändert.

**Zwei Auswahlfelder:** Oberfläche und Code. Jeder Eintrag ist in seiner eigenen Schrift gesetzt, die Wahl wirkt sofort. Kuratierte Liste, jeweils unter freier Lizenz gebündelt und damit offline verfügbar: JetBrains Mono, IBM Plex Mono, Inter, Atkinson Hyperlegible; dazu System-Sans und System-Mono ohne Download. Orbitron bleibt die Markenschrift und ist nicht wählbar. Der Google-Fonts-Link in `index.html` entfällt.

**Größe:** Alle 160 Fundstellen (135 CSS, 25 inline) gehen per Codemod auf `calc(Npx * var(--font-scale, 1))`; die Abstände bleiben fix. Eine mechanische Umstellung lässt sich getrennt prüfen, Standard 100 % muss pixelgleich bleiben. Felder behalten mindestens 16 px, damit Safari nicht beim Fokus zoomt (bestehende Regel in `01-base.css`). Schriftgröße und Zoom bleiben getrennte Regler: die Größe ändert nur Text, der Zoom alles.

### 3.7 Session-Erkennung (T34.7–T34.9)

**Daten zuerst, sonst wird nur das Falsche schöner:**

1. **Echtes Projekt:** `cwd` aus dem Transkript hat Vorrang vor dem Ordnernamen. Fehlt es, bleibt der Rohname sichtbar (R9.7).
2. **Worktrees bündeln:** Sessions aus `…/data/worktrees/<id>` und `git worktree`-Pfaden landen beim Hauptprojekt, mit Worktree als Nebeninfo. Unbekannt bleibt eigene Gruppe, nie geraten.
3. **Rauschen einklappen, nicht löschen:** Pfade unter `/tmp` und Fabrik-Kopien (`harnez-exec-*`) sowie Subagenten stehen standardmäßig in einer eigenen Gruppe „Temporär & Automatisch (n)“; der Zähler bleibt sichtbar, die Suche findet sie weiter. Subagenten hängen an ihrer Hauptsession statt als gleichrangige Karte.
4. **Codex und Hermes:** read-only Scanner nach dem Muster von `pi-family.ts`, jeweils mit Titel, Vorschau und `live`. Fortsetzen wird nur angeboten, wenn das Resume-Argument belegt ist (ADR-0036); sonst „nur beobachtet“. Unbekannte Formate erscheinen als `unsupported-format`.
5. **`live` prüfen:** das 90-s-mtime-Fenster gegen echte Fälle messen, falsche Treffer als Testfall festhalten.

Änderungen an `DiscoveredSession` brauchen ein ADR (Fortschreibung von ADR-0040).

**Design: Variante A ist entschieden (Jan, 07.11.2026).** Geprüfte Vorschläge, alle mit vorhandenen Tokens und Leitstand-Charakter:

| Variante | Idee | Einschätzung |
|---|---|---|
| **A: Signal-Deck** (gewählt) | Kopf mit vier Kennzahl-Kacheln, die zugleich Filter sind; gleich hohe Karten im Raster, links eine Signalkante je Zustand, aktive Sessions pulsieren dezent. | Löst „unsymmetrisch“ direkt, passt zu Status-Glow, am Handy einspaltig |
| B: Zeitachse | Vertikale Spur nach Heute/Gestern/Woche, Karten hängen als Knoten daran. | Verworfen: schön für „was lief zuletzt“, aber Projekte treten zurück |
| C: Radar | Live-Sessions als Punkte im Radar, darunter die Liste. | Verworfen: maximaler Blickfang, wenig Nutzen und Risiko für K2 und Barrierefreiheit |

```text
┌──────────┬──────────┬──────────┬──────────┐   Variante A
│ ● LIVE 2 │ FORTSETZ.│ BEOBACHT.│ HUB      │   Kennzahlen = Filter
│          │       41 │       18 │        9 │
└──────────┴──────────┴──────────┴──────────┘
[⌕ Suchen …]   Claude · Codex · Hermes · pi · opencode
▾ AncientVoid · 12 · zuletzt vor 2 min
┌────────────────────┐ ┌────────────────────┐
┃ Titel, höchstens   │ │ Titel, höchstens   │   Alle Karten gleich hoch:
┃ zwei Zeilen        │ │ zwei Zeilen        │   Titel 2 / Vorschau 2 / Meta 1 /
┃ Letzte Nachricht … │ │ Letzte Nachricht … │   Aktionen 1, fehlende Teile
┃ claude · vor 1 min │ │ codex · vor 3 h    │   behalten ihren Platz.
┃ [Als Kopie forts.]⋯│ │ [Fortsetzen]      ⋯│
└────────────────────┘ └────────────────────┘
```

Status steht als Signalkante und kurzes Etikett, nie nur als Farbe. ID, Fork und Harness wandern ins `⋯`-Menü mit „ID kopieren“. Alle Aktionen liegen in derselben Zeile. Die Bewegung folgt `prefers-reduced-motion`.

### 3.8 Eigene Fenster (T34.10–T34.12)

**Bedienung:** Jede Kachel bekommt neben `×` ein `⧉` („in eigenem Fenster öffnen“); zusätzlich lässt sich die Kachel am Griff aus dem App-Fenster ziehen. In der Liste trägt die Session das Abzeichen „⧉ eigenes Fenster“; ein Klick darauf holt das Fenster nach vorn, statt die Session doppelt zu öffnen. Das Fenster bietet „In die App zurück“. Werkzeuge öffnen sich aus der Werkzeugfläche ebenso per `⧉`.

**Technik:**

- **URL:** `/?window=1#/sessions/<id>` beziehungsweise `#/hosts/<host>/sessions/<id>` und `#/status`. Damit wird die bestehende Hash-Route wiederverwendet. **Das Token steht nie in der URL**, es liegt bereits im gemeinsamen `localStorage`.
- **Schlanke Hülle:** `PopoutShell` rendert `SessionTail` oder die Werkzeugseite ohne Dock, Liste und Kachel-Tasten. Sie schreibt nie `ancientvoid.workspace` und nie den Hash des Hauptfensters.
- **Zustand:** `Workspace` bekommt `detached: TileRef[]`; `tiles.ts` bleibt rein, `parseWorkspace` akzeptiert alte Stände ohne das Feld.
- **Abstimmung:** `BroadcastChannel("ancientvoid.windows")` mit `hello`, `heartbeat`, `bye`, `focus`, `return`. Das Hauptfenster bleibt optional: Fenster laufen auch weiter, wenn es geschlossen wird, und melden sich beim nächsten Start wieder an.
- **`noopener` als Vorschlag:** Fenster mit Opener-Beziehung teilen sich meist den Haupt-Thread, ein voller Tail würde dann alle ausbremsen (K2). Ohne Fenster-Handle wird die Abstimmung ausschließlich über den Kanal geführt, und ein blockiertes Pop-up wird über ein ausbleibendes `hello` erkannt. Der Spike entscheidet das.
- **Entwürfe:** Die vorhandene Entwurfsablage gilt je Session; das Abzeichen verhindert zwei Composer auf derselben Session im Normalfall, das `storage`-Ereignis deckt den Rest.

**Vorab-Spike (T34.10), weil die Plattform die Geste begrenzt:**

| Frage | Risiko | Fallback |
|---|---|---|
| Popup nach langem Zug | `window.open` braucht eine frische Nutzeraktion; das Maus-Loslassen zählt nach Spezifikation nicht, und die Aktion vom Drücken läuft nach wenigen Sekunden ab | Fehlermeldung mit Knopf „Fenster öffnen“ an der Abwurfstelle |
| Hyprland/Wayland | Das Programm darf seine Fensterposition meist nicht setzen; `left/top` werden ignoriert und Koordinaten außerhalb des Fensters können fehlen | Ablage übernimmt der Compositor, Fensterregel dokumentiert; `⧉` funktioniert immer |
| Bildschirmwahl | Window-Management-API nur in Chromium und mit Berechtigung | Ohne Erlaubnis öffnet das Fenster am Standardplatz |
| Mehrere Fenster wiederherstellen | Normalerweise ein Popup je Klick | Leiste „3 Fenster wiederherstellen“ öffnet sie nacheinander |

Der Spike läuft in Chromium auf Hyprland (Jans System) und in Firefox. Sein Ergebnis steht im ADR, bevor die Ziehgeste gebaut wird. **Der `⧉`-Knopf ist die zugesicherte Funktion; die Ziehgeste kommt obendrauf, soweit die Plattform sie zulässt.**

## 4. Aufgaben

Ein Branch je Aufgabe. Reihenfolge: T34.1 und T34.2 zuerst, weil alle anderen auf der Fläche aufbauen. T34.7–T34.9 und T34.10–T34.12 können danach parallel laufen.

- [x] **T34.1** Navigation: globalen Voice-Zugang nach der Tabelle in §3.1 vollständig entfernen (Code, Tests, Doku), Medien mit neuem Icon ins Dock, Kopfzeile bereinigen, PC-Zugang in die Einstellungen. Routen und Befehle bleiben. `navigation.spec.ts`, `desktop.spec.ts`, `media.spec.ts`, Session-Spec fürs Voice-Sheet.
  *Abgeschlossen 07.11.2026:* Dock führt Medien statt Voice (`Dock.tsx`, Icon `medien`), Kopfzeile nur `✦`, Status und Verbindungspunkt, `onVoice` und das globale `VoiceSheet` aus `App.tsx` entfernt, `VoiceSheet` ohne totes Prop `sessionId`. PC liegt als aufklappbarer Abschnitt „PC-Eingabe“ in den Einstellungen (`settings/PcInput.tsx`, Inhalt erst beim Aufklappen eingehängt, damit der Sekundentakt nur bei Sicht läuft). Specs: `navigation.spec.ts` (neu: Dock-Reihenfolge, Kopfzeile, Direktlinks `#/pc` und `#/medien`; der globale Voice-Test entfällt), `desktop.spec.ts` über die Einstellungen. Das Voice-Sheet in der Session war schon durch `workspace.spec.ts` („Sprache“: Menü → Sprachbefehl, „stopp“, AC-P10-3) und `voice-local.spec.ts` abgedeckt und läuft unverändert grün, ein zusätzlicher Session-Spec war daher nicht nötig.
- [x] **T34.2** Werkzeugfläche am Desktop inklusive Vorher-/Nachher-Screenshots; Kacheln bleiben gemountet. Neuer Spec: WebSocket und Entwurf überleben das Öffnen der Einstellungen. Messlatte: K2.
  *Abgeschlossen 07.11.2026:* `ToolPane` ([`features/shell/ToolPane.tsx`](../apps/pwa/src/features/shell/ToolPane.tsx)) legt Einstellungen, Entdeckt, Medien, PC und Status über die Detailspalte; `App` zeigt dann in der Liste weiter die Sessions (`wide`-Prop, `isToolPage` in `route.ts`). Die Kacheln bleiben in `.tile-host` gemountet und sind `inert` (Tastatur, Screenreader). Daten kommen aus dem vorhandenen Hub-Status-Store, der jetzt auch Adapter und Nutzung trägt, es gibt keinen zweiten Poll. Schließen per `×`, Esc oder Sessionwahl. Die Einstellungen sind als `SettingsPage` ein Baustein für Handy und Desktop. Spec `tool-pane.spec.ts`: Breite der Detailspalte, Neu/Freigaben bleiben in der Liste, WebSocket-Zähler und Entwurf unverändert, Esc, Handy ohne Werkzeugfläche. Eine Mutation (Kacheln beim Öffnen aushängen) macht den Test rot. K2 wird in T34.12 mit vier Fenstern gemessen. *Offen:* die Vorher-/Nachher-Screenshots für den Abschluss in T34.13, weil das Raster erst mit T34.3 steht.
- [x] **T34.3** Einstellungen neu: Gruppen, Raster, `SettingsSection`/`SettingRow`/`Switch`; Fleet-, Push-, Gemini- und PC-Inhalte eingegliedert. Spec für Raster (gleiche Spaltenbreite am Desktop, einspaltig am Handy, kein horizontales Scrollen).
  *Abgeschlossen 07.11.2026:* Bausteine in [`settings/parts.tsx`](../apps/pwa/src/features/settings/parts.tsx) (`SettingsSection`, `SettingRow`, `Switch` als echter `role="switch"`, `Segmented`), sechs Gruppen in zwei Spalten per Container-Abfrage ab 760 px (in der Werkzeugfläche zählt die Breite der Fläche, nicht die des Fensters): links Darstellung und Benachrichtigungen, rechts Geräte, Flotte, Dienste, Sicherheit & Verbindung. `Settings.tsx` ist in `AppearanceSettings`, `DevicesSettings` und `SecuritySettings` aufgeteilt, Push, Flotte und Gemini nutzen dieselben Bausteine bei unveränderter Logik. Theme ist eine Auswahl mit sichtbarem Zustand statt eines Knopfes, der den Gegenwert zeigt. Am Handy stapeln Zeilen mit breitem Bedienelement. `settings-layout.spec.ts` prüft Gruppen, gleiche Spaltenbreite, fluchtende Bedienelemente, eine Spalte und kein Seitwärts-Scrollen am Handy, Schalter und Theme; vorhandene Specs (Push, Gemini, Flotte, Zoom, Token, Passkey) laufen unverändert bis auf die Theme-Auswahl. *Abweichung vom Entwurf:* Flotte und Push klappen nicht ein, nur die PC-Eingabe; die bestehenden Specs und die Auffindbarkeit hängen an sichtbaren Feldern. Die Gruppe „Vorschau“ und die Zeilen für Akzent und Schrift entstehen in T34.5/T34.6.
- [x] **T34.4** `appearance.ts`: Zustand, Validierung, Kontrast, Anwenden vor dem ersten Paint, `storage`-Sync. Unit-Tests inklusive kaputter Werte.
  *Abgeschlossen 07.11.2026:* [`appearance.ts`](../apps/pwa/src/app/appearance.ts) mit Zustand, Validierung, Farbmathematik (Hex/RGB/HSV), WCAG-Kontrast, `applyAppearance` vor dem ersten Paint (`initAppearance` in `main.tsx`) und `storage`-/Theme-Sync. Die Schriftenliste trennt Festbreite und proportional, `fontCode` akzeptiert nur Festbreite (AC-P34-5). `--accent-ink` ist reines Schwarz oder Weiß, damit der Text auf jeder Akzentfläche mindestens 4,58:1 erreicht; der Test prüft ein Raster über den ganzen RGB-Würfel. Warnungen (Kontrast unter 3:1, Nähe zu `--ok`/`--warn`/`--err` unter RGB-Abstand 40) blockieren nicht; die Standard-Akzente lösen keine aus. 12 Unit-Tests in `appearance.test.ts` plus einer in `theme.test.ts`. `applyTheme` meldet jetzt `ancientvoid:theme`. Sichtbare Wirkung und E2E folgen mit T34.5/T34.6, weil der Zustand bis dahin nicht erreichbar ist.
- [x] **T34.5** Farbwähler-Modal: Fläche, Farbton, Hex/RGB/HSV, Alt/Neu, Vorgaben, zuletzt benutzt, Tastatur, Abbrechen stellt exakt wieder her. Unit-Rundlauf plus E2E (Live-Farbe, Reload, beide Themes).
  *Abgeschlossen 07.11.2026:* [`AccentPicker.tsx`](../apps/pwa/src/features/settings/AccentPicker.tsx) als natives `<dialog>` (Top-Layer, eigene Fokusfalle; ein Portal ist unnötig, und `container-type` der Einstellungen würde ein `position: fixed` einsperren): Fläche und Farbtonleiste mit Maus, Touch und Pfeiltasten, Felder für Hex, RGB und HSV, Alt/Neu, Vorgaben je Theme, die sechs zuletzt benutzten Farben, Kontrasthinweise, am Handy als Vollbild-Sheet. Die Seite färbt sich live ein, gespeichert wird erst mit „Übernehmen“; Abbrechen, Esc und Klick daneben stellen den Zustand exakt wieder her (Speicher unberührt, Inline-Variablen weg), Esc schließt nur den Dialog, die Werkzeugfläche dahinter bleibt offen. „Standard“ speichert `null` statt der Standardfarbe. `accent-color.spec.ts` mit 8 Fällen (live, Abbrechen, Reload, Status-Farben unverändert, Dunkel/Hell getrennt, Alt und Standard, Fläche/Leiste/Felder, Kontrasthinweis, Esc, Zuletzt). Die Hex↔HSV-Umrechnung ist in T34.4 per Rundlauf über 510 Farben abgesichert. *Testfund:* Eckklicks auf die abgerundete Fläche trafen den Dialog dahinter, die Spec klickt deshalb 8 px innerhalb.
- [x] **T34.6** Schrift: Token-Trennung (`--font-ui`), Schriftdateien bündeln und Google-Link entfernen, Codemod (160 Stellen), Auswahl und Größe mit Vorschau. E2E: Diff bleibt bei proportionaler UI-Schrift monospace; Offline-Lauf (K10); 100 % bleibt optisch gleich.
  *Abgeschlossen 07.11.2026:* Alle Schriften kommen aus `@fontsource/*` (nur `latin`, Gewichte nach Bedarf; Orbitron, JetBrains Mono, IBM Plex Mono, Inter, Atkinson Hyperlegible), der Google-Link in `index.html` ist entfernt; der Build enthält 13 `woff2`-Dateien und keinen Fremd-Host, `appearance-font.spec.ts` prüft das an den Netzanfragen. `--font-ui` und `--font-code` sind getrennt (`--font-mono` bleibt Alias auf Code), Code-, Diff- und Tool-Flächen setzen `--font-code` explizit und bleiben bei proportionaler Oberfläche Festbreite. Der Codemod (`calc(Npx * var(--font-scale, 1))`) ist belegt: berechnete Schriftgrößen aller Elemente auf 13 Seiten, Desktop und Handy, vor/nach identisch außer der Einstellungsseite, die zwei neue Gruppen („Schrift“, „Vorschau“) bekommen hat. Neue Gruppen: Schrift (Auswahl je in der eigenen Schrift, Codeschrift nur Festbreite, Stepper 85–130 %) und Vorschau (Mini-Chat mit echten Klassen, am Desktop sticky; Zurücksetzen der Darstellung). *Nicht automatisiert:* der Offline-Lauf (K10) mit leerem Cache; die Schriften liegen same-origin und der Service Worker cached sie zur Laufzeit, der echte Offline-Start bleibt Teil der Live-Abnahme (AC-P34-13).
- [x] **T34.7** Erkennung Daten: `cwd`, Worktree-Bündelung, Gruppe „Temporär & Automatisch“, Subagenten an der Hauptsession, `live` gemessen. ADR (Fortschreibung ADR-0040), Fixtures anonymisiert. Messlatten: K7, K9, R9.7.
  *Abgeschlossen 07.11.2026:* [ADR-0052](../docs/adr/0052-erkennung-echtes-projekt-und-rauschen.md) (Fortschreibung ADR-0040). `cwd` aus dem Transkript (steht in allen 1 649 Transkripten auf dem Rechner im Kopffenster) hat Vorrang vor dem Ordnernamen; `classifyProject` bündelt Worktrees (`data/worktrees`, `.claude/worktrees`, git-`gitdir`) beim Hauptprojekt und markiert `/tmp` und `harnez-exec-*` als `temporary`; eine konfigurierte Wurzel hebt nur die Orts-Regel auf. Subagenten erben Projekt und Worktree ihrer Hauptsession, die PWA nestet sie darunter; „Temporär & Automatisch (n)“ steht eingeklappt am Ende. `live` zählt zusätzlich die IDs aus `claude agents --json`: gemessen 1 von 1 649 Transkripten im 90-s-Fenster bei mehreren offenen Terminals — das Fenster hatte falsch-negative Fälle, als Testfall festgehalten. Tests: 12 neue Unit-Tests (`project-origin.test.ts`, `claude-meta.test.ts`, `groups.test.ts`), ein E2E in `discovery.spec.ts`. *Hinweis:* ADR-Nummer 0052 und 0053 (Fenster) sind für P34 reserviert, P29 hält 0051; bei Kollision beim Merge wird umnummeriert. *Fixtures:* die Tests erzeugen ihre Transkripte synthetisch, es wurden keine echten Transkripte kopiert.
- [x] **T34.8** Scanner für Codex und Hermes, in `apps/hub/src/main.ts` registriert, Fixtures aufgezeichnet, anonymisiert und secret-gescannt. Resume nur mit Beleg (ADR-0036). Scan-Zeit mit den echten Mengen gemessen.
  *Abgeschlossen 07.11.2026:* [`codex.ts`](../packages/core/src/modules/discovery/codex.ts) und [`hermes.ts`](../packages/core/src/modules/discovery/hermes.ts), in `apps/hub/src/main.ts` registriert (Config `discovery.codexDir`/`hermesDir`, in den E2E-Hubs auf isolierte Pfade gesetzt, damit kein Test die echten Speicher liest). Hermes liegt in `state.db`, nicht in `sessions/` (die dortige `sessions.json` ist ein Routing-Spiegel); Codex-Rollouts tragen die erste Nutzerzeile bis 124 KB tief, daher 256-KB-Kopffenster. Fortsetzen: Hermes ja (`hermes --resume`, Adapter übernimmt die ID), Codex nein — `unsupportedResume`, PWA zeigt „Nur beobachtet“, weil der Codex-Adapter keine fremde ID übernimmt (ADR-0036: nur mit Beleg). Scan-Zeit mit den echten Mengen (55 Rollouts, 1 277 Hermes-Sitzungen, 1 650 Claude-Transkripte): kalt zusammen unter 1 s, siehe ADR-0052. Tests: 11 Unit-Tests (`codex-hermes.test.ts`, inkl. Secret-Muster-Scan der Fixtures), ein E2E. *Fixtures:* nicht aus echten Rollouts kopiert, sondern nach dem beobachteten Format von Hand anonymisiert nachgebaut (Platzhalter-Texte, `/work/…`, keine echten IDs); ein Test prüft sie mit den Mustern aus `scripts/capture-adapter-fixture.mjs`.
- [x] **T34.9** Erkennung Design nach Variante A: gleich hohe Karten, Kennzahl-Filter, Provider-Chips, `⋯`-Menü. `discovery.spec.ts` erweitert.
  *Abgeschlossen 07.11.2026:* Variante A umgesetzt ([`Discovery.tsx`](../apps/pwa/src/features/discovery/Discovery.tsx), [`26-discovery.css`](../apps/pwa/src/app/styles/26-discovery.css)): vier Kennzahl-Kacheln (Läuft gerade, Fortsetzbar, Nur beobachtet, Im Hub) zählen und filtern per Klick (`aria-pressed`), Provider-Chips filtern mehrfach, Karten im Raster (`auto-fill`, am Handy eine Spalte) mit fester Zeilenaufteilung — Titel 2, Vorschau 2, Meta 1, Aktionen 1 Zeile, fehlende Teile behalten ihren Platz, deshalb sind alle Karten gleich hoch (E2E misst es). Signalkante und Zustandsetikett je Karte (Text, nie nur Farbe; live pulsiert, `prefers-reduced-motion` schaltet ab), alle Aktionen in einer Zeile, ID/Harness/Fork im `⋯`-Menü mit „ID kopieren“ (E2E prüft die Zwischenablage). Zustand ist genau einer (`discoveryState`: unbekannt > Hub > live > nur beobachtet > fortsetzbar), in `groups.ts` rein und unit-getestet. *Grenze:* Kennzahlen und Chips zählen die **geladenen** Funde (Seiten à 50, „Mehr laden“), nicht den gesamten Bestand; bei aktiver Suche stehen sie für die Treffer. Visuell am Desktop und am Handy per Screenshot geprüft; die Abnahme am echten Gerät gehört zu AC-P34-13.
- [x] **T34.10** Fenster-Grundlage: Spike, ADR (Fensterprotokoll, `noopener`, Recovery), `PopoutShell`, `⧉`-Knopf für Kacheln und Werkzeuge, `detached` in `tiles.ts`, Abzeichen in der Liste, Rückkehr. E2E mit zwei Playwright-Seiten.
  *Abgeschlossen 07.11.2026:* [ADR-0053](../docs/adr/0053-eigene-fenster-protokoll.md) mit Spike-Ergebnis. [`protocol.ts`](../apps/pwa/src/features/windows/protocol.ts) (rein: URL ohne Token, strikt geprüfte Nachrichten, Register mit Ablauf), [`windows.ts`](../apps/pwa/src/features/windows/windows.ts) (Kanal, `openPopout` mit `noopener` und `hello`-Prüfung), [`PopoutShell.tsx`](../apps/pwa/src/features/windows/PopoutShell.tsx), `⧉` an jeder Kachel und an der Werkzeugfläche, `detached` in `tiles.ts` (alte Stände gültig), Abzeichen „⧉ eigenes Fenster“ in der Liste, Klick holt das Fenster nach vorn statt doppelt zu öffnen, „In die App zurück“. Tests: 8 Unit-Tests (Protokoll) plus 3 (`detached`), E2E `windows.spec.ts` mit zwei echten Seiten (4 Tests, Desktop und Handy-Projekt); der Test zeichnet jeden `localStorage`-Schreibzugriff des Fensters auf — eine Mutation, bei der das Fenster den Arbeitsbereich schreibt, macht ihn rot. Blockierte Pop-ups meldet die App schon hier (T34.12 ergänzt Wiederherstellen und Messläufe). **Spike:** gemessen nur in Chromium (Nutzeraktion bleibt bei langem Zug und nach dem Loslassen aktiv); Blocker, Firefox, Hyprland/Wayland und Window-Management-API sind **nicht gemessen** und stehen als solche im ADR.
- [x] **T34.11** Ziehgeste aus der Kachel im vom Spike belegten Umfang, Fallback sichtbar; optional Bildschirmwahl per Window-Management-API.
  *Abgeschlossen 07.11.2026 (im vom Spike belegten Umfang):* Griff `⠿` an jeder Kachel; ziehen und außerhalb des Fensters loslassen öffnet das Fenster an der Abwurfstelle (`left`/`top`; unter Wayland setzt der Compositor die Position). Die Kachel zeigt beim Überschreiten des Randes einen Hinweis; Loslassen im Fenster tut nichts. Rückfall sichtbar: schlägt das Öffnen fehl, steht die Meldung mit dem Knopf „Fenster öffnen“ da. Reine Logik in [`drag.ts`](../apps/pwa/src/features/windows/drag.ts) (2 Unit-Tests), E2E mit echter Maus über den Rand (Chromium). Beim Bau fand der Typecheck einen Fehler (das Klick-Ereignis wäre als Abwurfpunkt durchgereicht worden); `dropFeatures` verwirft nicht-endliche Werte ohnehin. **Nicht gebaut:** Bildschirmwahl per Window-Management-API (laut Plan optional, nur Chromium mit Berechtigung). **Nicht gemessen:** Hyprland/Wayland und Firefox — Jans Live-Abnahme (AC-P34-13).
- [x] **T34.12** Robustheit: Heartbeat und Absturzerkennung, Wiederherstellen nach Reload, blockierte Pop-ups melden, Offline-Verhalten. Messlauf K2 mit vier Fenstern (Skill `messlauf`), K1 im eigenen Fenster.
  *Abgeschlossen 07.11.2026:* Heartbeat (3 s) und Ablauf im Register (10 s) erkennen ein hängendes Fenster, die Leiste „Wiederherstellen“ öffnet je Klick ein Fenster, Theme-Sync über das `storage`-Ereignis, Offline-Hinweis, Meldung bei blockiertem Pop-up. Messlauf [`docs/messlauf/2026-11-07-p34-k2-vier-fenster.md`](../docs/messlauf/2026-11-07-p34-k2-vier-fenster.md): K2 mit vier Fenstern 0 von 72.284 über 200 ms (Max 110 ms), **aber** ein früherer Lauf im gleichen Aufbau hatte 66 Überschreitungen (Max 721 ms) bei Load 19, und die ersten zwei Läufe waren ein Messaufbaufehler (Tabs in einem Kontext). K1 im eigenen Fenster p95 13 ms, K8 603 ev/s ohne Verlust. Einzelne Maschine, hohe Fremdlast; nicht gemessen: Mehrmonitor, Wayland, Firefox (AC-P34-13).
- [ ] **T34.13** Abschluss: `docs/design-system.md` ergänzen, `npm run gate`, Abnahme durch Jan am Desktop und am Pixel, Retro. → nach P000 verschoben

## 5. Acceptance Criteria

- **AC-P34-1:** Das Dock enthält auf Desktop und Handy Übersicht, Neue Session, Entdeckt, Medien, Einstellungen. Die Kopfzeile enthält weder Medien noch PC. PC ist aus den Einstellungen erreichbar, `#/pc` und `#/medien` funktionieren weiter. Außerhalb einer Session gibt es keinen Voice-Zugang und keinen Code oder Test mehr dafür; Voice-Taste und Voice-Sheet in der Session funktionieren unverändert.
- **AC-P34-2:** Am Desktop nutzen Einstellungen, Entdeckt, Medien, PC und Status die volle Detailbreite. Beim Öffnen und Schließen baut keine Kachel ihre WebSocket-Verbindung neu auf, und ein angefangener Entwurf bleibt erhalten.
- **AC-P34-3:** Die Einstellungen zeigen die Gruppen aus §3.3 in zwei gleich breiten Spalten (ab 1280 px) und einspaltig am Handy; alle Bedienelemente einer Spalte fluchten; bestehende Funktionen (Passkey, Token, Push, Flotte, Gemini) sind weiter erreichbar.
- **AC-P34-4:** Der Farbwähler ändert die Akzentfarbe live per Fläche, Farbton und Hex/RGB/HSV. Abbrechen oder Esc stellt exakt den alten Wert wieder her; Übernehmen übersteht einen Reload; Dunkel und Hell behalten eigene Werte; Text auf der Akzentfläche erreicht mindestens 4,5:1; Status-Farben bleiben unverändert.
- **AC-P34-5:** Schriftart und -größe wirken sofort in der Vorschau und in der App. Code und Diff bleiben bei proportionaler UI-Schrift monospace. Die gebündelten Schriften laden offline, ohne Anfrage an einen Fremd-Host; 100 % ist optisch gleich zum Stand vorher.
- **AC-P34-6:** Fixtures mit Worktree, `/tmp`-Kopie und Subagent werden richtig eingeordnet: Worktree beim Hauptprojekt, Temporäres eingeklappt mit korrektem Zähler und per Suche auffindbar, nichts geht verloren. Ohne `cwd` bleibt der Rohname stehen.
- **AC-P34-7:** Codex- und Hermes-Sessions dieses Rechners erscheinen mit Titel oder ehrlichem „Ohne Titel“. Fortsetzen erscheint nur mit belegtem Resume; ein unbekanntes Format wird als solches angezeigt.
- **AC-P34-8:** Karten einer Zeile sind unabhängig vom Inhalt gleich hoch, bei 390, 1280 und 2560 px Breite ohne horizontales Scrollen; Status ist auch ohne Farbe erkennbar.
- **AC-P34-9:** `⧉` öffnet Session und Werkzeug in einem eigenen Fenster mit live laufendem Tail, das Token steht nicht in der URL. Die Kachel wird frei, die Liste zeigt das Abzeichen, ein Klick darauf öffnet keine zweite Instanz, und „Zurück“ legt die Session wieder in eine Kachel.
- **AC-P34-10:** Ein blockiertes Pop-up oder eine abgebrochene Ziehgeste verliert keine Kachel und meldet sich sichtbar. Ein abgestürztes Fenster gibt seine Session innerhalb von 10 s wieder frei.
- **AC-P34-11:** Nach einem Reload des Hauptfensters bleiben offene Fenster zugeordnet; nach einem Browser-Neustart bietet die App die Wiederherstellung an. Änderungen an Theme, Akzent und Schrift erreichen alle Fenster ohne Reload.
- **AC-P34-12:** Vier Fenster mit je 30 Events/s halten K2 ein (Messlauf abgelegt), eine Freigabe im eigenen Fenster hält K1 ein. Der bestehende K8-Lauf bleibt grün.
- **AC-P34-13:** Live-Abnahme durch Jan: Fenster auf einem zweiten Bildschirm unter Hyprland, Einstellungen und Erkennung am Desktop und am Pixel. **Bis dahin offen, nicht als grün zu zählen.**

## 6. Premortem

1. **Die Werkzeugfläche bricht bestehende Abläufe.** `App`-Seiten hängen an der Listenspalte; `onOpen`, Hash-Routen, P23-Markierung und BUG-0099 greifen ineinander. *Mitigation:* T34.2 kommt früh als eigener MR, Handy-Zweig bleibt unberührt, `navigation`, `workspace`, `handoff` und `discovery` sind Pflicht-Specs.
2. **Der Schrift-Codemod ändert unbemerkt das Layout.** 160 Stellen, feste Höhen in Dock und Kacheln, Handy-Regel für 16 px. *Mitigation:* Codemod als rein mechanischer Commit mit Standard 100 %, Vergleichs-Screenshots zentraler Seiten, Stichprobe bei 85 % und 130 %, Grenzwerte der Skala eng halten.
3. **Eine freie Akzentfarbe macht die App unlesbar oder täuscht Status vor.** Grün als Akzent sieht aus wie „working“, Rot wie ein Fehler. *Mitigation:* berechnetes `--accent-ink`, sichtbare Warnung, ein Klick zurück auf Standard, Status nie nur über Farbe (AC-P34-8).
4. **Die Ziehgeste funktioniert ausgerechnet unter Hyprland nicht.** Wayland und Popup-Regeln könnten sie verhindern. *Mitigation:* Spike vor dem Bau, `⧉` als Zusage, Fallback sichtbar; AC-P34-9 hängt nicht an der Geste.
5. **Mehrere Fenster bremsen sich aus oder laufen auseinander.** Gemeinsamer Haupt-Thread, doppelte Composer, Fenster überschreibt `workspace`. *Mitigation:* `noopener` nach Spike, `PopoutShell` schreibt nie den Workspace, Messlauf mit vier Fenstern als AC, Kanal mit Heartbeat statt Fenster-Handle.
6. **Verwaiste Fenster-Einträge nach Absturz.** Die Session bliebe dauerhaft als „eigenes Fenster“ markiert und wäre unerreichbar. *Mitigation:* Heartbeat-Timeout gibt frei; `detached` ist nur ein Hinweis und wird beim Start gegen echte `hello`-Antworten abgeglichen (K7).
7. **Die Erkennung versteckt etwas Wichtiges oder wird langsam.** Der Rauschfilter könnte echte Arbeit in `/tmp` verschlucken, 1 670+ Transkripte plus Codex und Hermes kosten Zeit. *Mitigation:* einklappen statt filtern, Zähler und Suche bleiben, Scan-Zeit in T34.8 gemessen, Cache nach mtime und Größe wie bei Claude.
8. **Falsches Fortsetzen bei neuen Scannern.** Ein geratenes Resume-Argument könnte fremde Sessions verändern oder doppelte Schreiber erzeugen. *Mitigation:* nur belegte Resume-Wege, sonst „nur beobachtet“; `blockedByLive` bleibt.
9. **Konflikte mit laufenden Branches.** Andere offene Branches fassen ebenfalls die PWA an; P29 ist dann zwar abgeschlossen, sein „mobiler Zugang“ ändert aber die Ausgangslage. *Mitigation:* vor dem Start Ist-Aufnahme und Pfade gegen den Stand nach P29 prüfen; kleine MRs je Aufgabe, jeweils frisch von `main`; der Codemod direkt vor dem Merge neu erzeugt statt rebased.

## 7. Definition of Done

- `npm run gate` grün, Pipeline-Job `e2e` grün; jede neue UI-Funktion und jeder Ablauf hat einen Spec in `e2e/specs/`. Fehlende Browser-Fähigkeiten skippen sichtbar und zählen nicht als Pass.
- ADRs für die Änderung an `DiscoveredSession` und für das Fensterprotokoll liegen vor.
- `docs/design-system.md` beschreibt neue Tokens und Bausteine; `npm run check:arch` bleibt grün.
- **Erreichbarkeit:** Farbwähler, Schrift, PC und Medien sind ohne URL-Kenntnis erreichbar; Codex- und Hermes-Scanner sind in `main.ts` registriert; der `⧉`-Knopf ist in jeder Kachel sichtbar.
- Messlauf K2 mit vier Fenstern abgelegt, K1 und K8 belegt, Hub auf der Flotte neu ausgerollt.
- Live-Abnahme AC-P34-13 durch Jan erfolgt, `epics/README.md` aktualisiert, Retro angehängt.

## Retro

*Stand 07.11.2026, Gate auf `0575df4` grün (Unit 1333 von 1333, E2E 363 bestanden, 2 übersprungen). 18 Commits ohne Merge, T34.1–T34.13 an einem Tag in einem Worktree (`80bdb03` … `0575df4`). Belege für Funktionstests sind die Specs in `e2e/specs/` und die Unit-Tests der jeweiligen Pakete; die Bewertung unten ist bewusst zurückhaltend.*

### AK-Matrix

| AC | Stand | Beleg | Bemerkung |
|---|---|---|---|
| 1 Dock/Kopfzeile | 🟢 | `dock-visibility.spec.ts`, `navigation.spec.ts`, `80bdb03` | |
| 2 Volle Detailbreite | 🟢 | `tool-pane.spec.ts`, `ddf6207` | WebSocket-Zähler und Entwurf geprüft |
| 3 Einstellungen symmetrisch | 🟢 | `settings-layout.spec.ts`, `5f8184a` | acht Gruppen statt sechs (Schrift, Vorschau kamen mit T34.6 dazu) |
| 4 Farbwähler | 🟢 | `accent-color.spec.ts`, `b0a1839` | |
| 5 Schrift | 🟡 | `appearance-font.spec.ts`, `4d9c4ff` | „offline ohne Fremd-Host“ nur live geprüft (Link aus `index.html` entfernt, Build enthält die `woff2`), kein automatischer Test |
| 6 Echte Projekte | 🟢 | `project-origin.test.ts`, `groups.test.ts`, `discovery.spec.ts`, `0dd8305` | |
| 7 Codex/Hermes | 🟢 | `codex-hermes.test.ts` mit anonymisierten Fixtures, `831faf1` | Fixtures statt echter Home-Verzeichnisse; Scan-Zeit auf echten Daten nicht als Zahl abgelegt |
| 8 Gleich hohe Karten | 🟢 | `discovery.spec.ts` (390/1280/2560 px), `41956c9` | |
| 9 Eigenes Fenster | 🟢 | `windows.spec.ts` (zwei echte Seiten, Token nicht in URL), `d3f78e0` | nur Chromium |
| 10 Pop-up/Absturz | 🟢 | `windows.spec.ts`, `protocol.test.ts`, `91eea9d` | Absturz als „Heartbeats verschluckt“ simuliert, kein echter Prozessabsturz |
| 11 Reload/Sync | 🟢 | `windows.spec.ts` (Theme-Sync mutationsgeprüft), `91eea9d` | Wiederherstellung nach Browser-Neustart über Hinweis/Leiste, nur im Test mit neuem Kontext |
| 12 Messlauf | 🟡 | `docs/messlauf/2026-11-07-p34-k2-vier-fenster.md`, `fa9a495` | K2 Lauf 4: 0 / 72.284; Lauf 3 im selben Aufbau 66 Überschreitungen bei Load 19. K1 p95 13 ms, K8 603 ev/s. Eine Maschine, hohe Fremdlast |
| 13 Live-Abnahme Jan | 🔴 | — | offen, **nicht als grün zählen**: Hyprland-Zweitmonitor, Desktop, Pixel |

AK-Matrix: 10 🟢 / 2 🟡 / 1 🔴 / 0 ⚪.

### Premortem

Eingetreten: Nr. 2 (Codemod: der Aria-Namenskonflikt „Größer“ fiel in `oberflaeche.spec` auf, `949b357`), Nr. 5 (Mehrfenster-Last: der erste Messaufbau zeigte 1-s-Verzögerung, die Ursache war aber der Aufbau, nicht die App), Nr. 9 (Konflikt mit P29 beim Merge: `index.css`, ADR-Nummern kollidierten nicht). Nicht eingetreten (soweit prüfbar): Nr. 1, 3, 6, 7, 8. Nr. 4 (Hyprland) bleibt **ungeprüft** bis AC-13.

### Erkenntnisse

1. **Die Messmethode kann ein Ergebnis fälschen.** Lauf 1 und 2 (Tabs in einem Kontext) zeigten ein scheinbares K2-Versagen, Ursache war Hintergrund-Sichtbarkeit; erst die Probe mit einem Kontext je Fenster trennte das. Beleg: Bericht, Tabelle „Alle Läufe“.
2. **K2 ist auf dieser Maschine nicht stabil grün.** Lauf 3 und 4 unterscheiden sich nur durch Fremdlast. Beleg: Bericht; Load 9–20 während aller Läufe.
3. **Mechanische Änderungen in eigenen Commits zahlen sich aus.** Der Schrift-Codemod (`7e871e6`) war getrennt vom Verhalten (`4d9c4ff`) und blieb bei 100 % unverändert.
4. **Typecheck und Mutationsproben fanden echte Fehler früh** (`onClick={onPopout}` reichte das Klick-Ereignis als Abwurfpunkt weiter; Theme-Sync und Workspace-Schreibzugriff sind mutationsgeprüft).
5. **Das Gate hat einen Fehler gefangen, den Einzelläufe nicht sahen:** ESLint-Ausnahme für das neue Skript fehlte (`0575df4`); lokal hatte ich nur Teilmengen geprüft.

### Action Items

- AI-P34-1: Automatischer Offline-Test der gebündelten Schriften (keine Anfrage an Fremd-Host, Service Worker) — zurück als: Aufgabe in einem nächsten UI-Epic oder Bug, falls Jan Abweichungen sieht.
- AI-P34-2: K2 mit vier Fenstern auf ruhiger Maschine mindestens dreimal wiederholen und die Streuung ablegen — zurück als: Aufgabe vor Release (Messlauf-Nachtrag in `docs/messlauf/`).
- AI-P34-3: Live-Abnahme AC-P34-13 durch Jan (Hyprland-Zweitmonitor, Firefox, Pixel) und Blocker-Verhalten messen — zurück als: ADR-0053-Nachtrag mit Ergebnis.
- AI-P34-4: Skripte vor dem Commit mit `npm run lint` (nicht nur Teilmengen) prüfen — zurück als: Ergänzung im Skill `messlauf` (neue Skripte brauchen Eintrag in `eslint.config`).

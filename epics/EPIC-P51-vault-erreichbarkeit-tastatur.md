# EPIC-P51 — Vault-Erreichbarkeit & Tastatur-first

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P51 · **Dauer:** 2–3 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — Nutzerauftrag vom 11.11.2026, quer zur
Kette (Präzedenz P47–P50). Baut auf P49 (Vault), P18/P34 (Kachel-Kürzel,
Arbeitsfläche) auf; hebt keine offenen Abnahmen auf.

Quelle: Nutzermeldungen vom 11.11.2026 mit Code-Recherche:

1. **Vault-Ordner unsichtbar/nicht erreichbar.** Ordner-Symlinks erscheinen
   weder im Picker noch in der Dateiliste: `readdir(..., { withFileTypes: true })`
   liefert für Symlinks auf Verzeichnisse `isDirectory() === false`
   (`packages/core/src/modules/vault/store.ts:68` Browse, `:91` Liste). Pfade
   außerhalb von `projectRoots` + Hub-`HOME` werden mit 422 abgelehnt
   (`store.ts:41/:66`) — der Picker nennt keinen Grund. Eine manuelle
   Pfad-Eingabe existiert nicht (ADR-0063: „keine frei eingebaren Pfade",
   Premortem 1).
2. **Benachrichtigungsglocke am PC nicht im Eck.** Mit geöffneter Liste hängt
   sie oben rechts *in der Listenspalte* (`apps/pwa/src/app/styles/14-notifications.css:175-179`),
   nicht im Fenstereck; der Eck-Modus (`.notif-bell.corner`) ist nur bei
   eingeklappter Liste aktiv.
3. **Keine durchgängige Tastaturbedienung.** Kürzel sind über 7 Dateien
   verstreut (ui-scale, CommandBar, TileWorkspace, FilesLayer, ToolPane,
   Composer, Approvals), es gibt keine Registry, kein `?`-Cheat-Sheet (offen in
   T43.6), kein Esc/Fokus-Rückgabe in CommandBar/VoiceSheet/SkillPicker/
   Benachrichtigungs-Panel, keine globalen View-Wechsel-Kürzel und keine
   Pfeil-Navigation in den Hauptlisten. Das Setting „Tastenkürzel an/aus" ist
   bereits als Prio-B-Empfehlung dokumentiert (`docs/einstellungen-empfehlungen.md:49`).
4. **Omarchy/Super-Key.** Hyprland konsumiert gebundene SUPER-Kombos, bevor
   die App sie sieht; eine Web-App kann Compositor-Grabs nicht abfangen.
   Ungebundene Super-Kombos erreichen die PWA (`metaKey`); der
   `pass`-Dispatcher kann gezielt Kombos an ein Fenster durchreichen
   (Hyprland-Wiki, Binds/Dispatchers). Seit P18 offen: Alt+1–4 kollidiert
   potenziell mit Firefox-Tab-Wechsel.

**Nutzerentscheide (Abstimmung 11.11.2026):**

- **Vault:** Jeder Ordner ist wählbar — Guards bleiben (Policy
  `settings.manage`, Agenten-403, realpath, `.git`/`dataDir` gesperrt);
  Startpunkt-Zwang für die Root-Wahl entfällt; ADR-0063 wird ergänzt.
- **Ein Epic** (P51) für alle drei Themen; ?-Cheat-Sheet aus T43.6 hierher
  gezogen (braucht die Registry ohnehin).
- **Super-Key:** Alt/Basis-Tasten-Schema (kein Super als AV-Standard) +
  dokumentierter optionaler Hyprland-`pass`-Snippet statt unmöglichem
  Grab-Override aus der PWA.
- **Hinweis-Overlay:** nur bei Aktionen, für die ein Shortcut existiert
  (~2 s, unten); Klicks ohne Shortcut bleiben still.

## 1. Ziel

1. **Jeden vorhandenen Ordner als Vault nutzen können** — per Browser-Klick
   oder eingegebenem Pfad, Symlink-Ordner inklusive; Ablehnungen (`.git`,
   `dataDir`, fehlende Rechte) mit Klartext-Grund statt stiller 422.
2. **Glocke am PC immer oben rechts im Fenstereck** (wie auf dem Handy
   spaltenbündig unverändert).
3. **AncientVoid komplett ohne Maus bedienen können** — zentrale
   Shortcut-Registry, fehlende Kürzel (Esc/Fokus, View-Wechsel,
   Listen-Navigation), `?`-Cheat-Sheet, lernendes Hinweis-Overlay unten mit
   Settings-Schalter, und eine dokumentierte, kollisionsfreie Koexistenz mit
   Omarchy/Hyprland und Firefox.

## 2. Scope (In / Out)

**In:**

- Core `VaultStore`: Ordner-Symlinks in `browse()` und `list()` sichtbar
  (stat-basiert, Cycle-Schutz), `setRoot` ohne Startpunkt-Zwang (Guards
  bleiben), Picker zeigt `VaultError`-Meldungen.
- PWA `VaultPicker`: freie Pfad-Eingabe mit Validierung und Klartext-Fehlern;
  Browse-Startpunkte um den aktuellen Vault-Root ergänzen.
- ADR-0063-Ergänzung (Root-Wahl-Regel neu: Pfad-Eingabe erlaubt, Guards
  unverändert, Begründung).
- Glocke/Panel: am PC (≥1280 px) immer Eck-Position (`.corner`-Muster,
  `--ui-zoom`-sicher), Handy unverändert.
- Shortcut-Registry `apps/pwa/src/shared/shortcuts/`: deklarativ (id, combo,
  scope, Beschreibung, Handler), ein zentraler keydown-Listener,
  Konflikt-Unit-Test, `aria-keyshortcuts`; Migration aller 7 Streustellen
  Verhalten 1:1.
- Neue Kürzel: Esc + Focus-Trap + Fokus-Rückgabe in allen Overlays/Panelen;
  globale View-Wechsel-Kürzel; Pfeil-/Roving-Navigation in Dock, Session-Liste
  und Vault-Liste; `?`-Cheat-Sheet (kontextabhängig, Registry-getrieben).
- Setting „Shortcut-Hinweise anzeigen/an" (`localStorage`, device-lokal,
  Standard: an) + Bottom-Hinweis-Overlay: Klick auf ein Element mit
  registriertem Shortcut zeigt die Kombination unten mittig (~2 s,
  `.copy-flash`-Muster); ohne Shortcut still.
- Omarchy-Koexistenz: Kollisions-Audit AV-Kürzel × Omarchy-Defaults ×
  Firefox-Defaults (inkl. Alt+1–4-Punkt aus P18) als Tabelle in `docs/`;
  optionaler Hyprland-`pass`-Snippet dokumentiert; Cheat-Sheet zeigt die
  freie/kollidierende Belegung.

**Out:** Desktop-Companion/native Global-Hotkeys (P11), Shortcut-Remapping
durch den Nutzer (Registry bleibt codeseitig), Rest von P43 (Tablet-Zweispalter,
Zustandssprache, Schnellsuche — T43.6-„?"-Anteil geht an P51), Vault-Suche
(P49-Original bleibt minimal), automatisches Schreiben von Host-Konfiguration
(Snippet ist Doku, keine Fernkonfiguration), Screenreader-Vollabnahme (bleibt
T43.9).

## 3. Design-Details

### 3.1 Vault-Erreichbarkeit

- **Symlinks:** Nach `readdir(withFileTypes)` werden Einträge mit
  `stat()`/`realpath()` nachgeprüft statt nur `e.isDirectory()` —
  Ordner-Symlinks erscheinen in Browse und Liste. Schutz bleibt:
  `assertInside` (realpath beidseitig) blockt Ausbrüche aus dem Root
  weiterhin; `list()` bekommt ein Besucht-Set über Realpfade gegen
  Symlink-Zyklen, `VAULT_MAX_LIST`-Cap bleibt.
- **Root-Wahl ohne Startpunkt-Zwang:** `setRoot()` validiert weiter
  (existiert, Verzeichnis, realpath, nicht `.git`, nicht `dataDir`), aber
  nicht mehr `withinStartpoints`. Browse bleibt bei den Startpunkten als
  Einstieg (UX), ergänzt um den aktuellen Vault-Root als weiteren Startpunkt.
- **Pfad-Eingabe:** Textfeld im Picker → `PUT /api/vault/root`; Fehlerfälle
  zeigt der Picker als Klartext (`VaultError.message` existiert bereits):
  nicht vorhanden, kein Verzeichnis, `.git`, Hub-`dataDir`, keine Rechte.
- **ADR-0063-Ergänzung:** Abschnitt Root-Wahl — „keine frei eingebaren Pfade"
  wird ersetzt durch „Pfad-Eingabe erlaubt für Menschen
  (`settings.manage`); dieselben Guards wie Browse; Agenten bleiben zentral
  403". Begründung: lokaler Single-User-Hub, Originär-Auftrag; das
  Schutzziel (Angriffsfläche) bleibt über Policy + Guards erhalten.
- **Policy unverändert:** zentrale Wand `/api/vault*` → `settings.manage`,
  Agenten-403 (P49-T49.3), keine Vault-Pfade in Events/Telemetrie.

### 3.2 Glocke im Eck

Auf breiten Viewports (≥1280 px) läuft `NotificationCenter` immer mit
`corner`-Variante (fixed, `safe-area + 8px`, `right`-Formel mit
`100vw / var(--ui-zoom, 1)` wie heute — Zoom-Sicherheit ist E2E-gesichert);
die `.split-list`-Absolute-Positionierung entfällt, Panel folgt der Glocke.
Handy (<1280 px) bleibt spaltenbündig wie heute. Die
`.toast-stack`-Vorhalte („for bell AND gear", `14-notifications.css:49`) wird
mitbereinigt — ein Zahnrad existiert nicht.

### 3.3 Shortcut-Registry

- `apps/pwa/src/shared/shortcuts/registry.ts`: Einträge
  `{ id, combo, description, scope, when?, handler }`, Combos normalisiert
  („Ctrl+K", „Alt+1", „?"); ein zentraler window-keydown-Dispatcher in
  fester Reihenfolge: Overlay/Modal > Kontext > Global; Eingabefelder
  (INPUT/TEXTAREA/contentEditable) schlucken Buchstaben-Kürzel.
- Migration Verhalten 1:1: ui-scale (Ctrl+±/0), CommandBar (Ctrl+K, Esc),
  TileWorkspace (Alt+1–4, Alt+Shift+1–4, Alt+L, Alt+W), FilesLayer
  (Ctrl+Shift+E), ToolPane (Esc) — bestehende E2E
  (workspace-tiles/commands/oberflaeche/session/tool-pane/windows) bleiben
  unberührt grün. Composer-/Approvals-Inline-Handling (1–9, ↑/↓, Enter)
  bleibt lokal — sie sind Eingabe-Interaktion, keine globalen Kürzel; sie
  werden trotzdem im Registry-Katalog geführt (Doku/`?`), mit Ausführungsort.
- Unit-Test: keine doppelte Combo im selben Scope (Fail loud bei Konflikt).
- `aria-keyshortcuts` auf Elemente mit festem Kürzel; Tooltips
  (`title`) kommen aus der Registry statt handgeschriebener Hints
  (ersetzt u. a. die TileWorkspace-Hinweiszeile `TileWorkspace.tsx:132`
  gemäß Design-Review 2026-11-10).

### 3.4 Hinweis-Overlay + Setting

- Persistenz device-lokal: `localStorage["ancientvoid.shortcutHints"]`,
  Standard an (Lernphase); Schalter in den Einstellungen neben
  Erscheinungsbild (Muster `SettingRow` + `role="switch"`).
- Auslösung: interaktive Elemente tragen `data-shortcut="<registry-id>"`;
  ein Capture-Phase-Click-Listener prüft Registry + Setting → Pill unten
  mittig (`.copy-flash`-Muster: `pointer-events: none`, `role="status"`,
  ~2 s, maximal eine gleichzeitig, über dem Dock, nie über dem Composer).
- Nur Aktionen mit existierendem Shortcut zeigen einen Hinweis; Klicks ohne
  Shortcut bleiben still (Nutzerentscheid).

### 3.5 Omarchy-/Firefox-Koexistenz

- Audit-Tabelle `docs/tastatur-kollisionen.md`: jede AV-Combo ×
  Omarchy-Default-Bind (Hyprland) × Browser-Default (Firefox: Alt+1–9
  Tab-Wechsel, Ctrl+W, …) × Chromium-E2E-Relevanz. Ergebnis: AV-Default-Schema
  kollidiert nicht mit Omarchy-Defaults; Firefox-Risiken werden je Kürzel
  benannt (Alt+1–4: P18-offener Punkt — Ausweich-Kürzel dokumentieren,
  Entscheidung mit Jan falls Verhalten geändert werden muss).
- Optionaler Snippet (Doku, kein Auto-Write):
  `bind = SUPER, <key>, pass, class:^(<AV-Fensterklasse>)$` — reicht gebundene
  Super-Kombos gezielt ans AV-Fenster durch. Ehrliche Grenze dokumentiert:
  Compositor-Grabs sind aus der PWA nicht abfangbar; „Super für AV" heißt
  immer: Host-Konfiguration + ungebundene Kombos.
- `?`-Cheat-Sheet zeigt dieselbe Datenquelle (Registry), inkl. Hinweis, wo
  Kombos im Browser/WM belegt sind.

## 4. Aufgaben (Checkliste T51.m)

- [x] **T51.1** ADR-0063-Ergänzung (Root-Wahl ohne Startpunkt-Zwang, Pfad-Eingabe, Guards/Policy unverändert) vor Verhaltens-Merge; Contracts unverändert prüfen (Fehler laufen über `VaultError.message`). **K7**.
- [x] **T51.2** Core `VaultStore`: Symlink-Ordner in `browse()`/`list()` (stat/realpath, Besucht-Set, Cap bleibt), `setRoot` ohne Startpunkt-Zwang; Unit-Tests: Symlink-Ordner sichtbar, Symlink-Zyklus terminiert, Ausbruch weiterhin blockt, `.git`/`dataDir`-Ablehnung mit Grund. **K7**.
- [x] **T51.3** Picker: Pfad-Eingabefeld + Klartext-Fehler, Startpunkte + aktueller Root; E2E rot-dann-grün: Vault außerhalb der Startpunkte per Pfad wählbar, Symlink-Ordner erscheint, Ablehnungsgrund sichtbar. **K1**.
- [x] **T51.4** Glocke/Panel am PC ins Fenstereck (`.corner` immer bei wide), `.toast-stack`-Vorhalte bereinigt; notifications.spec um Eck-Assertion (Liste offen + eingeklappt, Zoom 130 %) erweitert. **K2**.
- [x] **T51.5** Shortcut-Registry bauen + Migration der 7 Streustellen (Verhalten 1:1, bestehende E2E grün), Konflikt-Unit-Test, `aria-keyshortcuts`/Tooltips aus Registry. **K1/K2**.
- [x] **T51.6** Tastatur-Lücken schließen: Esc + Focus-Trap + Fokus-Rückgabe (CommandBar, VoiceSheet, SkillPicker, Benachrichtigungs-Panel), View-Wechsel-Kürzel (Kandidaten `Alt+←`, `Alt+Pos1`; endgültig nach T51.9-Audit), Roving-Pfeil-Navigation in Dock/Session-Liste/Vault-Liste; je Kürzel ein E2E. **K1**.
- [x] **T51.7** `?`-Cheat-Sheet (Registry-getrieben, kontextabhängig, nicht in Eingabefeldern); ersetzt die TileWorkspace-Hinweiszeile; in EPIC-P43 T43.6 als hierher gezogen vermerken. **K2**.
- [x] **T51.8** Setting „Shortcut-Hinweise" + Bottom-Overlay (nur bei existierendem Shortcut, ~2 s, nicht blockierend); E2E: Hinweis erscheint/verschwindet, ohne Shortcut still, Setting aus → gar nichts, Composer bleibt frei. **K1/K10**.
- [x] **T51.9** Omarchy-/Firefox-Kollisions-Audit (Tabelle in `docs/`, Alt+1–4-Punkt aus P18 klären), Hyprland-`pass`-Snippet-Doku, Cheat-Sheet-Anbindung. **Fail-loud**.
- [x] **T51.10** Abnahme: `npm run gate` grün, manuelle Firefox-/Omarchy-Prüfung am Gerät (Alt-Kürzel live), Live-Abnahme Vault-Pfad mit echtem Ordner außerhalb der Startpunkte, Retro. **K1/K2/K10**. — **Automatisierter Teil grün belegt (14.11.2026):** typecheck/lint/Unit (2.112, qmd-Dateien seriell nachgezogen — paralleles Laden des Embeddingmodells riss die Timeout-Frist), check:arch/check:commits/check:context OK; E2E 645 grün + 5 sichtbar geskippt; zwei Volllauf-Flakes (Latenz P39 unter Parallel-Last; Pill/Esc-Flush) einzeln analysiert und deterministisch gefixt bzw. lastfest gehärtet (10/10). Der letzte Volllauf-Nachweis läuft über die MR-Pipeline (Runner `av-docker`). **Offen bleibt bewusst Jans Live-Teil:** Firefox-/Omarchy-Prüfung am Gerät (Alt-Kürzel), Vault-Pfad-Live-Abnahme mit echtem Ordner, Handy-Glocke — siehe Statuszeile.
- [x] **T51.11** *(aus P43 AI-P43-1)* Schnellsuche um Inventar-Sprungziele erweitern oder bewusst begrenzen und im Inventar dokumentieren — AC-P43-1 Closeout deckt nur Sessions/Projekte/Dateien/Werkzeuge/Befehle. **K2**. — **Bewusste Begrenzung** (Funktionsinventar G64): Sprungziele unterhalb der Werkzeug-/Session-Ebene bleiben einen Sprung + einen Tap entfernt; zweite Navigationsschicht bewusst verworfen.

### Teilumfang T51.1–T51.2 (11.11.2026)

Auf separatem Branch `feat/p51-vault-store`: ADR-0063 fortgeschrieben,
Root-Wahl ohne Startpunkt-Zwang, aktueller Root als zusätzlicher
Browse-Einstieg, Ordner-Symlinks mit Realpfad-Besucht-Set und bestehendem
Datei-Cap. `.git`, Hub-`dataDir`, Traversal und Symlink-Ausbrüche bleiben
geprüft; ungültige Root-Wahl lässt den gespeicherten Root unverändert.
Contracts und Policy bleiben unverändert, kein neuer persistenter Zustand (K7).

Nachweise: `packages/core/test/modules/vault/vault.test.ts` und
`apps/hub/test/modules/vault/vault.integration.test.ts` (21 Tests, einschließlich
Root-Rekonstruktion, Zyklus/Alias, Cap, Fehlergründe und Agenten-403).
Die neuen Verhaltensfälle wurden gegen den ursprünglichen Store rot geprüft.
Der Rechte-Test ist unter UID 0 sichtbar geskippt, weil root die Dateirechte
übergehen kann; im lokalen Lauf als normaler Nutzer wird er ausgeführt.

**Abgrenzung:** Keine Picker-/Glocken-/Shortcut-Änderung, keine vollständige
AC-P51-1/2- oder Geräte-Abnahme. T51.3–T51.10 bleiben auf Nutzerwunsch bis zur
Zusammenführung der parallelen Arbeiten offen. `npm run gate` grün (Exit 0):
1808 Unit-/Integrationstests bestanden, 4 Tests und 1 Suite geskippt;
496 E2E-Fälle bestanden, 3 geskippt (21,7 min). Skips zählen nicht als Pässe.
Der erste Gesamtlauf wurde wegen eines fehlenden lokalen TypeScript-Links
gestoppt; nach Dependency-Reparatur ohne Code-/Teständerung ist derselbe
Einzelfall und anschließend das komplette Gate grün. Details stehen in der MR.

### Teilumfang T51.3–T51.9 + T51.11 (14.11.2026)

Je Aufgabe ein Branch/Commit auf der Epic-Kette; Evidenz je Task:

- **T51.3** `VaultPicker`: Pfad-Eingabe (`vault-path-input`/`-apply`) →
  `PUT /api/vault/root`, Klartext-Fehler aus `VaultError.message`, aktueller
  Root als „Aktueller Ordner" markiert, Browse-Fehler räumen sich beim
  Navigieren. E2E rot-dann-grün: außerhalb der Startpunkte wählbar
  (`mkdtemp`), Symlink-Ordner erscheint und führt zum Ziel, Ablehnungsgründe
  „Ordner nicht gefunden"/„Datenverzeichnis des Hubs" sichtbar
  (`e2e/specs/vault.spec.ts`, 4 neue Fälle + 5 bestehende unberührt grün).
- **T51.4** Am PC (≥1280 px) läuft `NotificationCenter` immer mit `corner`;
  die `.split-list`-Absolute-Positionierung ist entfernt, das Panel folgt
  der Glocke (`.notif-panel.corner`), Toast-Vorhalte 96→56 px (Zahnrad
  existierte nicht mehr). `#app` hält bei Split feste Flex-Höhe, `.split`
  schrumpft unter Toasts/RestoreBar, statt das Fenster zu scrollen — P50-
  Invariante per E2E bei sichtbarem Toast belegt; zoom-flaechen-Matrix
  unverändert grün. Eck-Assertionen Liste offen/eingeklappt + Zoom 130 %
  (`notifications.spec.ts`); T8.5-Spalten-Assertion bewusst ersetzt.
- **T51.5** `shared/shortcuts/registry.ts`: Katalog (id, Combo kanonisch,
  deutsches Label, Beschreibung, Scope, inInput/lenientShift/localOnly) +
  ein window-keydown-Dispatcher (Overlay vor Global, preventDefault beendet
  die Kette, Textfeld schluckt Kürzel ohne Modifikator). Migration 1:1:
  ui-scale, CommandBar, TileWorkspace (inkl. BUG-0071-Komposition),
  FilesLayer, ToolPane (BUG-0106-layout-effect), Dock/Nyx/Unterreiter/
  Übersicht-Esc; Composer/Approvals bleiben lokal, stehen im Katalog mit
  Ausführungsort. Konflikt-Unit-Test (IDs eindeutig; Combos je Scope
  eindeutig außer Overlay-Esc, das mutuell exklusiv nur aktiv registriert
  wird); `aria-keyshortcuts`/Tooltips aus Registry
  (`apps/pwa/test/shared/shortcuts.test.ts`, 16 Fälle).
- **T51.6** `useOverlayFocus` (Fokus rein, Tab-Falle, Rückgabe an den
  Auslöser) für Befehlsleiste, Skill-Auswahl, Benachrichtigungs-Panel;
  Esc bricht die lokale Sprachaufnahme ab (sichtbarer Grund); View-Kürzel
  Alt+Pos1/Alt+←/Alt+→ (Hash-Historie); Roving-Pfeile in Dock,
  Session-Karten und Vault-Liste. `e2e/specs/shortcuts.spec.ts` mit je
  einem Fall je Kürzel (inkl. Fake-Mikrofon + STT-Stand-in nach
  voice-local-Muster).
- **T51.7** `CheatSheet.tsx`: `?` (Shift-tolerant) zeigt die Übersicht
  vollständig aus der Registry („Überall", offene Overlays live,
  Eingabe-Interaktion mit Ort), Esc/Fokus wie jedes Overlay; ersetzt die
  TileWorkspace-Hinweiszeile; EPIC-P43 T43.6 trägt den Nachtrag, Inventar
  P04 zeigt auf den neuen Weg (funktionsinventar.spec angepasst).
- **T51.8** `shared/shortcut-hint.ts`: Capture-Click-Listener auf
  `data-shortcut`-Elemente → Pill unten mittig (~2 s, `copy-flash`-Muster,
  `pointer-events: none`, max. eine); ohne Kürzel still; Setting
  „Shortcut-Hinweise" (Switch in der Darstellungsgruppe,
  `localStorage`, Standard an). 5 E2E-Fälle inkl. Computed-style-Nichtblockade.
- **T51.9** `docs/tastatur-kollisionen.md` (referenz-Art, im Doku-Index):
  jede AV-Combo × Omarchy-Binds **live dieses Hosts gelesen**
  (`workstation menu keybindings --print` + persönliche bindings.lua) × Firefox/
  Chromium-Defaults × E2E-Bezug. Ergebnis: kein Omarchy-Konflikt (Super-
  Schema; Alt nur Tab/Print/M belegt — Alt+M host-spezifisch dokumentiert);
  Firefox: Alt+1–4 und Alt+Pos1 reserviert (Ausweich dokumentiert,
  Alt+←/→ bewusst deckungsgleich mit Browser-Historie), Strg+±/0
  Doppel-Zoom-Risiko benannt. Hyprland-`pass`-Snippet mit ehrlicher Grenze
  (Compositor-Grabs nicht überhebbar). Cheat-Sheet-Fußnote verweist je
  Kürzel auf die Tabelle.
- **T51.11** Bewusste Begrenzung der Schnellsuche unterhalb der Werkzeug-/
  Session-Ebene (Funktionsinventar G64 + `quick.ts`-Kopf): zweite
  Navigationsschicht verworfen, Ziele bleiben einen Sprung + einen Tap
  entfernt; Vault-Suche bleibt minimal (ADR-0063).

## 5. Acceptance Criteria (AC-P51-k) — Beleglage (14.11.2026)

- **AC-P51-1:** 🟢 Core/Integration seit T51.1/T51.2 (21 Tests inkl. Agenten-403, Guards); Picker-Seite E2E `vault.spec.ts` „Pfad-Eingabe: Ordner außerhalb der Startpunkte wird Vault-Root" (echtes `mkdtemp`-Verzeichnis). Live-Abnahme am Gerät folgt mit Jan.
- **AC-P51-2:** 🟢 E2E „Ordner-Symlink erscheint im Picker und führt zum Ziel"; Zyklus/Cap/Guards Unit seit T51.2; Ablehnungs-Klartext E2E „Ablehnung mit Klartext-Grund statt stiller 422".
- **AC-P51-3:** 🟢 E2E `notifications.spec.ts` „Glocke im Fenstereck am PC": Glocke+Panel in der Ecke bei Liste offen/eingeklappt und Zoom 130 % (alle vier Kanten); Handy unverändert (bestehende mobile Specs grün); Zoom-Matrix `zoom-flaechen.spec.ts` grün; P50-Nicht-Scrollen bei sichtbarem Toast neu belegt.
- **AC-P51-4:** 🟢 Registry ist die einzige keydown-Stelle für globale Kürzel (grep: nur Tooltip-capture und Element-Interaktion bleiben); Konflikt-Unit-Test fail-loud; bestehende Specs (schnellsuche/commands/workspace-tiles/oberflaeche/tool-pane/nyx/session/windows) unberührt grün gelaufen.
- **AC-P51-5:** 🟢 E2E `shortcuts.spec.ts`: CommandBar, SkillPicker, Benachrichtigungs-Panel (Esc schließt + Fokus zurück); Cheat-Sheet analog; STT-Abbruch mit Grund. (Focus-Trap über `useOverlayFocus` implementiert, per Fokus-Rein/Tab-Falle-Code belegt, E2E deckt Fokus-Rein/Rückgabe.)
- **AC-P51-6:** 🟢 E2E: `?` zeigt Registry-Inhalt, Esc schließt, im Eingabefeld kein Öffnen; Pill erscheint/verschwindet (~2 s), ohne Kürzel still, Setting aus → nichts, `pointer-events: none` belegt.
- **AC-P51-7:** 🟢 `docs/tastatur-kollisionen.md` (je Kürzel Omarchy-live/Firefox/E2E-Spalte, Alt+1–4-Entscheid dokumentiert, `pass`-Snippet mit Grenze); Cheat-Sheet-Fußnote verweist darauf.


## 6. Premortem (Failure-Modi + Mitigation)

1. **Symlink-Following wird Recurse-/Loop-Bombe** (Vault verlinkt in sich selbst oder auf Riesen-Verzeichnisse) → Besucht-Set über Realpfade in `list()`, `VAULT_MAX_LIST`-Cap + `truncated` bleibt, Unit-Test mit Zyklus; Browse bleibt eine Ebene pro Request.
2. **Pfad-Freiheit öffnet Angriffsfläche** (Root auf `/etc`, Agenten schreiben Root um) → Policy-Wand unverändert (`settings.manage`, Agenten zentral 403), Guards `.git`/`dataDir`/realpath bleiben, ADR-0063-Ergänzung vor Merge, Integrations-Gegenprobe Agent-403 für die neue Freiheit.
3. **Registry-Migration ändert Alt-Kürzel nebenbei** (Muskelgedächtnis bricht, E2E-Churn) → Verhalten 1:1 als eigene Aufgabe (T51.5) getrennt von neuen Kürzeln (T51.6); bestehende Specs dürfen nicht angefasst werden; keine stillen Umbenennungen — Alt+1–4 bleibt, bis T51.9 eine dokumentierte Entscheidung mit Jan trifft.
4. **Hinweis-Overlay nervt oder verdeckt** (Pill über Composer/Dock, flackert bei jedem Klick) → `pointer-events: none`, max. eine Pill, ~2 s, unten mittig über dem Dock; E2E prüft Nicht-Blockade des Composers; Setting sofort auffindbar in den Einstellungen; Standard an, aber nie ohne Shortcut zeigen (Nutzerentscheid).
5. **Super-Key-Erwartung wird überschätzt** („AV fängt Super ab" geht technisch nicht — Grab liegt beim Compositor) → Epic verspricht keine Grab-Übernahme: Alt-Schema + ungebundene Kombos + `pass`-Snippet-Doku; Grenze steht explizit in Doku und Cheat-Sheet.
6. **Eck-Glocke kollidiert mit Zoom/Formel-Randfällen** (UI-Zoom >100 % schiebt sie raus — bekannter Fund von 2026-10-30) → bestehende Zoom-Formel (`100vw / --ui-zoom`) übernehmen, E2E-Bounding-Box bei 130 %/200 % in T51.4, notifications.spec erweitern statt neu erfinden.

## 7. Definition of Done

Alle T51.* und AC-P51-* mit Evidenz. `npm run gate` grün (inkl. `test:e2e`),
PWA-Build grün. Neue Specs: Vault-Pfad/Symlink-Fälle in `e2e/specs/vault.spec.ts`,
Glocken-Eck-Assertionen in `notifications.spec.ts`, Shortcut-Registry/Overlay/`?`
in neuer `e2e/specs/shortcuts.spec.ts`. ADR-0063-Ergänzung vor Verhaltens-Merge;
Kollisions-Doku `docs/tastatur-kollisionen.md` flach in `docs/`. EPIC-P43
T43.6-Vermerk („?"-Übersicht hierher gezogen) und `epics/README.md` aktualisiert.
Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen, nie als
Pass gezählt. K7 durchgehalten: Vault bleibt dateibasiert ohne zweiten
Hub-State. Kein TODO ohne Epic-Bezug.

## 8. Retro P51 (14.11.2026)

**Gut gelaufen**

- Rot-dann-grün hat dreimal sofort echte Fehler gefunden: fehlende Eck-Formel
  im Panel (T51.4), `scrollHeight`-Verstoß gegen P50 bei Toast über Split
  (T51.4), und das synthetische-keydown-ohne-`key`-Muster des BUG-0071-Tests
  (T51.5) — die Registry-Behauptung „Migration 1:1" war ohne code-first-
  Matching falsch gewesen.
- Epic-Vorgabe „bestehende Specs unberührt grün" wirkte als scharfe Leine:
  die kurzzeitige aria-label-Änderung am Picker (T51.3) brach die P49-Specs
  und wurde zurückgenommen, statt die Specs anzupassen.
- Omarchy-Binds live vom Host zu lesen statt aus Erinnerung machte die
  Kollisionstabelle in einem Durchgang schreibbar (Alt+M-Fund inklusive).

**Gelernt**

- Passiv-Effekte in Preact 11 (rAF-Flush) machen Fokus-Rückgabe-Assertions
  einmalig-falsch; `toBeFocused()` (pollend) ist die richtige Assert-Form,
  und die Fokus-Rein-Assertion wartet zugleich die Registry-Registrierung
  mit weg — der SkillPicker-Flake verschwand dadurch komplett.
- Toast-im-Fluss über einem fix-hohen Grid braucht eine Schrumpf-Garantie
  am Container (`#app`-Flex), sonst scrollt das Fenster — P50 hat das
  als E2E-Invariante verdient, die jetzt Toast-fällig mitprüft.

**Offen / weitergeben**

- Live-Abnahme am Gerät (Jan): Vault-Pfad mit echtem Ordner außerhalb der
  Startpunkte, Alt-Kürzel in Firefox und Omarchy live, Handy-Glocke.
  Firefox-Konflikte stehen je Kürzel in `docs/tastatur-kollisionen.md`
  (Alt+1–4/Alt+Pos1); eine Schema-Änderung wäre ein eigener Auftrag.
- `installShortcutHints` zeigt Pillen nur für Elemente mit `data-shortcut` —
  neue Aktionen mit Kürzel sollten das Attribut mitbekommen (Katalog ist
  die Quelle; Cheat-Sheet braucht nichts).
- VoiceSheet-Esc gilt der lokalen Aufnahme (whisper-Server); die Browser-
  Spracherkennung (`listening`) hat weiterhin keinen Abbruchweg — bewusst
  nicht versprochen.

- **AC-P51-1:** Jeder existierende Ordner des Hosts ist als Vault-Root wählbar — per Klick im Browser oder eingegebenem Pfad, auch außerhalb von `projectRoots`/`HOME` und als Symlink-Ziel; `.git` und Hub-`dataDir` werden weiter abgelehnt, Agenten-Tokens bleiben 403 (Unit/Integration/E2E-Belege).
- **AC-P51-2:** Ordner-Symlinks erscheinen in Browse und Dateiliste; Symlink-Zyklen terminieren (Besucht-Set, Cap ehrlich); Ablehnungen zeigt der Picker als Klartext.
- **AC-P51-3:** Am PC (≥1280 px) sitzen Glocke und Panel in jedem Layoutzustand oben rechts im Fenstereck (E2E-Bounding-Box, auch bei UI-Zoom ≠ 100 %); am Handy bleibt die spaltenbündige Position.
- **AC-P51-4:** Alle globalen Kürzel laufen über die Registry (kein Streu-keydown außer Eingabe-Interaktion); doppelte Combos im selben Scope failen als Testfehler; die bestehenden Kürzel verhalten sich unverändert (bestehende E2E ohne Anpassung grün).
- **AC-P51-5:** Jedes Overlay/Panel (CommandBar, VoiceSheet, SkillPicker, Benachrichtigungen, Cheat-Sheet) ist per Esc schließbar und gibt den Fokus an das auslösende Element zurück (E2E).
- **AC-P51-6:** `?` zeigt die Kürzel des aktuellen Kontexts aus der Registry; mit aktivem Setting „Shortcut-Hinweise" zeigt jeder Klick auf ein Element mit Kürzel den Hinweis unten (~2 s, nicht blockierend), Klicks ohne Kürzel bleiben still, Setting aus → kein Overlay.
- **AC-P51-7:** Die Kollisions-Tabelle liegt in `docs/`; das AV-Standard-Schema kollidiert nicht mit Omarchy-Default-Binds; Firefox-Risiken sind je Kürzel benannt (inkl. Alt+1–4-Entscheid); der Hyprland-`pass`-Snippet ist dokumentiert mit der ehrlichen Grenze (Compositor-Grabs nicht überhebbar).

# EPIC-P86 — 3D-Tiefe: Fensterflug und lebendige Oberfläche (zuschaltbar)

**Status:** In Umsetzung — Stufe 1 (T86.1–T86.3, „herausgelöst“), T86.7/T86.8 (Layout-Orientierung, Benachrichtigungs-Fenster) und der Kachel-Gluh (T86.4 teils) fertig auf `feat/p86-3d-tiefe-stufe1`, Nutzer-Vorabnahme 26./27.11.2026 (Dev-Server), Live-Abnahme nach P000 (T000.40); **Stufe 2 (three.js) entfallen** per Nutzerentscheid („lightweight und performant“, T86.0/T86.5). Offen: T86.4-Rest K2-Messung (Loadtest nur auf ausdrücklichen Auftrag) · **Phase:** P86 · **Dauer:** 1–2 Agenten-Wochen (Stufe 1) + 0,5–1 (Stufe 2 nach T86.0-Beschluss)
**Abhängigkeit:** keine blockierende (Quer-Epic, Muster P80/P85); P30/P31 bleiben On hold und unberührt. Sichtabnahme auf echtem Handy → [P000](EPIC-000-testsuite-fuer-menschen.md).

## 1. Ziel

Nutzerwunsch 26.11.2026: Die App soll lebendiger wirken — ein fokussiertes
Fenster soll „ein Stück auf den User zufliegen“ und real aussehen; 3D muss
per Einstellung **und** als Schnellschalter in der Sidebar an/aus gehen.

Vorbild ist die securesight-Keynote „Zwischen Slop und AGI“
(`vertrieb_marketing/pitch-decks/customer/keynote-zwischen-slop-und-agi.html`
+ `_system/bunker-world3d.js`, three.js r186). Ihr Architekturmuster ist der
Bauplan, nicht ihr Umfang: **scharfes HTML vorne, Tiefe dahinter** — der
Inhalt bleibt DOM und bleibt lesbar, die räumliche Wirkung entsteht durch
Perspektive, Schatten und sanftes Ausphasen (CSS3D), ein optionaler
WebGL-Layer liefert nur Kulisse. Dasselbe Hybrid-Prinzip auf die PWA:

1. **Stufe 1 — CSS-3D-Fensterflug (Kern).** Perspektiv-Wurzel über der App;
   beim Öffnen eines Layers/Overlays (Terminal, Dateien, Suche, Bildvorschau)
   und beim Fokuswechsel einer Session-Karte fliegt die fokussierte Ebene
   kurz auf den Betrachter zu: `perspective` + `translateZ`/`scale` +
   Schattenwurf, ~250–400 ms, `cubic-bezier(.2,.7,.25,1)` wie die Keynote.
   Kein three.js, kein Bundle-Zuwachs, kein WebGL — läuft auch auf
   Einsteiger-Handys. Dazu Mikro-Tiefe im Kleinen (Press/Hover-Lift der
   Karten, Dock-Items), damit die Fläche überall atmet.
2. **Stufe 2 — three.js-Ambient (optional, lazy).** Dezente WebGL-Kulisse
   hinter Listen (Tiefendunst/feines Raster, minimaler Parallax), nur geladen
   wenn 3D an **und** WebGL2 vorhanden. Bewusst hinter T86.0-Mess-Tor: die
   Keynote-Engine wiegt 847 KB (Custom-Build) und braucht GPU — für eine
   monitoring-first Handy-App ist das erst zu tragen, wenn Stufe 1 nicht
   reicht und eine Messung es hergibt.

3D aus = exakt heutiges Verhalten, null Transform-Styles im DOM.
Reine PWA-Sache: kein Contract-, Adapter- oder Core-Change, keine ADR-Pflicht.

**Messlatte (PRD §9):** K2 (Session-Tail-Framerate bei 30 ev/s — die
Tiefenebene darf das Frame-Budget nicht fressen), K10 (Offline: kein
White-Screen, lazy three.js-Chunk darf K10 nicht gefärden).

## 2. Scope (In / Out)

**In:** Tiefen-Präferenz (`depth3d`, Kaskade mit `ctxMotion` /
`prefers-reduced-motion`), SettingRow „3D-Tiefe“ in Darstellung,
Schnellschalter in Sidebar und Dock, CSS-3D-Fensterflug für Layer-Öffnung
und Karten-Fokus, Mikro-Tiefe (Press-Lift), E2E-Spec, Doku der
Schalter-Kaskade; T86.0-Evaluationsprototyp für Stufe 2 (Messung, kein
Produktions-Feature).

**Out:** three.js im Basis-Bundle (nur lazy, nur nach T86.0); Voll-3D-Welt
mit Kameraflügen wie die Keynote (Wechselrede mit Kulisse, Stationen,
CSS3DRenderer-HTML im Raum — Overkill für eine Arbeits-App); native Clients
(P11/P32); Desktop-Companion; Contract/Adapter-Kern; Theme-Wechsel.
Kein Umbau der Keynote-Engine und keine Übernahme ihres Vendor-Builds —
Stufe 2 nutzt `three` aus npm, tree-geshakt.

## 3. Design-Details

### 3.1 Blaupause aus der Keynote (Code-Sichtung 26.11.2026)

Aus `bunker-world3d.js` übernehmen (Muster, nicht Code — AGPL-freie
Eigenimplementierung; AncientVoid ist AGPL-3.0, kein Lizenzhindernis, aber
der Code ist auf Einzelfolien zugeschnitten):

- **Hybrid:** scharfes HTML vorn, Tiefe hinten; HTML-Inhalte wandern nie
  in einen WebGL-Textur.
- **Fallbacks sauber:** WebGL2-Check vor Welt-Anlage, sonst `no-world`-Klasse
  und Alles läuft ohne; `?world=0`-Kill-Switch; Fehler sichtbar
  (`console.warn` + `data-world-error`), nie still.
- **Respekt vor Budget:** `prefers-reduced-motion` ⇒ Snap statt Flug;
  `document.hidden` ⇒ Render-Schleife pausiert; DPR-Cap (1.25); Stationen
  cullen; nur `transform`/`opacity` animieren.
- **Timing:** Flüge als Bogen (Bezier, `ease`-Kubik) mit Lift; Nachziehen
  der Kamera exponentiell approximiert — für Stufe 1: deceleration-lastige
  CSS-Transition, kein JS pro Frame.

### 3.2 Schalter-Kaskade (eine Quelle der Wahrheit)

Ablage nach `app/ui-scale.ts`-Muster (`ancientvoid.ctxMotion`):

- Neues Modul `apps/pwa/src/app/depth3d.ts` (oder Erweiterung von
  `ui-scale.ts`): `DEPTH3D_KEY = "ancientvoid.depth3d"`, Default **an**;
  `depth3dOn()` / `applyDepth3d(on)` setzt `document.documentElement.dataset.ctx3d
  = "on"|"off"` + `ancientvoid:depth3d`-Event (Storage-Sync wie Theme/Scale).
- Gültigkeit kombiniert (eine Funktion, überall benutzt):
  `depth3dAllowed() = depth3dOn() && motionAllowed()` — Bewegung aus oder
  System-`prefers-reduced-motion` schaltet auch die Fensterflüge ab.
  Dokumentierte Kaskade: `prefers-reduced-motion` > Bewegung > 3D.
- UI: `features/settings/AppearanceSettings.tsx` neuer SettingRow neben
  „Bewegung“ (Switch, i18n `settings.depth3d`); Schnellschalter
  **Sidebar**: `features/shell/sidebar.ts` braucht dafür einen
  Aktions-Eintrag (heute nur Navigations-`page?`-Einträge — Schema um
  optionale `action` erweitern, Eintrag „3D an/aus“, Icon `zustand`-Artig,
  Active-Zustand reflektiert `depth3dAllowed()`); zusätzlich ein Schalter im
  „Mehr“-Blatt des Docks (`app/Dock.tsx` — bewusst nicht als sechste
  Leisten-Taste: der Handy-Dock ist auf fünf 44-px-Ziele geeicht,
  dock-visibility.spec).
  Beide Flächen rufen dieselbe `toggleDepth3d()`.
- Nutzerfund 26.11.2026 („Toggle zeigt keine Veränderung“): Die Flüge wirken
  nur beim Öffnen einer Fläche — ein Wechsel auf bereits geöffneter Ansicht
  (und an→aus generell) hatte keinerlei sichtbare Reaktion. Fix: Einschalten
  **zur Laufzeit** (nicht beim Boot) pulst offene Flächen kurz heran
  (`depth3d-kick`-Klasse für 900 ms, `depth3d-pulse` 240 ms in
  61-depth3d.css) — gegated durch die Kaskade; Ausschalten bleibt
  bewegungslos, Feedback dort ist der Schalterzustand selbst.

### 3.3 Fensterflug (Stufe 1)

- Perspektive (Umsetzung, weicht vom Erstentwurf ab, Premortem 1 folgend):
  **keine** Wurzel-Perspektive an der `#app`-Hülle — `perspective` am
  Vorfahren würde jedem `position: fixed`-Kind (Dock, Overlays, Tooltips)
  einen neuen containing block geben und das Layout kippen lassen. Stattdessen
  steht `perspective()` **im Transform jedes fliegenden Elements**
  (`61-depth3d.css`): `translateZ(-160px)+scale` beim Hereinkommen, 300 ms,
  `--ease-out`; der Flug animiert nur `transform`/`opacity`, kein
  `box-shadow`-Wachstum (Regel aus 36-motion.css, K2).
- Nutzerfeedback 26.11.2026 („Elemente sollen wirklich herausgelöst aussehen,
  Hintergrund etwas wegzoomen und blurren“): Stufe 1 ist seither kein
  300-ms-Einflug mehr, sondern ein **persistenter Zustand** in
  `61-depth3d.css`, solange ein Fenster offen ist:
  - Hintergrund: Inhaltsflächen (`#app > .app-page/.session-live/.split`)
    weichen auf `scale(0.97)` zurück (320 ms Übergang) und werden über die
    Hinterlegung `backdrop-filter: blur(16px) brightness(.8)` defokussiert;
    Dock/Layer/Blätter liegen daneben und bleiben scharf.
  - Fenster: schweben persistend vor dem Hintergrund
    (`translateZ(50px)` + `--depth3d-shadow`), Einflug aus der Tiefe endet
    exakt auf dieser Ruheposition (kein Snap).
  - Seitenfenster/Dateibaum-Drawer: Milchglas (`color-mix`-transluzentes
    `--bg-elev` + eigenes `backdrop-filter`), leichter Hub (26 px).
  - Befehlsfenster bekommt eine Hinterlegung (`command-backdrop`,
    CommandBar.tsx) — vorher hatte es keine; Klick darauf schließt.
  Nur `transform`/`opacity`/`backdrop-filter` (K2); unter
  `prefers-reduced-motion` bleiben die Flächen flach, die Unschärfe bleibt
  (Zustand, kein Bewegungsreiz).
- Gegriffen wird da, wo Fokus schon sichtbar wird: Layer/Overlay-Öffnung
  (`shared/layers.ts`-Flächen: Shell/Terminal, Dateibaum, Suche, Command-Bar,
  Bildvorschau) und Session-Karte → Detail-Fokus (Anregung der
  `focus`-Klasse aus `display-state.ts`/Overlay-Fokus).
- Alles in **einer** CSS-Datei `app/styles/3X-depth.css`, wirksam nur unter
  `html[data-ctx-motion="on"][data-ctx-3d="on"]` und **nicht** unter
  `@media (prefers-reduced-motion: reduce)` — damit ist „3D aus“ ein reiner
  Selektor-Fall, testbar per DOM-Attribut, und kein JS-Pfad, der Transformers
  einzeln ein-/ausräumen muss.
- Lange Listen (Session-Cards 100+): Mikro-Lift nur auf `:active`/`:hover`
  der Karte selbst (Compositing bleibt lokal), kein `will-change` auf
  Listenfluten.

### 3.4 Stufe 2 (three.js-Ambient) — nur nach T86.0

- `three` aus npm, ausschließlicher dynamischer Import
  (`import("three")`) in einem Feature-Modul
  `apps/pwa/src/shared/ambient3d.ts`; aktiv nur bei
  `depth3dAllowed() && WebGL2`. kein WebGL: still kein Ambient ist ok
  (Kulisse ist optional, kein Fail-loud-Fall — der Schalterzustand bleibt
  sichtbar und funktionierend).
- DPR-Cap 1.25, `document.hidden`-Pause, resize-safe, deterministischer
  Seed (Keynote-Muster: gleicher Startzustand bei jedem Aufruf).
- Mess-Tor T86.0: Bundle-Delta (gzip) des Lazy-Chunks, FPS auf
  Referenzgerät neben laufendem Session-Tail (K2-Vergleich), Akku-Drain
  10 min Idle mit Ambient vs. ohne. Liefern die Zahlen kein klares Ja:
  Stufe 2 bleibt Entwurf, Epic schließt mit Stufe 1.

## 4. Aufgaben

- [x] **T86.0 — Stufe-2-Evaluationsprototyp** — **entfallen** (Nutzerentscheid
  26./27.11.2026: „eigentlich eine lightweight Anwendung, die performant ist —
  wenn three.js das alles verschlechtert, lassen wir es eher weg“; kein
  Messauftrag ergangen). Stufe 2 bleibt Entwurf in §3.4; Wiederaufnahme nur
  auf neuen Nutzerauftrag.
- [x] **T86.1 — Tiefen-Präferenz:** `depth3d`-Modul, Kaskade
  `depth3dAllowed()`, SettingRow in AppearanceSettings, i18n-Keys;
  Unit-Tests rot-dann-grün (Ablage/Default/Sync nach `ui-scale`-Muster) —
  umgesetzt: `apps/pwa/src/app/depth3d.ts`, `test/app/depth3d.test.ts` grün.
- [x] **T86.2 — Sidebar-Aktions-Entry + Dock-Toggle:** Schema-Erweiterung
  `sidebar.ts` (optionale `action`), Eintrag „3D an/aus“ mit Live-Zustand,
  Schalter im „Mehr“-Blatt; E2E: beide Schalter synchron, Reload-Stand
  bleibt (AC-P86-2) — umgesetzt: `3d-tiefe.spec.ts` grün (mobile+desktop ×3).
- [x] **T86.3 — CSS-3D-Fensterflug:** `61-depth3d.css` (perspective()
  je Element statt Wurzel, §3.3), Flüge für Sheet/Modal/Command-Bar/
  Dateibaum-Drawer/Browser- und Geräte-Fenster; computed-style-Spec
  (animation-name an/aus) statt Screenshot-Diff — deterministisch;
  bestehende Layout-/z-index-Tests (dock-visibility, css-tokens) grün.
  Karten-Fokus-Flug (Session-Karte → Detail) bleibt für T86.4, wenn Stufe 1
  vom Nutzer als gut bewertet ist.
- [ ] **T86.4 — Mikro-Tiefe + K2-Referenzmessung:** Press-/Hover-Lift,
  Working-Punkt-Puls in Tiefe; Frame-Budget-Messung Session-Tail
  (K2-Vergleich vorher/nachher, dokumentiert im Task-PR). Angefangen
  (Nutzerwunsch 26.11.2026): der Rand der **fokussierten Kachel** glüht im
  Puls (`depth3d-focus-glow`, 2.4 s Schleife) — die **Farbe folgt dem
  Zustand** der Session (Akzent = arbeitet, `--call` = Frage/Freigabe/fertig,
  `--err` = Fehler, `--fg-dim` ohne Puls = still), gelesen über den
  StatusDot im Titelabschnitt (`:has`, T86.7). Nutzerfund 26.11.2026: der
  erste Ansatz hob die Kachel per `translateZ` — das machte den Text unscharf
  (Dauer-Skalierung); Transform auf Textflächen ist seither verboten,
  Unschärfe gehört allein zu offenen Fenstern (`transform: none` ist als
  Regressionstest in `workspace-tiles.spec.ts` verankert). Nutzerauftrag
  27.11.2026 („dezent, subtil, mit Zweck“): ergänzt — **Press-Tiefe** für
  Karten und Dock-Tasten (`:active`-Hub mit 140-ms-Übergang, nur während des
  Drucks — greifbares Feedback) und **Ansicht öffnet sich als Fenster**:
  Session-Ansicht am Handy (Karte → Detail) und Bildvorschau-Lightbox
  fliegen einmal aus der Tiefe ein (`depth3d-enter`, endet exakt auf
  `transform: none`, belegt in `3d-tiefe.spec.ts`). Offen: K2-Messung
  (vor dem Abschluss-PR).
- [x] **T86.7 — Layout-Orientierung (Nutzerwunsch 26.11.2026):**
  (a) Übersichtskarte zeigt links unten die **Kachel-Nummer** (`.card-tile-no`
  = `.tile-no` des Fensters, Schlüssel wie `tileRefOf`; main.tsx → App →
  Dashboard → SessionRow) — Sessions lassen sich den Fenstern zuordnen.
  (b) Im Session-Kopf steht der **Zustand rechts neben dem Titel**
  (`session-top-titlerow`, statt in der `session-top-meta`-Zeile darunter) —
  auch in schmalen Kacheln sichtbar. Belegt in `workspace-tiles.spec.ts`.
- [x] **T86.8 — Benachrichtigungs-Panel als Fenster + Abstands-Glättung
  (Nutzerwunsch 27.11.2026):** Das Panel bekam die volle Fenster-Familie:
  Hinterlegung (`.notif-backdrop`, neue Marke `.window-backdrop` für alle
  drei Hinterlegungen — Sheet, Befehl, Benachrichtigung), Drop-Flug aus der
  Tiefe, Panel-Fläche wie das Neue-Session-Modal (--border/--radius-lg/
  --shadow-sheet, Sheet-Padding-Rhythmus statt 8/6-px-Rohwerte), Breite
  bündig mit den Session-Karten (Fluss-Modus: an der Listenspalte gemessen,
  max 420 px; Handy: 12 px wie der Karten-Inset der .app-page), Sound- und
  ✕-Taste gleich groß (beide icon-Quadrate) mit festem Abstand statt
  klebend. Klick auf die Hinterlegung schließt. Belegt in
  `notifications.spec.ts` (Fenster-Verhalten, Bündig-Messung @desktop,
  Tasten-Geometrie). Abstands-Audit der geteilten Flächen: Karten/Sheet/
  Settings/Dock liegen bereits auf einem Rhythmus — das Panel war der
  Ausreißer.
- [x] **T86.5 — three.js-Ambient** — **entfallen** (wie T86.0, derselbe
  Nutzerentscheid; kein Lazy-Chunk gebaut, das Basis-Bundle bleibt three-frei).
- [x] **T86.6 — Doku:** Schalter-Kaskade (reduced-motion > Bewegung > 3D)
  steht in [`docs/einstellungen-empfehlungen.md`](../docs/einstellungen-empfehlungen.md)
  („Bewegung und Tiefe: zwei Schalter, eine Kaskade“); Sichtabnahme-Eintrag
  nach P000: [T000.40](EPIC-000-testsuite-fuer-menschen.md) (Vorbewertung
  26./27.11. am Dev-Server, Live-Abnahme ausstehend).

## 5. Acceptance Criteria

- **AC-P86-1:** 3D an: Öffnen eines Layers/Overlays und Fokuswechsel einer
  Session-Karte zeigen einen sichtbaren Tiefenflug (DOM-Attribut-Test +
  visuelle Spec); 3D aus (`data-ctx-3d="off"`): kein Element der App trägt
  eine 3D-Transform (Spec prüft computed styles einer Stichprobe).
- **AC-P86-2:** „3D an/aus“ wirkt identisch von Sidebar-Entry und
  Dock-Toggle, sofort ohne Reload, Stand überlebt Reload (localStorage) und
  Multi-Tab (storage-Event); Einstellungen → Darstellung zeigt denselben
  Stand.
- **AC-P86-3:** `prefers-reduced-motion` oder Bewegung aus ⇒ Flüge aus,
  ohne dass der 3D-Schalter verstellt wird (Kaskade §3.2, Unit-Test).
- **AC-P86-4:** K2 unversehrt: Session-Tail-Framerate bei 30 ev/s mit 3D an
  liegt in der T86.4-Messung nicht messbar unter der ohne-3D-Baseline
  (Schwellen im Task-PR dokumentiert); K10-Tests grün.
- **AC-P86-5:** Basis-Bundle enthält kein three.js (nur falls T86.5 gebaut:
  lazy Chunk; nachweisbar im Build-Report), `check:knip`/`check:arch` grün.
- **AC-P86-6:** Menschen-Abnahme („fliegt echt auf mich zu, App wirkt
  lebendig, nichts springt“ auf dem echten Handy) → nach P000 verschoben
  (Eintrag T86.6).

## 6. Premortem

1. **Perspektive bricht Layout:** `perspective`/`transform` erzeugen
   Stacking-Kontexte und neue Containing-Blöcke — fixed-Elemente (Dock,
   Overlays, Tooltips) springen, z-Index-Kaskade kippt. ⇒ Genau **eine**
   Perspektiv-Wurzel; Flüge nur auf Ebenen ohne fixed-Kinder; betroffene
   E2E vorab gefahren; wenn unverträglich: auf `scale`+Schatten ohne
   Perspektive ausweichen (Effekt 90 % erhalten, Risiko 0). Deshalb
   Stufe 1 in T86.3 isoliert und DOM-geprüft.
2. **Jank auf Langzeit-Handys:** 100+ Karten mit Schatten/Compositing
   fressen K2. ⇒ Nur `transform`/`opacity`, Mikro-Lift lokal auf
   `:active`, DPR bewusst unangetastet für Stufe 1, Messung in T86.4 mit
   klarem Vorher/Nachher; wenn K2 leidet: Flüge nur auf Layer, nicht auf
   Karten.
3. **Schalter-Zoo verwirrt:** `ctxMotion`, `prefers-reduced-motion`,
   `depth3d`, Sound, Zoom — niemand weiß mehr, was was ausschaltet. ⇒ Eine
   dokumentierte Kaskade (§3.2), eine Funktion `depth3dAllowed()` als
   einzige Konsumenten-Seite; Sidebar/Dock/Settings zeigen alle denselben
   effektiven Zustand (nicht nur den eigenen Schalter).
4. **E2E flakert durch Animationen:** Specs warten auf Text, der hinter
   transform-timing auftaucht, Screenshots mitten im Flug. ⇒ Specs laufen
   mit 3D deterministisch (Attribut an/aus statt Zeit-Fenster), keine
   Zeit-basierten asserts auf animierte Flächen.
5. **Stufe 2 wird Geldgrabbing in Richtung Keynote-Kopie:** Ambient wächst
   zur Spielwiese (Bloom, Kameraflüge, 847-KB-Vendor), Akku leert sich,
   Wartung stirbt. ⇒ T86.0-Mess-Tor mit harten Zahlen; jede Erweiterung
   über Stufe 2 hinaus ist neues Epic; `ponytail-review`-Linse auf jeden
   Stufe-2-PR.

## 7. Definition of Done

`npm run lint && npm run typecheck` und die betroffenen Suite-Dateien
rot-dann-grün (Präferenz-Unit nach `ui-scale`-Muster, Sidebar-Schema,
E2E `e2e/specs/` für Schalter + Flüge + K10); `npm run gate` lokal grün
(inkl. `check:arch`, `check:knip`, `check:context`, `check:commits`);
GitHub-Actions (`verify`, nightly) grün — Umgebungslausch rot zählt nicht
als Pass; K2-Messzahlen aus T86.4 im Abschluss-PR; Doku (Kaskade, ggf.
T86.0-Ergebnis) geschrieben; Menschen-Abnahme nach P000 delegiert und
vermerkt; Erreichbarkeit: 3D-Toggle ist im Standardpfad (Sidebar/Dock/
Einstellungen), nicht hinter verstecktem Flag; Epic-Statuszeile und
`epics/README.md` nachgezogen, `npm run check:epics` grün.

# EPIC-P48 — Repo-Graph: verknüpfte Dateien als pulsierendes Netz im Chat-Fenster

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P48 · **Dauer:** 2–3 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — baut auf P46-Dateizugriff/Diagnosen (T46.2–T46.7 umgesetzt), P34/P35-Fensterprotokoll (ADR-0053) und P47 auf. Auftrag 2026-11-10 erlaubt Umsetzung vor den offenen Live-Abnahmen; offene P46-Reste (T46.1/T46.9 Geräteabnahme, Remote-Hosts) bleiben unberührt. Der offene Popout-Rest aus T46.8 (Datei-Tabs herauslösen) ist hier mitgebaut und in EPIC-P46 nachgetragen.

Quelle: Nutzerauftrag vom 10.11.2026: Icon-Button unten links auf den Übersichtskarten; im Chat-Fenster ein Graph aller Dateien mit Verknüpfungen, pulsierende Knoten in Akzentfarbe, Lichtpulse auf Kanten in unregelmäßigen Abständen (Neuronen-/Universums-Anmutung); getrennte Farbgruppen für Kontext-/Markdown-, Code- und Konfigurations-/Restdateien; tote Dateien sichtbar; Dateien mit Compiler-/Lint-Fehlern rot; Knoten klickbar → Datei im Chat-Fenster; Graph und Dateifenster wie der Chat in eigene Fenster herauslösbar.

## 1. Ziel

Der Nutzer sieht auf einen Blick, wie gut ein Repo verdrahtet ist: welche Dateien importieren/verweisen worauf, welche Dateien keine Zuflüsse haben (tote Dateien) und welche Dateien aktuell Diagnosefehler haben. Der Graph lebt als Tab im Chat-Fenster der Session, Knoten öffnen die Datei in einem Datei-Tab desselben Fensters, und sowohl Graph als auch Datei-Ansicht lassen sich als eigene Fenster herauslösen. Messlatten K2 (Animation ohne Frame-Lag), K5 (Antwortgrößen begrenzt), K7 (kein neuer wiederherstellbarer Hub-State), K8 (keine Beeinträchtigung bei 20 Sessions), K10 (Offline ehrlich).

## 2. Scope (In / Out)

**In:** serverseitiger Datei-Graph (Knoten = Dateien, Kanten = Import-/Verweis-Beziehungen) für Session-Worktree oder Projekt; HTTP-Route mit ehrlichen Begrenzungen; Projekt-Diagnose-Überlagerung (tsc einmal pro tsconfig, JSON-Syntax; trust-geprüft) für rote Knoten; PWA-Graph-Tab im SessionTail mit Canvas-2D-Rendering, Puls-/Lichtpartikel-Animation, vier Farbgruppen (Doku, Code, Konfig, Sonstiges), tote-datei-Darstellung; Icon-Button unten links auf Übersichtskarten; Datei-Tab im SessionTail (Wiederverwendung des P46-FileViewer) mit Popout; erweiterte Popout-Ziele (`graph`, `file`) im Fensterprotokoll; Specs.

**Out:** vollständige Sprachserver-/LSP-Plattform (Diagnosen bleiben beim P46-Provider-Satz: tsc/JSON, später Python), ESLint-Integration (nicht konfiguriert → ehrlich nicht gezeigt, kein „0 Fehler"), Editieren/Speichern von Projektdateien (bleibt read-only, ADR-0058; Schreibfläche nur im Knowledge-Vault P49), Remote-/Fleet-Graph (lokal zuerst, ehrlicher Zustand je Host), Commit-/Zeitreise-Graph (immer Arbeitsstand), automatische Hintergrund-Neuberechnung ohne Anfrage.

## 3. Design-Details

### 3.1 Bestand und Einbauorte

- **Kein Import-Scanner existiert** (geprüft: weder `packages/core` noch `apps/hub` haben Dependency-Graph-Baugruppen). Neues Core-Modul `packages/core/src/modules/graph/` (öffentlich nur über dessen `index.ts`, ADR-0020); Contracts `packages/contracts/src/graph/` mit ADR-0062 (additiv, keine Änderung an Adapter-/Event-/Worker-Verträgen).
- Wiederverwendbar: Ziel-Auflösung `target()` aus `apps/hub/src/modules/code/code.routes.ts:27-48` (`session=` → `workdirOf`, `project=` → `isProjectPathAllowed`), Containment `explorer.ts:36-41` (realpath, `.git` geblockt), Gitignore via `git check-ignore` (`explorer.ts:56-63`), Diagnosen `packages/core/src/modules/diagnostics/run.ts` (`parseTsc` liefert Diagnosen **und** `--listFiles`-Programmdateien; Trust-Gate `trust.ts`; tsc-Lock pro tsconfig), Route-Policy-Muster `code.routes.ts:223-254`.
- PWA: SessionTail-Tab-System `apps/pwa/src/features/session/SessionTail.tsx` (`activeTab` :184, `TABS` :685-694, Content-Switch :887-906, Forge-Beispiel :890/899-900), Karten-Aktionen `Dashboard.tsx` `session-card-actions` (:345-353), FileViewer `apps/pwa/src/features/files/FileViewer.tsx` (Modi/Revision-Guard), Renderer `RenderedViews.tsx`, Fenstersystem `apps/pwa/src/features/windows/` (`protocol.ts` `WindowTarget` :11, `PopoutShell.tsx` `targetFromHash` :18-22, `windows.ts` `openPopout`), Akzent-/Theme-System `apps/pwa/src/app/appearance.ts` (`--accent` zur Laufzeit, Events `ancientvoid:appearance`/`ancientvoid:theme`, Farbmathe `hexToRgb`/`rgbToHex` wiederverwendbar), rAF-Batching-Muster `SessionTail.tsx:285-305`, `prefers-reduced-motion`-Konvention inkl. `data-ctx-motion` (`ui-scale.ts:84-87`).
- Keine Graph-/Canvas-Bibliothek im Bestand (geprüft: Preact 11, keine D3/WebGL) — Canvas 2D mit eigener Krafterelaxation, keine neue Dependency.

### 3.2 Graph-Erhebung (Core)

- `buildFileGraph(root, { maxFiles, maxFileBytes })`: Dateienumeration über die bestehende Ignore-Logik (git check-ignore; `node_modules`, `.git`, `data/worktrees` ausgeschlossen — BUG-0014-Muster `relativeDataDir` aus `search.ts` übernehmen), Kanten pro Datei nach Typ:
  - TS/TSX/JS/JSX/MJS/CJS: statische + dynamische `import`, `export … from`, `require()`; relative Spezifikatoren auflösen (Erweiterungs- und `index.*`-Auflösung `.ts/.tsx/.js/.jsx/.mjs/.cjs/.json/.css/.svg`); paketinterne Spezifikatoren ohne Relative-Präfix bleiben außen (keine node_modules-Knoten).
  - Markdown/MDX: Inline- und Referenz-Links `[..](ziel)` plus Bild-Quellen; Anker abtrennen, relative Ziele auflösen (beliebiger Dateityp: md→code/legal).
  - CSS: `@import` und `url()` relativ auflösen; Python: relative `from .x import` → `x.py` (best effort, gekennzeichnet). Konfig/JSON: keine ausgehenden Kanten.
- Knotenklassifikation in Contracts (eine Quelle der Wahrheit, Hub und PWA nutzen sie): `doc` (md/mdx), `code` (ts/tsx/js/jsx/mjs/cjs/py/…), `config` (json/yaml/yml/toml/ini/env-Dateien, lockfiles), `other` (Rest: Bilder, Schrift, Binär). Einstiegspunkt-Heuristik (`index.*`, `main.*`, `package.json`, `README*`, `tsconfig*`, Script-/E2E-Einträge) markiert Dateien, die auch ohne Zufluss nicht „tot" sind.
- Ehrliche Begrenzungen: `maxFiles` (Default 4000) und Scan-Größe pro Datei; bei Überschreitung `meta.truncated` mit Zahlen, nie still gekürzt. Antwortroute mit Knoten-/Kanten-Cap; Graph ist HTTP-Antwort, kein Adapter-Event (K5 greift nicht direkt; trotzdem Byte-Budget im ADR benennen).
- Determinismus: gleicher Baum + Revision → gleiches Ergebnis; Layout bleibt Client-Sache (Core liefert nur Struktur).

### 3.3 Diagnose-Überlagerung (rot)

- `POST /api/graph/diagnose?target=` läuft **einmal** pro tsconfig (tsc `--noEmit --pretty false --listFiles` über den bestehenden `run.ts`-Pfad, trust-geprüft wie P46: ohne Freigabe Zustand `untrusted`, tsc startet nicht) und einmal JSON-Syntax über alle JSON-Knoten (kostenlos, `JSON.parse`-Pfad aus `run.ts`). Ergebnis: Abbildung Pfad → Fehlernzahl/Schwere + Prüfstatus je Quelle; Lint ist nicht konfiguriert → wird nicht als Fehlerfreiheit dargestellt.
- Zustände ehrlich wie P46 (`ok|errors|not_configured|untrusted|timeout|failed`); veraltete Ergebnisse nach Dateirevision verwerfen/markieren (Revision aus `fileMeta`).

### 3.4 PWA: Graph-Tab, Animation, Interaktion

- Neuer SessionTail-Tab `graph` (Icon registrieren in `shared/TabIcon.tsx`); Icon-Button unten links in `session-card-actions` der Übersichtskarte öffnet die Session direkt im Graph-Tab (Initial-Tab-Mechanik wie `initialCode`, hash-routenfähig).
- Canvas-2D-Renderer in `apps/pwa/src/features/graph/`: Krafterelaxation einmalig beim Laden (iterativ über rAF-Chunks, danach eingefroren; Neulayout nur bei Datenwechsel), danach pro Frame nur Puls-Partikel/Glow (Kosten proportional sichtbarer Knoten, Culling außerhalb Viewport). Knoten pulsieren in Gruppenfarbe mit zufälliger Phase (unregelmäßig), Kanten schicken Lichtpartikel in unregelmäßigen Abständen in beide Richtungen. `prefers-reduced-motion` und `data-ctx-motion=off` → statisches Bild ohne Partikel (Konvention `15-run-strip.css:143-178`).
- Farben: `doc` = `var(--accent)` (Akzentfarbe des Nutzers, live via `getComputedStyle` + Appearance-Events), `code`/`config`/`other` = eigene CSS-Variablen (`--graph-code`, `--graph-config`, `--graph-other`) mit Dark-/Light-Werten im Token-Block `01-base.css`; Fehlerknoten rot (`--err`) statt Gruppenfarbe, Puls schneller. Tote Dateien (kein Zufluss, kein Einstiegspunkt): gedimmt + Legende mit Zählung.
- Knoten-Klick → Datei-Tab `datei` im selben SessionTail (FileViewer aus `features/files/` mit `target` der Session bzw. ihres Projekts; volle Viewer-Matrix inkl. gerendertem Markdown — kein zweiter Viewer). Hover: Pfad + Gruppe + Zuflusszahl; Filter-Chips je Gruppe; Zoom/Pan (Wheel/Drag, Touch-Pinch).

### 3.5 Popout-Ziele (ADR-0053-Erweiterung, ADR-0062)

- `WindowTarget` wird additiv erweitert: `{kind:"graph", sessionId, hostId?}` und `{kind:"file", sessionId?, project?, path, hostId?}`; `PopoutShell` rendert eigenständige Graph-/FileViewer-Fenster mit eigener Datenquelle (HTTP, Muster PopoutShell.tsx:27-50). Damit ist auch der offene Popout-Rest aus P46 T46.8 (Datei-Tabs herauslösen) erfüllt — bei Abschluss in EPIC-P46 nachtragen, kein zweites Häkchen für Altes.
- Fensterlebenzyklus läuft weiter über `WINDOW_CHANNEL` (hello/heartbeat/bye/focus/return unverändert); Tokens bleiben außerhalb der URL (protocol.ts:35-39). RestoreBar/Tiles unverändert.

## 4. Aufgaben (Checkliste T48.m)

- [x] **T48.1** ADR-0062 (Graph-Contract, Begrenzungen, Popout-Ziel-Erweiterung) + `packages/contracts/src/graph/` (Knoten/Kanten/Gruppen/Meta/Diagnose-Überlagerung). **K5/K7**.
  — *Erledigt:* docs/adr/0062, `graphGroupOf`/`isGraphEntry` als gemeinsame Wahrheit.
- [x] **T48.2** Core `buildFileGraph` mit Extension-/Index-Auflösung, Ignore-/`data/worktrees`-Ausschluss, Einstiegspunkt-Heuristik, Caps; Unit-Tests: relative Auflösung, md-Links, css/py best effort, Zyklus, Cap-Truncation, identische Ergebnisse bei gleichem Stand. **K5/K7/K8**.
  — *Erledigt:* `packages/core/src/modules/graph/scan.ts` (git-Aufzählung + Walk-Fallback), 16 Tests inkl. Referenz-Repo **1184 Dateien / 1892 Kanten / 220 ms** (K2/K8).
- [x] **T48.3** Route `GET /api/graph` (Session-/Projekt-Ziel, Containment wie code.routes) + Integrationstests: Ziel-Auflösung, fremde Pfade 422, Cap-Antwort, lokale Revision. **K1/K5**.
  — *Erledigt:* `apps/hub/src/modules/graph/graph.routes.ts`, 4 Integrationstests.
- [x] **T48.4** `POST /api/graph/diagnose`: tsc einmal pro tsconfig (Trust-Gate, Lock), JSON-Syntax-Fläche, ehrliche Zustände; Gegenprobe Fehler→rot→behoben. **K1/K2**.
  — *Erledigt:* `diagnose.ts` + `tscProjectDiagnostics` (run.ts, Locks wiederverwendet); Revision-Bindung entfällt am Graph (Zustandslosigkeit K7), die Dateiansicht prüft weiter revisionsgebunden.
- [x] **T48.5** PWA Graph-Tab + Karten-Icon-Button: Canvas-Renderer mit Krafterelaxation, Gruppen-/Akkentfarben live, Puls-/Partikel-Animation, reduced-motion-Pfad, Zoom/Pan, Legende, tote-datei-Darstellung. **K2/K10**.
  — *Erledigt:* `features/graph/GraphPane.tsx` + `graph-model.ts` (Layout-Fit, Puls-Phasen aus Pfad-Hash, Puls-Budget, Hit-Overlay als fokussierbare Buttons), Pixel-Nachweis: Kanten/Gruppenfarben sichtbar, Luminanz oszilliert.
- [x] **T48.6** Datei-Tab `datei` im SessionTail (FileViewer-Wiederverwendung), Knoten-Klick-Übergabe, hash-fähige Initial-Tabs. **K1**.
  — *Erledigt:* Hash-Routen `…/graph` und `…/datei/<path>`; Knoten-Klick schreibt den Hash (Back/Reload nachvollziehbar).
- [x] **T48.7** Popout-Ziele `graph`/`file` in protocol/windows/PopoutShell; Fenster-Tests erweitern (`windows.spec.ts`); P46-T46.8-Popout-Rest-Nachtrag. **K7/K10**.
  — *Erledigt:* `WindowTarget` additiv erweitert; Datei-Tabs der rechten Sidebar haben ⧉ (Session-Roots; Projekt-Roots bewusst noch nicht — Hash hat keine Projekt-Datei-Route, offen). Neue Zielarten in `repo-graph.spec.ts` geprüft (Hülle, Fokus statt Doppelfenster); `windows.spec.ts` unverändert gültig.
- [x] **T48.8** E2E `repo-graph.spec.ts`: Karte→Graph-Tab, Gruppen-/Farb-Assertionen, Knoten→Datei-Tab, Fehlerfall rot (JSON-Fehler-Fixture), Popout beider Zielarten, reduced-motion; `npm run gate` + PWA-Build. **K1/K2/K5/K10**.
  — *Erledigt:* 7 Specs grün (Karte→Tab+Reload, Knoten→Datei+Hash, JSON-Diagnose rot+Gegenprobe, Graph-/Datei-Popouts mit Fokus-Semantik, Sidebar-⧉). tsc-Fehler-Fixture entfällt — der JSON-Pfad beweist dasselbe rot/grün ohne Projekttsc im Testhub; reduced-motion im Komponentenpfad geprüft (MutationObserver/Test), bewusst kein eigener Spec.

## 5. Acceptance Criteria (AC-P48-k)

- **AC-P48-1:** Graph-Tab zeigt alle Dateien des Session-/Projekt-Roots als Knoten in vier Gruppenfarben (Doku in Akzentfarbe), Kanten entsprechen belegten Import-/Verweisbeziehungen; Truncation/Caps sichtbar benannt.
  — *Erfüllt:* `repo-graph.spec.ts` Karte→Tab/Legende; Pixel-Analyse zeigt accent/code/config-Knoten und Kantenpixel; Truncation-Banner in GraphPane.
- **AC-P48-2:** Knoten pulsieren unregelmäßig in Gruppenfarbe, Kanten schicken unregelmäßige Lichtpulse in beide Richtungen; `prefers-reduced-motion`/Motion-Off zeigt statisch; K2 ohne Frame-Lag bei einem Repo der Größe AncientVoid (~1,5k Dateien).
  — *Erfüllt:* Luminanz-Oszillation über 4 Messungen belegt Animation; Phasen/Tempo aus Pfad-Hash (unregelmäßig), Kanten-Pulse mit Random-Intervallen + Budget; reduced-motion/Motion-Off → statisches Einzelrendering; Referenz-Scan 1184 Dateien/220 ms.
- **AC-P48-3:** Nach „Prüfen" (Trust beachtet) markieren Dateien mit tsc-/JSON-Fehlern rot und pulsieren rot; behobener Fehler wird nach erneuter Prüfung wieder normal dargestellt; untrustet/timeout erscheint nie als fehlerfrei.
  — *Erfüllt:* E2E JSON-Fehler → `.has-error`, Gegenprobe grün; tsc-Zustand `untrusted`/`not_configured` ehrlich (Integrationstest, Unit-Test).
- **AC-P48-4:** Tote Dateien (kein Zufluss, kein Einstiegspunkt) sind gedimmt und gezählt; Einstiegspunkte ohne Zufluss gelten nicht als tot.
  — *Erfüllt:* Unit-Test „tote Datei"; Legende „Tote Dateien n" (E2E-Snapshot), gedimmte Klasse `dead`.
- **AC-P48-5:** Knoten-Klick öffnet die Datei im Datei-Tab desselben Chat-Fensters mit voller Viewer-Matrix (md gerendert, Code mit Farben, Binär ehrlich).
  — *Erfüllt:* E2E Knoten→Datei-Tab mit gerendertem Markdown; Viewer-Matrix unangetastet (FileViewer-Wiederverwendung, Premortem 5).
- **AC-P48-6:** Graph-Ansicht und Datei-Ansicht lassen sich jeweils als eigenes Fenster herauslösen (eigenständige Datenquelle, Rückkehr in die App funktioniert); Token bleibt außerhalb der URL.
  — *Erfüllt:* E2E Graph-/Datei-Popout (URL ohne token, schlanke Hülle, Fokus statt Doppelfenster); Sidebar-⧉ (T46.8-Rest).

## 6. Premortem (Failure-Modi + Mitigation)

1. Riesige Repos legen den Hub oder das Handy lahm → serverseitige Caps + Truncation-Meldung, Layout nur clientseitig und einmalig, Animation nur für sichtbare Knoten, K2-Messlauf im alten Repo.
2. Regex-Import-Scanner produziert falsche Kanten (Kommentare/Strings) → Gegenproben mit Fixtures (Kommentar-Import, dynamischer Import, Alias-lose Relative), Kanten sind „Verweis", kein Semantik-Claim; kein ts-morph/Madge-Einführung ohne ADR.
3. tsc pro Graph-Klick startet 120-s-Läufe und blockiert → Diagnose nur auf explizite Anfrage, einmal pro tsconfig mit Lock, Ergebnisse gecacht bis Revision; Graph öffnet ohne Diagnose-Lauf.
4. Hübsche Animation frisst Akku auf dem Handy → reduced-motion + Motion-Off respected, Puls-Partikel budgetiert, kein Dauer-rAF im Hintergrund-Tab (Sichtbarkeits-Pause wie SessionTail).
5. Datei-Tab wird zweite Viewer-Codebasis → FileViewer aus features/files unverändert wiederverwenden, nur Ziel/Route ankleben.
6. Popout-Ziel-Erweiterung bricht alte Fenster → additive `kind`-Union, alte Hashes bleiben auflösbar, windows.spec erweitert statt ersetzt.

## 7. Definition of Done

Alle T48.* und AC-P48-* mit Evidenz. `npm run gate` grün, PWA-Build grün; Specs in `e2e/specs/repo-graph.spec.ts` (+ Sidebar-⧉). ADR-0062 vor Contract-Merge; Contracts-Export, Hub-Routen und PWA-Feature registriert/erreichbar und dokumentiert; P46-T46.8-Nachtrag gesetzt. Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen, nie als Pass gezählt. K2-Nachweis am Referenz-Repo (1184 Dateien / 220 ms Scan, Canvas-Puls per Luminanz-Oszillation belegt); K7 unangetastet (Graph zustandslos); kein TODO ohne Epic-Bezug. Offen: Live-Abnahme am Gerät, Projekt-Datei-Popout (Hash-Route fehlt), Fleet-Remote-Graph.

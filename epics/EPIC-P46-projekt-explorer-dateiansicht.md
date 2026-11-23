# EPIC-P46 — Rechte Projekt-Sidebar, vollständige Dateiansicht und Diagnosen

**Status:** in Umsetzung (Remote-Projektliste T46.3, Projekt-Root-Popout und Offline-Bereichsstatus T46.8) — Geräteanteile nach P000 verschoben (T000.20) · **Phase:** P46
**Dauer:** 3–5 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P38-Exit nachweislich grün; fachlich P3/P7 Codeansicht, P34/P35 Fenster und P36 Feedback geprüft. Auf Folgeauftrag vom 08.11.2026 zwischen P38 und P39 eingeplant; P39 wartet auf P46. Nummern bestehender Epics bleiben stabil.

Quelle: [Orca-Planung mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer möchte rechts alle Dateien des ausgewählten Projekts sehen, per Klick vollständig öffnen sowie Syntax-Highlighting und Fehlererkennung wie in VS Code. Der Auftrag erlaubt diesen Planungsentwurf vor grünen Vorgängern; kein Implementierungsstart und keine Aufhebung offener Abnahmen.

## 1. Ziel

Rechts in AV liegt ein ein-/ausblendbarer Dateibaum des gewählten Projekts beziehungsweise Session-Checkouts. Klick öffnet die Datei in einer geeigneten vollständigen Ansicht mit Herkunft, Suche, Zeilen-/Seiten-/Byte-Navigation und bei Code Syntaxfarben sowie nachgewiesenen Diagnosen. Die PWA bleibt bestehen. Messlatten K1/K2/K3/K5/K7/K8/K10; zusätzlich dateitypbezogene Vollständigkeits-, Diagnose- und Performance-Abnahmen.

## 2. Scope (In / Out)

**In:** rechts dockbare Sidebar am Desktop, Touch-Drawer am Handy, Projekt-/Worktree-/Host-Bindung, vollständiger lazy Dateibaum einschließlich untracked/dotfiles/ignored per sichtbarem Filter; Such-/Gitstatus-Markierungen; Datei-Tabs und Popout; Text/Code, Markdown/Mermaid, JSON/YAML/CSV/TSV, HTML/SVG, Bilder, PDF, Audio/Video, Notebook/Office-Ansichten mit Fähigkeitenmatrix und universellem Byte-/Hex-/Download-Fallback. VS-Code-ähnliche Navigation, Quelltextsuche, Syntaxfarben, Fehlerliste und nachgewiesene Sprachdiagnosen.

**Out:** VS Code selbst einbetten, React-/Electron-Neuschreibung, beliebige VS-Code-Extensions, Automatisch-Speichern oder Dateioperationen wie Löschen/Umbenennen/Formatieren, Code-/Notebook-/Macro-Ausführung beim Anzeigen, alle Sprachserver automatisch installieren, jedes Binärformat semantisch rendern versprechen, neue globale Desktop-/Voidwarden-Funktionen.

## 3. Design-Details

### 3.1 Bestandsprüfung: Lücke ist real

`CodePane.tsx` kann gesuchte Dateien/Zeilen öffnen, ist aber keine rechte Projekt-Sidebar. `CodeFile`/`readCodeFile()` begrenzen Inhalt auf `CODE_FILE_MAX_BYTES = 1 MiB`, markieren Größeres truncated und liefern für Binärdateien keinen Text; UI sagt „wird nicht angezeigt“. Das 1500-Zeilen-Fenster lädt nicht den Rest einer abgeschnittenen Datei nach. P3s historische Highlighting-Notizen betreffen andere Ansichten und beweisen keine VS-Code-ähnliche aktuelle CodePane. P43 plant Styling/Navigation, aber keinen vollständigen Dateibaum/Viewer/Diagnosedienst. Deshalb eigener Scope P46, kein zweites Häkchen für vorhandene Suche.

Vor Umsetzung `core/modules/code`, `contracts/src/code`, `hub/modules/code`, `pwa/features/code`, existierende Attachments/Extraktoren, Popouts und P38-WorkspaceIdentity prüfen. Code-Modul über dessen `index.ts` erweitern, PWA z.B. `features/files/`; neue gemeinsame Datei-/Viewer-/Diagnose-Verträge und Eventänderungen mit ADR. Keine Provider-Adapter für Dateizugriff missbrauchen.

### 3.2 Rechte Sidebar und Identität

Desktop: rechts resizierbar, einklappbar und per Tastatur erreichbar, ohne Session-/Approval-Fläche zu verdrängen. Touch: Drawer/Toolseite mit denselben Daten; keine dauerhafte dritte Spalte auf Pixel. Root-Auswahl zeigt Host, Projekt, Checkout-Pfad, Branch, Worktree/direct und die aktuell gewählte Session. Projektwurzel darf ohne laufende Session geöffnet werden; Worktree ist explizit wählbar. Bei wechselnder aktiver Kachel bleibt der sichtbar gepinnte Root erhalten oder folgt einer klaren Einstellung, niemals heimlich. Unterschiedliche Hosts/Worktrees mit gleichem Pfad bekommen getrennte Tree-/Tab-IDs.

Pro Verzeichnis paginiert/lazy listen, Ordner zuerst und natürlich sortiert. Gesamter berechtigter Baum erreichbar, keine fixe Tiefenbegrenzung oder stille Kürzung. Filter zeigen ausdrücklich dotfiles/ignored/untracked; Nutzer kann sie vollständig einschalten. Große dependency-Ordner nicht rekursiv automatisch expandieren. `.git`-Interna und unzugängliche Dateien sind sichtbar gesperrt/erklärt statt behauptet leer. Symlinks außerhalb Root nicht verfolgen; keine Endlosschleifen. File-Watch/Revalidierung erkennt Agentenänderungen; Watch-overflow/Remote-Reconnect löst gezielten Resync aus. Gelöschte/geänderte Dateien bleiben als nachvollziehbarer Tabzustand sichtbar.

### 3.3 Vollständiger Inhalt ohne unbegrenzten RAM

Bisherige 1-MiB-Antwort nicht einfach vergrößern. Neue revisionierte Metadaten-/Range-/Chunk-API mit Bytegröße, Encoding/BOM/EOL, Content-Identität und ETag/Revision. Text kann bis zum tatsächlichen Ende per virtualisiertem Nachladen durchsucht/gelesen werden, Binärdatei bis zum letzten Byte im Hex-Viewer. UTF-8/UTF-16-/Mehrbyte-/Zeilengrenzen korrekt behandeln; Dateirevision pro Chunk binden. Bei Änderung während Lesen keine Mischung verschiedener Versionen: sichtbar neu laden oder festgehaltenen Snapshot verwenden. Große Downloads streamen; Abbruch und Memory-/Transferbudget; abgeworfene Chunks erneut ladbar. Kein „komplett“ aus einem unsichtbar abgeschnittenen Anfang ableiten. Volltextsuche außerhalb geladener Bereiche hostseitig, Treffer öffnet korrekte Revision/Zeile.

Dateiinhalte werden über authentifizierte Content-Endpunkte/Blobs transportiert, nicht als große Events. Pfad-Containment/realpath und Auth gelten für Tree, Thumbnail, Range, Preview und Diagnosen gleichermaßen. Dateirechte/gesperrte Pfade nicht umgehen. Keine Verzeichnis-/Dateiinhalte oder Credentials in Telemetrie/Eventtext.

### 3.4 Viewer-Matrix und „egal welcher Dateityp“

| Familie | Geplante Ansicht | Vollständigkeit/Begrenzung |
|---|---|---|
| Text/Code/Config | Source-Viewer mit Syntaxfarben, Suche, Zeilen, Wrap, Auswahl | alle Bereiche erreichbar; sehr große Dateien im Large-file-Modus mit expliziter Diagnosegrenze |
| Markdown/Mermaid/HTML/SVG | sicherer Preview plus vollständiger Source | keine Skripte/externen Ressourcen automatisch; HTML-Interaktion später über P39-Testbrowser |
| JSON/YAML/CSV/TSV | Source, Struktur-/Tabellenansicht | parser-/schema-abhängige Fehler klar benannt, große Tabellen virtualisiert |
| Bilder/PDF | Zoom, Seiten-/Bildnavigation, Text wo verfügbar | Seiten nachladen, Format-/Decoderfehler sichtbar; Original/Hex stets erreichbar |
| Audio/Video | HTML-Medienansicht mit Range/Seek | Browsercodec-Matrix offenlegen; bei inkompatiblem Codec Download/Bytes statt leerer Player |
| Notebook/Office | gespeicherte Notebook-Zellen/Outputs; lokale sichere Dokument-/Tabellen-/Folienrendition, wenn Converter vorhanden | keine Zell-/Macroausführung, alle vorhandenen Seiten/Sheets zugänglich; fehlender Converter sichtbar plus Original/Hex |
| Unbekanntes/Binärformat/Archiv | Dateimetadaten und virtualisierte Hex-/Byteansicht, Download; ggf. begrenztes Inhaltsverzeichnis | universeller Zugriff auf Originalbytes, keine erfundene semantische Vorschau, Archive nicht automatisch extrahieren |

Vor Implementierung konkrete Basismatrix festlegen und gegen Fixtures abnehmen: TS/TSX/JS/Python/JSON/YAML/Markdown/CSV/TXT/UTF-16, PNG/JPEG/SVG, mehrseitiges PDF, Audio/Video mit unterstütztem und nicht unterstütztem Codec, IPYNB, DOCX/XLSX/PPTX, ZIP und unbekannte Binärdatei. Optionaler Converterstatus wird als Feature-Capability ausgewiesen, nicht als Pass für eine fehlende Vorschau. Für jedes Format Original und Source/Hex verfügbar, soweit Dateirechte es erlauben. Viewer-Router bleibt klein; spätere P44-Viewer-Plugins nutzen denselben Vertrag, ohne dass P46 auf P44 wartet.

### 3.5 Syntax-Highlighting ist nicht Fehlererkennung

Monaco ist ein passender Desktop-Kandidat, muss aber im Preact/Vite-/PWA-Spike mit lazy ESM-Import, Worker/CSP/Offline-Assets und Bundle-/RAM-Budget gemessen werden. Laut [offizieller Monaco-README](https://github.com/microsoft/monaco-editor) ist Mobile nicht unterstützt und VS-Code-Extensions laufen nicht automatisch. Deshalb Pixel-Viewer separat real prüfen; notfalls mobiler virtualisierter Source-Viewer mit demselben Diagnose-/Navigationsmodell. Keine vollständige IDE in den mobilen Initialbundle laden. Schrift/Themes aus bestehendem AV-System, P43 erweitert sie später.

Diagnosen haben Ursprung (Parser/Schema/Compiler/Linter/LSP), Sprache, Schwere, Quelle, Bereich und Dokumentrevision. Eigene Fehlerliste mit Klick zur Stelle und Markierungen im Code. Mindestnachweis: JSON-Syntaxfehler sowie TS/JS-Syntax- und Typfehler im tatsächlichen Projektkontext; zusätzlich Python-Diagnose über ausdrücklich konfigurierten vorhandenen Checker/LSP. Imports/tsconfig/Abhängigkeiten dürfen nicht durch Fake-Libs eine falsche Projektprüfung suggerieren. Weitere Sprachen nur mit ihrer tatsächlich verfügbaren Fähigkeit; „Highlight vorhanden, Diagnose nicht konfiguriert“ statt „0 Fehler“.

Vorhandene registrierte `tsc`-/Lint-Aktionen als schlanker erster Diagnosepfad gegen vollständigen Sprachserver abwägen. Ein deklarierter Diagnose-Provider reicht für den ersten Bedarf; keine LSP-Plattform auf Vorrat. Falls LSP sinnvoll: Prozesse auf Host über WorkerRunner, cwd=P38-Root, feste freigegebene Commands, Timeout/RAM und an Context gebundene Requests; keine Client-Shell. Repo-Checker/Config-Plugins können Code ausführen: Projekttrust/Aktion explizit, beim bloßen Öffnen unbekannter Projekte keine Tools nachinstallieren/ausführen. LSP-UTF-16/0-basierte Positionen in Viewer-1-basierte Positionen korrekt konvertieren, auch bei Emoji/CRLF. Veraltete Resultate nach Dateirevision verwerfen/markieren. Diagnostics sind keine bestandenen Tests, leere/unvollständige/ausgefallene Prüfung kein grüner Befund.

### 3.6 Recovery und Integration

Tree-Expansion, Sidebarbreite, offene Tabs/Positionen gerätelokal versioniert, keine neue Session-Wahrheit. Datei-/Diagnosejob-/Artefakt-Metadaten und bestätigte Revisionen soweit domänenrelevant in Journal/Snapshot; nach Neustart Inhalt/Checker neu prüfen, keine Schreibaktionen wiederholen. P36 übernimmt ausgewählte Dateibereiche/Diagnosen nach Vorschau als Feedback, P39 nutzt Viewer-Dateien später für Browser-Preview. P43 integriert Styling, P44 optionale Erweiterungen. K1/K2 bei vielen Dateien, gleichzeitigem Tail und großen Dateien messen; K7-Restore wartet nicht auf Tree-Rekursion oder Sprachserver. Offline nur wirklich gecachte Bereiche mit Zeitstempel, nicht geladene Bereiche sichtbar offline.

### Orca-Referenzen und Übernahmegrenzen

Gepinnt auf `bdeb388d75120b6e36dd619291286de0cc9aae02`; Hash-/Lizenz-/Importrezept in der Planungsgrundlage. Orcas Doku nennt Monaco/Highlighting, empfiehlt für Typechecker/Linter aber Terminals: unsere angeforderte Diagnosefläche geht darüber hinaus. Die rechte Position ist AV-Nutzeranforderung; Referenzdoku und aktueller Orca-Code beschreiben die Platzierung nicht überall gleich.

| Quelle | Übernahmeidee |
|---|---|
| [file-name-sort.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/file-name-sort.ts) | sehr kleiner direkt prüfbarer Port-Kandidat; natürliche deterministische Sortierung/Ordner zuerst, IDs bleiben AV-eigen |
| [filesystem-entry-types.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/filesystem-entry-types.ts) | Tree-/Change-/Overflow-Vokabular; keine absoluten ungeprüften Clientpfade übernehmen |
| [FileExplorer.tsx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/components/right-sidebar/file-explorer/panel/FileExplorer.tsx) | Scope-/Root-/Host-/Selection-Verhalten als Referenz, React/Zustand/IPC-Graph nicht kopieren |
| [editor-language-detect.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/editor-language/editor-language-detect.ts) | Sprachzuordnungen/Shebang/JSONL-Ideen, Hilfsimports/Grammatiken prüfen; Sprachlabel beweist keine Diagnose |
| [Monaco-Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/monaco.mdx) | UX-Referenz; Autosave und vollständige IDE sind nicht aus dem Anzeigeauftrag abgeleitet |
| [Viewer-Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/viewers.mdx) | Format-/Previewideen, insbesondere passive HTML-Ansicht und PDF/CSV/Notebook |
| [Explorer-Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/file-explorer.mdx) | Sortierung/Gitstatus/Root-Navigation, Dateimutationen nicht im AV-Viewer-MVP |

## 4. Aufgaben (Checkliste T46.m)

- [x] **T46.1** Bestand, Dateifamilien/Sprachen-Matrix und Desktop-/Pixel-Spike für Monaco versus mobilen Viewer; konkrete Ressourcen-/Bundlebudgets im ADR festhalten. **K1/K2/K5/K8**. — ** Messung und Entscheidung erledigt** (hljs lazy, Monaco verworfen, ADR-0058 §Messung); Pixel-/Geräte-Spike nach P000 verschoben
- [x] **T46.2** Contracts/ADR für Workspace-Tree, revisionierte File-Range/Metadaten/Viewer und Diagnosen; bestehende CodeFile-API kompatibel erhalten. **K3/K5/K7**. — ADR-0058, `contracts/code/explorer.ts` (additiv, `CodeFile` unverändert)
- [x] **T46.3** Lazy/paginierte Tree-API, Root-/Host-/Worktree-Containment, Filter und Watch-/Overflow-Recovery; tiefe Ordner, symlink loop/outside und Rechtefehler prüfen. **K2/K5/K7/K8**. — `listTree` (lazy, paginiert, dotfiles/untracked/ignoriert, `.git`/Ausbruchs-Links gesperrt); Revalidierung per 5-s-Poll statt Watcher; Remote-Hosts offen
- [x] **T46.4** Rechte Sidebar/Touch-Drawer, Root-Auswahl, Tabs/Popouts, natürliche Sortierung und Gitstatus; kein Draft-/Tail-/Approval-Verlust beim Rootwechsel. **K1/K2/K7/K10**. — rechte Sidebar/Drawer, Root-Auswahl (gepinnt), Tabs, Gitstatus; Popout offen
- [x] **T46.5** Vollständiger Text-/Bytezugriff mit Chunk-/Range-/Encoding-/Revision-Tests; >1 MiB bis zum Ende, UTF-16/Emoji/CRLF, Änderung während Nachladen, große/unknown Binary und Download-Abbruch. **K2/K5/K7/K8**. — `/meta` + `/range` + `/raw`; Tests > 1 MiB, UTF-16/Emoji/CRLF, Revisionswechsel, Hex bis letztes Byte
- [x] **T46.6** Viewer-Router und Formatmatrix gemäß §3.4, Quell-/Hex-Fallback, passive Preview und sichere vorhandene lokale Converter mit sichtbaren Capabilities; keine Notebook-/Macro-/HTML-Script-Ausführung beim Anzeigen. **K2/K3/K5/K10**. — Text/Hex/Bild/Audio/Video/PDF/Download, Markdown (Mermaid als Quelltext), HTML-Sandbox, JSON/CSV, Notebook, SVG, ZIP, Office-Textauszug; keine lokalen Converter
- [x] **T46.7** Syntaxfarben/Dateisuche/Go-to/Wrap und Diagnoseadapter (JSON, TS/JS Projekt, Python) samt Fehlerliste, Checkerzustand und stale-Revision-/Positionsprüfung; keine ungefragten Toolinstallationen. **K1/K2/K5/K7**. — hljs lazy, Zeilen, Go-to, Suche über die ganze Datei, Diagnosen (JSON/tsc nach Projekt-Freigabe/Python-Syntax), ehrliche Zustände
- [ ] **T46.8** Datei-/Diagnoseauswahl als Quellenpaket an P36, gerätelokaler Tree-/Tab-Restore und Offline-Bereichsstatus; P39/P43/P44-Verträge abstimmen. **K3/K5/K7/K10**. — **teilweise:** Feedback-Paket (Vorschau, Revision, quoted data) und Tab-Restore gebaut; **Popout umgesetzt in EPIC-P48 T48.7** (Datei-Tabs per ⧉ in eigene Fenster, `WindowTarget {kind:"file"}`, Session-Roots — Projekt-Root-Dateien brauchen eine eigene Hash-Route, offen); Offline-Bereichsstatus offen
- [x] **T46.9** `e2e/specs/project-explorer.spec.ts`, `file-viewers.spec.ts`, `file-diagnostics.spec.ts`: echter Hub/Projektwechsel, letzte Datei-/Bytebereiche, Formate, Fehler/Gegenprobe, Agentenänderung, Restart; echte Pixel-Abnahme, Gate/PWA-Build/K2/K8. **K1/K2/K3/K5/K7/K8/K10**. — **teilweise:** `project-explorer`, `file-viewers`, `file-diagnostics` geschrieben und grün; echte Pixel-Abnahme und K2/K8 auf dem Gerät nach P000 verschoben

## 5. Acceptance Criteria (AC-P46-k)

- **AC-P46-1:** Rechts erscheint der vollständige berechtigte Projekt-/Worktree-Baum, per Touch-Drawer dieselbe Funktion; dotfiles/ignored/untracked können sichtbar sein. Root/Host/Branch sind eindeutig; gleiche Pfade auf zwei Hosts vermischen sich nicht.
- **AC-P46-2:** Klick öffnet Datei/Tab mit Herkunft; Datei ohne Suchtreffer und tief verschachtelte Datei sind erreichbar. Externe Agentenänderung aktualisiert den Tree; Watch-overflow ist sichtbar und resynct.
- **AC-P46-3:** >1-MiB-Textdatei und große Binärdatei sind bis zum letzten Zeichen/Byte lesbar; kein stiller Restverlust, kein Mischen zweier Revisionen. RAM-/Transferbudgets aus T46.1 werden eingehalten.
- **AC-P46-4:** Die §3.4-Fixtures haben nachgewiesene Renderer oder ausdrücklich ausgewiesene fehlende Converter/Codec-Capability plus Original-/Hex-Zugang. Alle PDF-Seiten/Office-Sheets im verfügbaren Renderer erreichbar; unbekannte Formate sind nicht leer.
- **AC-P46-5:** Code zeigt Syntaxfarben und Navigation; JSON-Syntaxfehler, tatsächlicher TS/JS-Projekttypfehler und Python-Diagnose sind samt korrigierter Gegenprobe belegt. Nicht verfügbare/fehlgeschlagene Diagnosen erscheinen nicht als fehlerfrei.
- **AC-P46-6:** Fehlerliste springt zur korrekten Datei/Revision/Position, inklusive Emoji/CRLF; alte Diagnose nach Dateiänderung ist erkennbar/verworfen. Gewählter Ausschnitt/Befund lässt sich nach Vorschau an P36 geben.
- **AC-P46-7:** Passive Preview führt keine eingebetteten Scripts/Macros/Notebook-Zellen aus; externe Symlinks/gesperrte Pfade/ungewählte Hosts sind nicht lesbar. Bloßes Öffnen eines untrusted Projekts startet keinen Repo-Checker.
- **AC-P46-8:** Reload/Popout/Rootwechsel erhält Gerätedarstellung, Drafts und datierten Offline-Stand; nicht gecachte Bereiche sind ehrlich nicht verfügbar. K1/K2/K7/K8 weiterhin grün, reale Pixel-Ansicht belegt.

## 6. Premortem (Failure-Modi + Mitigation)

1. „Alle Dateien“ ist nur erster Megabyte-Chunk → Vollständigkeit bis EOF/letztem Byte testen, revisioniertes Nachladen statt Limit-Erhöhung.
2. Monaco wird zur mobilen Produktregression → offizieller Mobile-Nichtsupport im Spike berücksichtigen, separater schlanker Touch-Viewer mit gleichen Daten/Diagnosen.
3. Syntaxfarben suggerieren fehlerfreien Code → Sprache/Diagnoseanbieter/Prüfstatus separat und echte Fehler/Gegenproben im Projektkontext.
4. Dateibaum zeigt falschen Checkout → Root/Host/Workspace-Identität in jedem Request und Tab; gepinnte/follow-Auswahl sichtbar.
5. HTML/Office/Notebook-Preview wird Codeausführung → passive Konverter-/Previewgrenze, keine aktiven Inhalte/Netzressourcen automatisch.
6. Agent ändert Datei während Streaming/LSP → Content-Revision/ETag, kontrollierter Reload und stale-Diagnoseprüfung.
7. Große Ordner/Sprachserver blockieren Hub/Tail → lazy Tree, begrenzte Worker und asynchroner Restore; Last auf Pixel/20 Sessions messen.

## 7. Definition of Done

Alle T46.* und AC-P46-* mit aktueller Evidenz, P38-Exit grün. `npm run gate`, PWA-Build und relevante K2/K8-Messungen grün; Pipeline-Job `e2e` grün beziehungsweise Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, nie als Pass. Jede neue UI-Funktion/jeder Ablauf in `e2e/specs/`; Viewer-/Diagnose-/Converter-Matrix und echte Pixel-Prüfung separat belegt, Skip ≠ Pass. Verträge/ADR, APIs/Viewer/Diagnoseaktionen und Sidebar sind registriert/erreichbar und dokumentiert. K5/K7 und Zugriff auf komplette Originaldateien nachgewiesen; kein Universal-IDE-/Renderer-/Sprachdiagnose-Claim ohne Capability-Nachweis. Orca-Port mit gepinntem Pfad/Hash/Notice und eigenen Tests gemäß Planungsgrundlage. Keine Datei-Schreib-/Autosave-Funktion aus diesem Anzeigeauftrag ableiten.

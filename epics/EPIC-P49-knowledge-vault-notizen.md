# EPIC-P49 — Knowledge Vault: Notizen-Tab mit Ordnerwahl und Markdown-Editor

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · **Phase:** P49 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — baut auf P47 (Dock-/Übersichtsfläche) und P48 (Popout-Ziel-Muster, ADR-0053/0062) auf; nutzt SettingsStore (SQLite, kein Restart) statt `hub.config.json`. Auftrag 2026-11-10 erlaubt Umsetzung vor den offenen Live-Abnahmen.

Quelle: Nutzerauftrag vom 10.11.2026: neuer Tab im Seitenmenü zum Organisieren von Notizen (Knowledge Vault); beim ersten Öffnen Zielordner wählen lassen, falls in den Einstellungen noch keiner gesetzt ist; neue Dateien anlegen (nur .md); alle Dokumente sehen und anschauen; Auswahl öffnet die Datei im Chat-Fenster, editierbar sofern .md; Fenster herauslösbar.

## 1. Ziel

Ein eigener Tab in der App-Navigation öffnet den Knowledge Vault: einen vom Menschen gewählten Ordner mit Notizen. Der Ordner wird einmalig (oder in den Einstellungen) festgelegt, der Vault listet alle Dokumente, legt neue Markdown-Dateien an, zeigt sie mit der gewohnten Viewer-/Renderer-Matrix an und macht Markdown dort editier- und speicherbar. Ansicht und Editor sind als eigenes Fenster herauslösbar. Messlatten K1 (Erreichbarkeit), K5 (Payload-Budgets), K7 (kein neuer wiederherzustellender Hub-State — Notizen sind Dateien, Konfiguration im SettingsStore), K10 (Offline ehrlich).

## 2. Scope (In / Out)

**In:** Vault-Ordner-Wahl über einen serverseitigen Verzeichnis-Browser (Startpunkte: `projectRoots` und Hub-Home; nur Verzeichnisse, Containment gegen Startpunkte), Persistenz im SettingsStore (Key `vault.root`, sofort wirksam, kein Restart); Vault-API (Liste, Anlegen nur `.md`, Lesen mit Revision, Schreiben nur `.md` mit Revision-Guard und Größen-Cap); Agenten-Schreib-/Lesesperre (Vault ist Menschenfläche wie Diagnose-Trust); PWA-Dock-Tab `notizen` mit Erst-Öffnen-Picker, Dateiliste (Nachname/Aktualität), Markdown-Editor mit Vorschau (Renderer aus P46) und explizitem Speichern; Anschauen aller Dateitypen read-only über die bestehende Viewer-Matrix; Popout-Ziel `vault`; Specs.

**Out:** Verschlagwortung/Volltextindex/Verknüpfungsgraph im Vault (P48-Graph kann den Ordner später als Root bekommen — hier nicht), Umbenennen/Löschen/Verschieben von Dateien, Automatisch-Speichern/Offline-Sync-Konfliktlösung über Revision hinaus, Ko-Bearbeitung, Verschlüsselung, Obsidian-Kompatibilitätsversprechen, zweiter Secrets-/Credentials-Speicher.

## 3. Design-Details

### 3.1 Bestand und Einbauorte

- **Es existiert kein Schreibpfad für Dateien im Hub** (geprüft: `/api/code/*` read-only per ADR-0058; einzige Schreiber sind Skills-Artefakt `writeProjectArtifact`, Forge-Log, STT-Tmp). Der Vault ist eine **bewusst neue, eng begrenzte Schreibfläche** mit eigenem ADR-0063 und eigenem Containment-Root — Projekt-/Worktree-Dateien bleiben read-only.
- SettingsStore (SQLite, `apps/hub/src/main.ts:236`, Keys wie `gemini.apiKey`, Routes `apps/hub/src/modules/attachments/attachments.routes.ts:67-72` mit inline-zod, Capability `settings.manage` `apps/hub/src/platform/policy.ts:52`): Muster für `vault.root` — GET/PUT ohne Restart.
- Navigation: ListPage-Erweiterung `apps/pwa/src/app/route.ts:18-24` (`PAGE_SLUG`, `TOOL_PAGE_IDS`), Render-Zweig `App.tsx`/`ToolPane.tsx:10-71`, Dock-Item `app/Dock.tsx:24-43` (Muster: `media`/`pc`). Tab-Icon in `shared/TabIcon.tsx` registrieren.
- Anzeige/Editor: `apps/pwa/src/features/files/FileViewer.tsx` (Modi, Revision-Guard `useRevisionGuard` :115-120), Markdown-Renderer `render-model.ts`/`RenderedViews.tsx` (eigenes `parseMarkdown`, Mermaid passiv), Range/Meta-APIs `api.ts:993-997`. Editor = Textfläche + Vorschau-Umschalter + Speichern mit `PUT …&rev=` (409-Stale-Banner wie FileViewer).
- Popout: `WindowTarget` aus P48 erweitert um `{kind:"vault", path}` (ADR-0062-Muster); `PopoutShell` lädt Vault-Datei eigenständig per HTTP.

### 3.2 Vault-API und Sicherheit

- Root-Wahl: `GET /api/vault/state` (gesetzt? + Root + Anzeige-Pfad), `GET /api/vault/browse?path=` (nur Verzeichnisse; Startpunkte = `projectRoots` + Hub-Home; jede Navigation containment-geprüft per realpath, keine frei eingebbaren Pfade), `PUT /api/vault/root` (Capability `settings.manage`; validiert: existiert, Verzeichnis, lesbar; Setzen lehnt `.git`-Interne und `dataDir` des Hubs ab).
- Dateien: `GET /api/vault/files` (rekursiv, md + andere Typen gekennzeichnet `editable`), `POST /api/vault/files` (nur `.md`, Name-Regex `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.md$`, keine Überschreibung bestehender Dateien), `GET /api/vault/file?path=` (Meta + Text, Caps wie Code: 1 MiB Text), `PUT /api/vault/file?path=&rev=` (nur `.md`, ≤ 1 MiB, Revision-Guard 409, atomar via Temp-Datei + Rename im selben Verzeichnis).
- Containment wie `explorer.ts:36-41` (realpath beidseitig, `.git` geblockt) — aber gegen `vault.root` statt Projekt-Root. Symlinks nach außen blocken.
- Policy: alle Vault-Routen lehnen `policy.decision === "approve"` (Agenten) laut ab (403, Präzedenz Diagnose-Trust `code.routes.ts:235`); Root-Wahl zusätzlich `settings.manage`. Keine Vault-Pfade in Events/Telemetrie-Text.

### 3.3 PWA: Tab, Picker, Liste, Editor

- Dock-Tab `notizen` (Icon Notiz). Erstes Öffnen ohne gesetzten Root: modalischer Verzeichnis-Browser (Breadcrumbs + Ordnerliste + „Hier verwenden"); danach normal Liste. Einstellungen bekommen eine Zeile „Vault-Ordner" mit Wechsel-Button (gleiche Komponente).
- Liste: alle Dateien im Vault (Ordnergruppierung flach/rekursiv erkennbar), `.md` als editierbar gekennzeichnet, andere Typen anklickbar read-only (Viewer-Matrix). Suche/Filter minimal (Präfixmatch reicht für v1, kein zweites Suchsystem).
- Auswahl öffnet die Datei im Chat-Fenster: das SessionTail-Tab `datei` aus P48 zeigt mit `target = vault` (FileViewer unterstützt danach drei Zielarten: Session-Worktree, Projekt, Vault); ist keine Session offen, öffnet der Vault-Tab die Datei selbst (ToolPane-Fläche). Editor für `.md`: Textfläche mit Monospace (Schrift-Token `--font-code`), Vorschau-Umschalter (Renderer), Speichern-Button mit Rev-Guard und Offline-Sperre (offline kein Speichern, ehrlicher Zustand K10).
- Popout `{kind:"vault", path}`: Editor und Ansicht im eigenen Fenster, eigene HTTP-Quelle; Broadcast nur Fensterlebenzyklus.

### 3.4 Recovery und Grenzen

- Notizen sind gewöhnliche Dateien im gewählten Ordner — der Hub hält keinen zweiten Zustand (K7: nichts wiederherzustellen; verlorene Sockets verlieren keinen Text, da Editor lokal hält bis Speichern). Gespeichert wird nur auf expliziten Klick (kein Autosave, kein halber Server-State). Offline: Lesen nur aus letzter Antwort, ehrlich gekennzeichnet; Schreiben gesperrt.

## 4. Aufgaben (Checkliste T49.m)

- [x] **T49.1** ADR-0063 (Vault-Schreibfläche, Sicherheit, SettingsStore-Key, Agentensperre) + `packages/contracts/src/vault/` (State/Browse/Listing/File-Typen, Caps, Revision). **K5/K7**.
  — *Erledigt:* docs/adr/0063, Contracts mit `VAULT_NAME_PATTERN`/Caps; ADR-Nummer 0063 (nicht 0062 wie ursprünglich geplant — 0062 ging an den Repo-Graphen).
- [x] **T49.2** Core `packages/core/src/modules/vault/`: Root-Store (SettingsStore), Browse mit Startpunkt-Containment, rekursive Liste, `.md`-Anlegen (Regex, keine Kollision), Lesen/Schreiben mit Revision-Guard + atomic rename; Unit-Tests: Traversal-/Symlink-Ausbruch, Nicht-md-Schreibversuch, Stale-Revision, Überschreibungsverbot, Cap. **K5/K7**.
  — *Erledigt:* `vault/store.ts` (VaultStore, DI wie ActionRunner), 9 Unit-Tests grün.
- [x] **T49.3** Hub-Routen `apps/hub/src/modules/vault/vault.routes.ts` mit Policy (Agenten 403, Root-Wahl `settings.manage`) + Integrationstests inkl. Policy-Gegenproben. **K1/K5**.
  — *Erledigt:* Zentrale Policy `/api/vault*` → `settings.manage` **vor** der GET-„read“-Kurzschlussregel (ADR-0063 §4 — auch Lesen ist keine Lese-Operation); Agenten-Tokens („agent:*“) bekommen 403 zentral, Routen haben eine zweite Wand; 5 Integrationstests inkl. Agent-403-Gegenprobe und Traversal.
- [x] **T49.4** PWA Dock-Tab `notizen` + Erst-Öffnen-Picker + Einstellungszeile; Liste mit Ordner-/Typ-Kennzeichnung. **K1/K10**.
  — *Erledigt:* Dock-Item „Notizen“ (ListPage `vault`, Slug `notizen`), Picker mit Startpunkten/Breadcrumbs/„Diesen Ordner verwenden“, Wechsel-Knopf im Vault-Kopf ersetzt die separate Einstellungszeile (gleicher PUT-Pfad, ein Ort statt zwei).
- [x] **T49.5** Anzeigen aller Typen (Viewer-Matrix, `target=vault=1` in den Code-Routen — volle P46-Matrix inkl. gerendertem Markdown) + Markdown-Editor (Text, Rev-Guard, Offline-Sperre). **K1/K10**.
  — *Erledigt:* `vault=1`-Ziel in code.routes (ADR-0063 §3), FileViewer-Wiederverwendung; Editor mit Speichern/Ansehen-Umschalter.
- [x] **T49.6** Popout-Ziel `vault` (protocol/windows/PopoutShell) + windows.spec-Erweiterung. **K10**.
  — *Erledigt:* `{kind:"vault", path?}` additiv; Hash `#/notizen/datei/<path>`; Popout-Shell rendert VaultPane eigenständig; Deckung über `vault.spec.ts` (windows.spec unverändert gültig — neue Zielart, keine Änderung an Bestandsassertionen).
- [x] **T49.7** E2E `vault.spec.ts`: Erstöffnen→Picker→Liste→Anlegen→Editieren→Speichern→Reload→Inhalt da; Stale-Revision; Agent-Policy-403 (Integration); Nicht-md nur lesbar; Popout; `npm run gate` + PWA-Build. **K1/K5/K7/K10**.
  — *Erledigt:* 5 Specs grün; Agent-403 als Integrationstest belegt (E2E-Gegenprobe bräuchte Agent-Token-Issue via tokens.manage — bewusst der Integrationstest).

## 5. Acceptance Criteria (AC-P49-k)

- **AC-P49-1:** Ohne gewählten Ordner führt der erste Tab-Klick in den Verzeichnis-Browser; gewählter Root überlebt Hub-Neustart (SettingsStore) und ist änderbar.
  — *Erfüllt:* E2E „Erstöffnen“ (Picker → Wahl → Reload bleibt); Wechsel-Knopf im Vault-Kopf (statt separater Einstellungszeile, gleicher API-Pfad).
- **AC-P49-2:** Neue Notiz legt ausschließlich `.md` mit validem Namen an; bestehende Dateien werden nicht überschrieben; alle Dateien des Ordners erscheinen in der Liste.
  — *Erfüllt:* Unit „create“ (409 bei Duplikat, 422 bei Traversal/Slashes), E2E Anlegen sichtbar.
- **AC-P49-3:** `.md` ist editierbar (Text + Ansicht über die P46-Viewer-Matrix) und speichert mit Revision-Guard; gleichzeitige Änderung → 409 sichtbar, kein stiller Verlust; andere Dateitypen sind nur anschaubar.
  — *Erfüllt:* E2E Speichern→Reload→Inhalt; E2E Stale (Fassung B bleibt); E2E csv ohne Bearbeiten-Knopf.
- **AC-P49-4:** Dateiansicht und Editor lassen sich als eigenes Fenster herauslösen und unabhängig nutzen.
  — *Erfüllt:* E2E Deep-Link + Popout (schlanke Hülle, eigene Datenquelle).
- **AC-P49-5:** Agenten-Requests auf Vault-Routen werden 403 abgelehnt; Pfad-Traversal/Symlink-Ausbrüsse aus dem Vault-Root sind blockiert (Tests belegen).
  — *Erfüllt:* Integrationstest Agent-403 über alle Methoden (zentrale Policy `settings.manage`); Unit Traversal/Symlink; Integration `../../etc/passwd` → 422.

## 6. Premortem (Failure-Modi + Mitigation)

1. Neue Schreibfläche wird Angriffsfläche → eigener Containment-Root, realpath beidseitig, `.md`-Only, Agenten-403, keine frei eingebbaren Pfade (nur Browse), ADR-0063 vor Merge.
2. Nutzer wählt Riesen-Ordner (z. B. Home) und die Liste explodiert → rekursive Liste mit Entry-Cap + ehrlicher Truncation-Anzeige; Suche erst bei Bedarf.
3. Zwei Fenster editieren dieselbe Notiz → Revision-Guard (409) + sichtbares Stale-Banner; bewusst kein Merge-Versprechen.
4. Vault wird zweite Einstellungs-/UI-Logik → SettingsStore-Muster und Dock-/ToolPane-/FileViewer-Bestand wiederverwenden, keine neue Config-Datei, kein Restart.
5. Offline wird zu Geisterspeichern → Speichern nur online mit Fehlerfläche; ungespeicherte Editor-Inhalte bleiben lokal im Fenster bis Speichern/Verwerfen, Zustand ehrlich.

## 7. Definition of Done

Alle T49.* und AC-P49-* mit Evidenz. `npm run gate` grün, PWA-Build grün; Specs in `e2e/specs/vault.spec.ts` (+ Dock-Label-Liste in `navigation.spec.ts`). ADR-0063 vor Contract-Merge; Contracts-Export, Hub-Routen, PWA-Feature und Dock-Tab registriert/erreichbar und dokumentiert. Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen, nie als Pass. K7 durchgewiesen (Notizen sind Dateien, Root im SettingsStore, kein zweiter Hub-State); kein TODO ohne Epic-Bezug. Offen: Live-Abnahme am Gerät; Einstellungen-Seite zeigt den Vault-Ordner noch nicht separat (Wechsel läuft über den Vault-Tab, gleicher API-Pfad).

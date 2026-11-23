# EPIC-P22 — Session-Entdeckung: erkennen, suchen, sicher aufgreifen

**Status:** abgeschlossen 2026-10-28 — Live-Abnahme nach P000 verschoben (T000.7, zuvor T35.16) · **Phase:** P22 · **Abhängigkeit:** P5 (Entdeckung, Übernahme, ADR-0011), P21 (Übergabe)

Auslöser: Wunsch von Jan vom 2026-10-28. „Gefunden“ zeigt nur IDs; die laufende AncientVoid-Session mit Claude ließ sich nicht erkennen und nicht sauber aufgreifen.

## 1. Ziel
Jede entdeckte Session sagt, **worum** es geht (Titel, letzte Nachricht), ist **durchsuchbar**, zeigt, ob sie **gerade woanders offen** ist, und lässt sich
**ohne Doppelschreiber** fortsetzen (Kopie mit eigener ID). Messlatten: K7 (Zustand aus Transkript rekonstruierbar), K9 (nichts still verwerfen), R9.7 (unbekannt statt geraten).

## 2. Scope (In / Out)
**In:** T22.1 Titel/Vorschau/`live` (Claude, opencode, Hub-Records); T22.2 Suche serverseitig; T22.3 Übernahme ohne Prompt (Claude) und als Kopie; T22.4 PWA-Zeile + Suche.
**Out:** externe Scanner für Codex/pi/hermes/aider/copilot (eigenes Epic, braucht belegte Resume-Argumente, ADR-0036); Umbenennen der Titel; Transkript-Volltextsuche.

## 3. Aufgaben
- [x] **T22.1** `title`/`preview`/`live` am Contract, Claude-Leser (Kopf+Ende, Cache), opencode-Titel, Hub-Record-Titel. [ADR-0040](../docs/adr/0040-discovery-metadaten-und-kopie.md); `claude-meta.test.ts`, `dedupe.test.ts`.
- [x] **T22.2** `GET /api/discovery?q=&adapter=`, Filter vor Paging. `dedupe.test.ts`, `discovery.spec.ts` (Treffer auf Seite 2).
- [x] **T22.3** Claude: Übernahme ohne Prompt startet keinen Prozess (Ursache des „No deferred tool marker“-Fehlers); `adoptFork` → `--fork-session` nur im ersten Zug; stille Transkript-Buchhaltungszeilen. `adapter.test.ts`, `normalize.test.ts`, `session-manager.test.ts`.
- [x] **T22.4** PWA: Titel statt ID, Vorschau, „läuft gerade woanders“, „Als Kopie fortsetzen“, Suchfeld. `discovery.spec.ts`, `discovery.test.ts`.

## 4. Akzeptanzkriterien
- AC-P22-1: Eine Claude-Session mit `ai-title` erscheint mit diesem Titel und ihrer letzten Nutzernachricht; die ID bleibt als Nebeninfo.
- AC-P22-2: Die Suche findet einen Treffer, der ohne Suche erst auf Seite 2 stünde.
- AC-P22-3: Eine frisch beschriebene externe Session wird nur als Kopie angeboten; die Hub-Session ist `fork`, `idle`, trägt den Titel.
- AC-P22-4: Eine Übernahme ohne Prompt startet keinen Claude-Prozess; der erste Prompt setzt mit `--resume` (und einmalig `--fork-session`) fort.
- AC-P22-5: Die echte Live-Session (diese) lässt sich am Handy als Kopie aufgreifen und beantwortet einen Prompt. **Offen — Live-Abnahme durch Jan.**

## 5. Premortem
1. **Titel falsch/leer bei neuen CLI-Versionen.** *Mitigation:* Fallback auf ersten Prompt, sonst „Ohne Titel · <ID>“ — nie geraten.
2. **Scan wird langsam.** *Mitigation:* nur 96 KB + 256 KB je Datei, Cache nach mtime/Größe.
3. **Kopie unerwartet unerwünscht.** *Mitigation:* bei nicht-`live` bleibt „Fortsetzen“ (gleiche ID) der Standard.

## 6. Definition of Done
`npm run gate` grün, ADR-0040, Spec je UI-Funktion, Hub neu gestartet, Live-Abnahme AC-P22-5.

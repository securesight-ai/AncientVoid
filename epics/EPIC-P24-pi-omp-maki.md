# EPIC-P24 — pi, oh-my-pi und maki: Sessions erkennen und übernehmen

**Status:** abgeschlossen 2026-10-28 — Live-Abnahme nach P000 verschoben (T000.7, zuvor T35.16) · **Phase:** P24 · **Abhängigkeit:** P5 (Discovery), P22 (Titel, Kopie), ADR-0039

Auslöser: Wunsch von Jan vom 2026-10-28 („PI, oh my pi und maki.sh mit Session-Übertragung und Session-Erkennung“). Entscheidung: ADR-0041.
Messlatten: K7 (Zustand aus Dateien rekonstruierbar), K9 (Format-Bruch sichtbar).

## 1. Ziel
Sessions, die in pi, omp oder maki im Terminal laufen oder liefen, stehen mit Titel und letzter Nachricht unter „Gefunden“ und lassen sich im Hub fortsetzen.

## 2. Scope (In / Out)
**In:** T24.1 Scanner pi/omp/maki; T24.2 pi-Adapter-Übernahme (Fortsetzen, Kopie, Verlaufsimport, Recovery); T24.3 ACP: Preset `omp`, Modell nach `session/load`;
T24.4 Übernahme ohne Worktree, Worktree-Duplikate ausblenden; T24.5 PWA-Logik (Kopie nur wo möglich), Inventar.
**Out:** Kopie für omp/maki, Secret-Übergabe an Worker, Rollout auf weitere Hosts.

## 3. Aufgaben
- [x] **T24.1** `discovery/{pi-family,maki,text}.ts`, Config `discovery.*Dir`. `pi-family-maki.test.ts`.
- [x] **T24.2** `adapters/pi/src/{index,transcript,normalize}.ts`. `adoption.test.ts`.
- [x] **T24.3** `adapters/acp/src/index.ts` (`omp`-Preset, `selectModel`). `adapter.test.ts`.
- [x] **T24.4** `SessionManager.create` (`adoptsInPlace`), `discover`. `session-manager.test.ts`.
- [x] **T24.5** `Discovery.tsx`, `inventory.ts`. `discovery.spec.ts`.

## 4. Akzeptanzkriterien
- AC-P24-1: pi-, omp- und maki-Sessions erscheinen mit Titel/Vorschau unter „Gefunden“. Beleg: `pi-family-maki.test.ts`, `discovery.spec.ts`; live 2026-10-28.
- AC-P24-2: pi lässt sich fortsetzen und als Kopie fortsetzen, Kontext bleibt erhalten. Beleg: `adoption.test.ts`; live (Antwort „ROTBAER“ aus der Kopie).
- AC-P24-3: omp und maki lassen sich übernehmen, Verlauf wird importiert, die Antwort nutzt den Kontext. Beleg: live (omp „BLAUFUCHS“, maki „GRUENEULE“); ACP-Tests für Modell nach Load.
- AC-P24-4: Eine unlesbare Session-Datei wird als `unsupported-format` gezeigt, nie still verworfen. Beleg: `pi-family-maki.test.ts`.
- AC-P24-5: Live-Abnahme am Handy. **Offen.**

## 5. Premortem
1. **Zwei Schreiber auf einer Session.** Nicht eingetreten: pi forkt bei `live`, omp/maki bieten kein Fortsetzen an (maki sperrt zusätzlich selbst).
2. **Falsches Modell nach Load.** Eingetreten (maki 403) → `selectModel` nach `session/load`.
3. **Load aus fremdem Verzeichnis.** Eingetreten (omp Exit 130) → Übernahme ohne Worktree.
4. **Secret in Prozessliste.** Entdeckt, nicht gelöst (siehe ADR-0041).

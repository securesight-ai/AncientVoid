---
id: BUG-0214
slug: stt-verfuegbarkeit-geschwindelt-kein-browser-rueckfall
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/pull/156"
epic: "ADR-0028 (lokale Spracherkennung), EPIC-P10 (Diktat)"
created: 2026-11-18
reporter: Nutzer (Kai, Nachfrage) + Agent (am laufenden Hub nachgemessen)
---

# BUG-0214 — ist die eigene Erkennung weg, meldet der Hub „verfügbar“, und die App fällt nicht auf die Browser-Erkennung zurück

## Gesehen

Kai fragte, ob das Diktat sauber auf die Browser-/Cloud-Erkennung zurückfällt, wenn der
eigene whisper.cpp-Dienst nicht läuft. Nachgemessen am **laufenden produktiven Hub**, mit
abgeschaltetem whisper.cpp (Port 8094 gezielt beendet):

* `GET /api/stt` → `{"available":true,"engine":"whisper.cpp large-v3-turbo q5_0 (Vulkan, Radeon R9700)","local":true,"streaming":true}`
  — **obwohl nichts erreichbar war**. Die Auskunft kommt allein aus der Konfiguration
  (`apps/hub/src/modules/voice/stt.routes.ts`: `cfg ? { available: true, ... }`).
* `POST /api/stt` (echtes Diktat) → `502 {"error":"Spracherkennung nicht erreichbar (fetch failed) — bitte tippen."}`
  — ehrlich, aber die App zeigt daraus nur eine Fehlermeldung.
* Die App entscheidet beim **App-Start** einmal (`apps/pwa/src/shared/local-stt.ts` merkt sich
  die Auskunft, `use-push-to-talk.ts` setzt beim Drücken darauf). Nach einem Fehler wird die
  Auskunft **nie neu geholt**: das nächste Drücken versucht wieder den toten lokalen Weg.
  Das Protokoll der Browser-Erkennung (Web Speech hört live zu) kann dieselbe Aufnahme nicht
  nachträglich übersetzen — ein Rückfall *derselben* Aufnahme ist unmöglich, aber der
  **nächste** Druck hätte sofort die Browser-Erkennung nehmen müssen.

## Erwartet

* Der Hub behauptet nichts über eine Erkennung, die er nicht erreicht: `available:false`
  mit Grund, sobald der Dienst nicht antwortet.
* Die App nimmt das zur Kenntnis und nutzt nach einem lokalen Ausfall automatisch die
  Browser-Erkennung — und sagt beim nächsten Drücken, was sie gerade tut.

## Repro

1. whisper.cpp stoppen (`E:\WhisperSTT\_kill_stt.ps1` am Live-Rechner; im Harness: `sttUrl`
   auf einen toten Port, z. B. `http://127.0.0.1:9/inference`).
2. `GET /api/stt` → bisher `available:true`.
3. App neu öffnen, auf das Mikro-Feld schauen: Titel behauptet „Spracheingabe lokal (…)“,
   statt „Spracheingabe (Browser, meist Cloud)“.

## Umgebung

Windows-PC (KAISGAMINGDESK), produktiver Hub auf 127.0.0.1:7373, Chat/Composer mit `NyxFab`
(`data-testid="nyx-fab"`, `title={stt.title}`).

## Tests

`e2e/specs/stt-ausfall-rueckfall.spec.ts`: Hub mit `sttUrl` auf toten Port → `GET /api/stt`
muss `available:false` melden, und das Mikro-Feld muss „Browser“ im Titel tragen.
Unit: `apps/hub/test/stt-availability.test.ts` hält die Zielbildung fest (aus `/inference`
wird `/health`) und dass ein Verbindungsfehler als „nicht erreichbar“ gilt, ein
Antwort-Status aber nicht.

## Eingrenzung

Seit ADR-0028 (Konfig entscheidet, kein Nachschauen). Der Fehlerfall ist selten, aber er ist
der ärgerlichste: genau wenn der eigene Dienst stirbt, hält die App an einem toten Weg fest
und der Text bleibt aus — ohne Hinweis, dass die Browser-Erkennung längst gesprächsbereit wäre.

## Handoff

Hub: `GET /api/stt` prüft die Erreichbarkeit (kurz gecacht) und meldet `false` + Grund;
`streaming` wird nur gemeldet, wenn die Erkennung erreichbar ist. App: Auskunft lässt sich
erneuern (`refreshSttStatus()`), nach einem lokalen Ausfall wird sie erneuert, und der nächste
Druck nimmt die Browser-Erkennung mit klarer Meldung.

Gemerged als PR [#156](https://github.com/securesight-ai/AncientVoid/pull/156): Hub-Probe auf `/health` (kurz gecacht, `available:false` + Grund), App erneuert die Auskunft nach Ausfall und fällt auf die Browser-Erkennung zurück. Nachgestellt im Session-Worktree: Unit 4/4 (`apps/hub/test/stt-availability.test.ts`), E2E 2/2 (`stt-ausfall-rueckfall.spec.ts`, Projekt mobile).

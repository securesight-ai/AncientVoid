# EPIC-P75 — Sprachausgabe: Chat-Nachrichten und Fragen vorlesen (TTS)

**Status:** abgeschlossen 2026-11-22 (Code + automatisierte Tests grün — Belege je Task unten; E2E `tts.spec.ts` mobile+tablet) — **T75.8 Menschen-Abnahme nach P000 verschoben (T000.30)** · **Phase:** P75 · **Dauer:** ~2–3 Agenten-Tage · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P74; baut auf P65-Audio-Erkenntnissen, dem STT-Proxy-Muster ([ADR-0028](../docs/adr/0028-local-stt.md)) und dem SettingsStore-Muster ([ADR-0063](../docs/adr/0063-knowledge-vault.md) §4) auf; Backend-Referenz ist VoidWarden ADR-0013 (Hivemind-TTS, Schwesterrepo). Contract-/Policy-Neuzugang über [ADR-0097](../docs/adr/0097-sprachausgabe-tts-hub-proxy.md) — liegt vor.

Quelle: Nutzerauftrag vom 20.11.2026 — „Bei den Nachrichten, die im Chat an
den User gerichtet sind, kriegen wir, wenn zum Beispiel Läufe fertig sind
oder Fragen gestellt werden, einen kleinen Playbutton. Dafür wird dann das
Text-to-Speech-Modell genutzt, das wir auch für unsere Void-Worte nutzen.
(…) dass sie ein Text-to-Speech-Modell eintragen können in den Settings,
das dann entsprechend genutzt wird."

## 1. Ziel

Nachrichten, die der Agent an den Nutzer richtet, sind auf Knopfdruck
hörbar: ein Play-Button an Assistant-Nachrichten im Session-Chat (das sind
die Antworten am Lauf-Ende) und an offenen Frage-/Approval-Karten
synthetisiert Sprache und spielt sie ab. Die Synthese läuft über den Hub an
demselben lokalen TTS-Dienst, den VoidWarden für die Nyx-Ansagen nutzt
(Hivemind `POST /tts`, eigene Hardware im Tailnet — kein Cloud-TTS). Wer
noch kein TTS-Modell verknüpft hat, trägt es in den Einstellungen der PWA
ein und prüft es dort per Hörprobe — ohne Hub-Neustart.

Messlatten: **K5** (Audio und Synthese-Requests landen nie in
Events/JSONL), **K2** (Play-Auslösung verursacht keinen Frame-Lag im
Session-Tail). Ehrliche Verfügbarkeit nach der BUG-0214-Lektion: Die
Auskunft `GET /api/tts` entsteht aus einer echten Probe, nie aus der
Konfiguration alone.

## 2. Scope (In / Out)

**In:**

- Contracts `packages/contracts/src/voice/tts.ts`: Limits als Konstanten
  (`TTS_MAX_TEXT_BYTES = 4000`, `TTS_TIMEOUT_MS`-Default 120 000,
  `TTS_MAX_CONCURRENT = 1`) plus Request/Response-Doku der
  Hivemind-kompatiblen `/tts`-Form.
- Hub `apps/hub/src/modules/voice/tts.routes.ts`: `GET /api/tts`
  (Verfügbarkeit per Probe, TTL-gecached) und `POST /api/tts`
  (`{text}` → `audio/wav`), Fehler laut: 501 (nicht konfiguriert), 400
  (leerer Text), 413 (Text-Cap), 429 (Queue voll), 502 (TTS-Dienst nicht
  erreichbar). Synthese serialisiert (max 1 gleichzeitig), Audio ist
  transient — keine Events, kein JSONL, keine Blobs (K5).
- Konfiguration im **SettingsStore** (`tts.url`, `tts.engine`,
  `tts.language`, `tts.speed`, `tts.timeoutMs`) über `GET/PUT
  /api/settings/tts` mit zod-Validierung — Gemini-Muster, Capability
  `settings.manage`; runtime änderbar, kein Hub-Restart.
- Policy `voice.speak` für `/api/tts`: nur Menschen; Agenten-, Fleet- und
  Display-Tokens werden abgelehnt (403).
- PWA: Play-Button neben dem Copy-Button in
  `apps/pwa/src/features/session/EventRow.tsx` für `type === "assistant"`
  (Text via `visibleEventText`, voller Text) und an den Frage-/Approval-
  Karten (`SessionApprovals.tsx`/`ApprovalCard`); Wiedergabe über Blob-URL
  und `<audio>` (FileViewer-Muster); Knopf-Zustände laden/spielt/Fehler;
  über Cap gekürzter Text wird sichtbar gekürzt vorgelesen.
- Verfügbarkeit in der PWA gecacht abfragen (`local-stt.ts`-Muster); ohne
  Dienst ist der Knopf aus und nennt den Grund.
- Einstellungen: neuer Abschnitt „Sprachausgabe" in
  `features/settings/VoiceSettings.tsx` (URL/Engine/Sprache/Tempo/Timeout,
  Hörprobe-Knopf als Verifikation und Autoplay-Geste,
  Verfügbarkeitsanzeige).
- E2E `e2e/specs/tts.spec.ts` mit gemocktem TTS-Endpunkt am Test-Hub und
  Spy statt Lautsprecher; Eintrag `docs/funktionsinventar.md`;
  `docs/onboarding.md` („VoidWarden und lokale Sprache") aktualisieren.

**Out:**

- Automatisches Vorlesen neuer Nachrichten (P65-Sounds + VoidWarden-Ansagen
  decken „dass sich etwas getan hat" ab; ein späterer Opt-in-Toggle wäre ein
  eigener Auftrag).
- Streaming-TTS, Download/Persistenz von Audio, Platten-Cache.
- Ghost-Post-Processing (Pitch/Reverb) wie VoidWarden — die Chat-Stimme
  spricht natürlich, nicht als Nyx-Rolle.
- Cloud-TTS-Dienste und Browser-`speechSynthesis`.
- VoidWarden-Änderungen (dessen TTS bleibt eigenständig; nur derselbe
  Backend-Dienst wird geteilt).

## 3. Design-Details

### 3.1 Hub-Proxy und API (ADR-0097)

Die PWA ruft niemals direkt den TTS-Dienst auf: CORS am Dienst, keine
Policy-Stelle, keine zentrale Fail-loud-Verfügbarkeit. Stattdessen
spiegelt der Hub das STT-Muster: `POST /api/tts` mit `{text}` (optional
`speed`/`language` aus den Settings) leitet an `tts.url` weiter — Body
`{text, speed, language}` mit `language` als `"German"|"English"`
(gemappt aus `de`/`en`), Antwort WAV-Bytes durchgereicht als
`audio/wav`. `GET /api/tts` probed den Dienst echt (Probe mit TTL-Cache
wie `makeSttProbe` in `stt.routes.ts`; BUG-0214) und meldet
`{available, engine, checkedMsAgo}`. Fehlercodes analog STT. Requests
werden serialisiert (`TTS_MAX_CONCURRENT = 1`, FIFO-Queue, Cap 3 wartend,
danach 429): Der Hivemind-Server teilt sich mit VoidWarden und dem
Telegram-Setup (VoidWarden-Premortem #2) — der Hub darf ihn nicht
stampeden.

### 3.2 Konfiguration im SettingsStore, nicht in hub.config.json

Der Nutzerauftrag verlangt UI-Eintrag („in den Settings eintragen"); das
Gemini-Muster (`/api/settings/gemini` in
`apps/hub/src/modules/attachments/attachments.routes.ts`, `SettingsStore`
in `packages/core/src/modules/attachments/store.ts`) ist die bezahlte
Form: runtime änderbar, zod-validiert, hinter `settings.manage`. Bewusst
kein `tts`-Block in `hub.config.json` (würde Restart und Datei-Edit
bedeuten) und keine zweite Konfig-Quelle — der SettingsStore ist die eine
Wahrheit. TTS bleibt getrennt von `stt.url` und dem Agenten-LLM-Katalog
(VoidWarden ADR-0013 sagt genau das).

### 3.3 PWA: Play-Button und Wiedergabe

Play-Button in der Copy-Button-Reihe von `EventRow.tsx` (heute Zeile ~218)
für Assistant-Events; dieselbe Aktion an den Frage-/Approval-Karten
(`SessionApprovals.tsx`), dort mit dem Fragetext. Der Text kommt aus
`visibleEventText` (voller `payload.text`); über `TTS_MAX_TEXT_BYTES`
gekürzte Texte bekommen einen sichtbaren „gekürzt"-Hinweis, der Hub
erzwingt das Cap mit 413. Wiedergabe per Blob-URL + `<audio>`
(FileViewer-Muster `features/files/FileViewer.tsx`): Der Play-Tipp ist die
Autoplay-Geste (P65-Erkenntnis), ein erneuter Tipp stoppt. Während der
Synthese (lokal bis Timeout, Voxtral kann träg sein) zeigt der Knopf einen
Ladezustand. Availability-Status wird gecacht (`local-stt.ts`-Muster),
Offline/ohne Dienst: Knopf disabled mit Grund statt stiller Ausfall.
Wiederholtes Vorlesen desselben Texts darf aus einem kleinen
In-Memory-Blob-Cache (LRU, wenige Einträge) kommen — reine
Wiedergabe-Optimierung, kein Persistenz-Pfad (K5 bleibt).

### 3.4 Policy und Grenzen

`voice.speak` (neu in `apps/hub/src/platform/policy.ts`) gilt nur für
Menschen-Tokens: Agenten und die Flotte sollen den TTS-Dienst nicht
beschallen oder als Side-Channel nutzen; VoidWarden braucht ihn nicht
(eigenes TTS). Der vorzulesende Text ist Agenten-Output und bleibt Daten:
Er wird synthetisiert und abgespielt, nie als Instruktion interpretiert
(Prompt-Injection-Grenze, PRD §8.5). Chat-Text verlässt das Tailnet nicht
(Hivemind ist eigene Hardware; VoidWarden ADR-0013 erlaubt genau das).

### 3.5 VoidWarden-Kompatibilität

Geteilt wird nur der Backend-Dienst (`POST /tts`). VoidWardens
Ghost-Processing, seine festen Ansage-Vorlagen und seine Queue bleiben
unberührt; AncientVoids Requests landen in derselben Serverlast, darum die
Serialisierung im Hub (3.1). Die Beispiel-Engine ist
`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` (Hivemind-Standardstimme
serverseitig verwaltet); Voxtral (`de_female`, kein Englisch) ist die
konfigurierbare Alternative — nicht unterstützte Sprachen schlagen sichtbar
fehl, nie mit Stimmwechsel-Ausfall.

## 4. Aufgaben (Checkliste T75.m)

- [x] **T75.1** Contracts + Policy: `packages/contracts/src/voice/tts.ts`
  (Konstanten, `/tts`-Request-Form-Doku) und `voice.speak` in
  `apps/hub/src/platform/policy.ts` (Menschen only) nach
  [ADR-0097](../docs/adr/0097-sprachausgabe-tts-hub-proxy.md); Export in
  `packages/contracts/src/index.ts`.
  Beleg: `packages/contracts/test/approvals/policy.test.ts` grün,
  `apps/hub/test/platform/policy-prompt-cost.test.ts` grün.
- [x] **T75.2** Hub-Routen `apps/hub/src/modules/voice/tts.routes.ts`:
  `GET /api/tts` (Probe, TTL-Cache), `POST /api/tts` (WAV-Passthrough,
  501/400/413/429/502, FIFO-Queue max 1/3) + Unit-Tests mit gemocktem
  fetch: Fehlercodes, Serialisierung, Probe-Caching, nichts landet im
  EventStore. Messlatten: K5.
  Beleg: `apps/hub/test/modules/voice/tts-routes.test.ts` (9 Tests: 501/400/413/
  429/502, FIFO-Reihenfolge, Probe-Cache je URL, Synthese-Fehler verwirft das
  Probe-Urteil, EventStore unbeteiligt, Agent/Display 403).
- [x] **T75.3** Settings: SettingsStore-Keys + `GET/PUT /api/settings/tts`
  (zod, `settings.manage`) + Tests: Validierung (400), Roundtrip, ohne
  Konfiguration `available:false` statt Behauptung.
  Beleg: derselbe Test (Roundtrip inkl. null-Räumung, 400-Fälle,
  `SettingsStore.ttsView()`).
- [x] **T75.4** PWA-Client `apps/pwa/src/shared/tts.ts`: Statusabfrage
  gecacht, Synthese-Fetch, Playback (Blob-URL, Stop), kleiner LRU-Cache,
  sichtbare Fehler + Unit-Tests (Mock-fetch/Audio-Spy).
  Beleg: `apps/pwa/test/shared/tts.test.ts` (7 Tests: Status-Cache/Refresh,
  Cap-Kürzung Multi-Byte, Ende/Stop, LRU ohne Doppel-Synthese,
  URL-Freigabe, Knopf-Grund, checkedAgo).
- [x] **T75.5** Play-Buttons: `EventRow.tsx` (assistant, neben Copy-Button)
  und `SessionApprovals.tsx`/`ApprovalCard` (Fragetext); Zustände
  laden/spielt/Fehler, Cap-Kürzung mit Hinweis, disabled mit Grund ohne
  Dienst. Messlatten: K2 (kein Lag beim Auslösen).
  Beleg: `apps/pwa/src/shared/SpeakButton.tsx` (Zustände, gekapselter Run-Zähler
  gegen Race); E2E `tts.spec.ts` Test 2+3 (Phase laden→spielt→idle, Stop,
  gekürzt-Kennzeichen über Clip). `SessionApprovals` erbt über die gemeinsame
  `ApprovalCard` (`features/approvals/Approvals.tsx`), Fragetext `req.summary`.
- [x] **T75.6** Settings-UI: Abschnitt „Sprachausgabe" in
  `VoiceSettings.tsx` (Felder, Hörprobe-Knopf als Verifikation + Geste,
  Verfügbarkeitsanzeige mit `checkedMsAgo`) + Unit-Tests.
  Beleg: `ttsBlockReason`/`checkedAgo`-Tests in `apps/pwa/test/shared/tts.test.ts`;
  E2E `tts.spec.ts` Test 1 (Eintrag, Hörprobe, Verfügbarkeitsanzeige,
  invalid → 400 sichtbar); check:i18n grün (de+en).
- [x] **T75.7** E2E `e2e/specs/tts.spec.ts` (gemockter TTS-Endpunkt am
  Test-Hub, Audio-Spy): Play spielt, Stop stoppt, ohne Konfiguration
  sichtbar deaktiviert, Settings-Eintrag + Hörprobe, Fehlerpfad 502;
  Eintrag `docs/funktionsinventar.md`, Update `docs/onboarding.md`.
  Beleg: 3 Tests grün auf mobile+tablet (Stand 2026-11-22); G80-Zeile im
  Funktionsinventar, Onboarding-Abschnitt „VoidWarden und lokale Sprache"
  grenzt die Hub-eigene Sprachausgabe ab.
- [ ] **T75.8** Menschen-Abnahme — nach P000 verschoben (Delegationsvermerk,
  `EPIC-000-testsuite-fuer-menschen.md` §3; geführt als **T000.30**, nur dort
  abgehakt): echte Stimme am Gerät, Handy-Lautsprecher,
  Voxtral-Langtext-Fühlprobe.

## 5. Acceptance Criteria (AC-P75-k)

- **AC-P75-1:** Play-Button an Assistant-Nachrichten synthetisiert über
  `POST /api/tts` und spielt das WAV ab (Unit + E2E mit Spy belegt;
  `voice.speak`-Policy greift).
- **AC-P75-2:** Frage-/Approval-Karten sind ebenso vorlesbar (Fragetext,
  nicht die UUID).
- **AC-P75-3:** Ohne TTS-Eintrag ist der Weg sichtbar: Knopf disabled mit
  Hinweis auf die Einstellungen; nach Eintrag + Hörprobe in
  `VoiceSettings.tsx` spielt die Probe (PUT validiert, GET reflektiert,
  invalid → 400 sichtbar).
- **AC-P75-4:** `GET /api/tts` lügt nicht: Verfügbarkeit entsteht aus einer
  echten Probe mit `checkedMsAgo` (BUG-0214-Analogie; Test mit totem Port).
- **AC-P75-5:** K5 bleibt: kein Audio, kein Synthese-Request landet in
  Events, JSONL oder Blobs (Test belegt EventStore-Unbeteiligung).
- **AC-P75-6:** Limits greifen: Text-Cap (413 + sichtbare Kürzung),
  Timeout konfigurierbar, Queue serialisiert (Test belegt Reihenfolge und
  429 bei vollem Wartebereich).
- **AC-P75-7:** Agenten-/Display-Tokens bekommen auf `/api/tts` und
  `/api/settings/tts` 403 (Policy-Test).
- **AC-P75-8:** Doku aktuell: `docs/funktionsinventar.md`-Eintrag,
  `docs/onboarding.md`-Abschnitt „VoidWarden und lokale Sprache" nennt die
  Hub-eigene Sprachausgabe und ihre Grenze (kein Auto-Vorlesen).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Geteilte Hivemind-Box überlastet** (VoidWarden- und
   Telegram-Last treffen auf Chat-Vorlesen): Hub serialisiert
   (`TTS_MAX_CONCURRENT = 1`, FIFO, 429 sichtbar), Timeout konfigurierbar;
   echte Last in der P000-Hörprobe gefühlt, nicht angenommen.
2. **Lange Texte überschreiten die Synthese-Zeit** (Voxtral ist träg,
   VoidWarden ADR-0013 dokumentiert Timeout-Risiko): Text-Cap 4000 Bytes,
   sichtbare Kürzung, Ladezustand am Knopf statt stiller Abbruch.
3. **BUG-0214-Wiederholung — Verfügbarkeit gelogen:** `GET /api/tts`
   probed den Dienst echt; Test mit totem Port; UI zeigt Grund, nicht nur
   „aus".
4. **Autoplay-Policy blockt die Wiedergabe:** Der Play-Tipp ist die Geste
   (P65); blockierte Wiedergabe wird als Fehler angezeigt, nie still.
5. **Verleitung zum Abkürzen des Wegs:** PWA→TTS direkt (CORS/Policy-Lücke)
   oder Cloud-TTS „weil schneller" — von ADR-0097 verboten; Review-Gate
   (pr-review, Adapter-Isolation/K5) wacht darüber.

## 7. Definition of Done

Alle T75.1–T75.7 mit Evidenz, T75.8 delegiert (P000-Vermerk). `npm run
gate` lokal grün; GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem
Abschluss-PR grün; rote CI allein wegen Umgebung wird benannt, nie als
Pass gezählt. Neue UI-Abläufe mit Spec in `e2e/specs/`
(`tts.spec.ts`); Eintrag `docs/funktionsinventar.md`;
`docs/onboarding.md` aktualisiert. K5 nachweislich unverletzt, K2 ohne
neuen Render-Pfad im Tail. Kein TODO ohne Epic-Bezug.

## 8. Retro (2026-11-22, PR #275)

Zeitraum 20.11.–22.11.2026 (Auftrag → ADR → Umsetzung), 5 Commits
(9342f7f, 2509f26, 669ceca, 6631b5c, dcb3b0a).

### AK-Matrix

- AC-P75-1: 🟢 — E2E `tts.spec.ts` „Vorlesen spielt …" (Spy, `data-phase`
  playing, Hörprobe-POST mit `"German"`); Policy 403 in
  `tts-routes.test.ts`.
- AC-P75-2: 🟢 — `ApprovalCard` rendert SpeakButton mit `req.summary`
  (`Approvals.tsx`, Frage-Karten); kein eigener E2E-Fall nötig, da derselbe
  Baustein wie AC-P75-1 (Beleg: Unit + gemeinsame Komponente).
- AC-P75-3: 🟢 — E2E Test 1 (disabled + Grund, Eintrag, Hörprobe, invalid →
  400 sichtbar); `ttsBlockReason`-Test.
- AC-P75-4: 🟢 — `tts-routes.test.ts` „Auskunft entsteht aus einer Probe"
  (toter Port, `checkedMsAgo`, Cache je URL) + E2E Verfügbarkeitszeile.
- AC-P75-5: 🟢 — `sessions.list()` leer + E2E „kein RIFF/audio-wav im
  EventStore".
- AC-P75-6: 🟢 — 413 Multi-Byte am Cap, FIFO-Reihenfolge, genau ein 429,
  Timeout über `tts.timeoutMs` (Hub-Tests).
- AC-P75-7: 🟢 — Agent+Display 403 auf GET/POST `/api/tts` und
  PUT `/api/settings/tts`.
- AC-P75-8: 🟢 — G80 im Funktionsinventar, Onboarding-Abschnitt grenzt ab.

### Erkenntnisse

1. BUG-0214-Lektion zahlte sich doppelt aus: Neben der echten Probe mussten
   wir zusätzlich die Synthese-Evidenz einführen — eine gescheiterte
   Synthese verwirft das Probe-Urteil (TTL-Cache allein hätte nach einem
   Dienst-Tod noch Sekunden „verfügbar" gesagt). Beleg:
   `tts.routes.ts` `probe.invalidate()` + Test „Status lügt danach nicht
   weiter".
2. Test-Detail: gleichzeitige `inject`-Requests laufen nicht in
   Erzeugungsreihenfolge — Queue-Tests dürfen nur „genau ein 429"
   behaupten, nicht „der fünfte". Beleg: Queue-Test mit `Promise.race`.
3. Premortem 1/2/3 traten kontrolliert ein (Serialisierung, Cap, ehrliche
   Probe — jeweils mit Test belegt); 4 (Autoplay) bleibt der P000-Abnahme
   vorbehalten, 5 (Abkürzungsverleitung) trat nicht ein.

### Action Items

- AI-P75-1: Echte Voxtral-Langtext- und Lautsprecherprobe → T000.30 (P000).
- AI-P75-2: Falls Auto-Vorlesen je gewünscht wird: eigener Auftrag mit
  Opt-in-Toggle (Out-of-Scope-Vermerk §2) — kein Ticket, Absicherung über
  ADR-0097 Alternativen.

# ADR-0097 — Lokale Sprachausgabe: Hub-Proxys den Hivemind-TTS-Dienst, Konfiguration im SettingsStore

**Status:** akzeptiert (Nutzerauftrag 20.11.2026) · **Betrifft:** EPIC-P75,
`packages/contracts/src/voice/tts.ts`, `apps/hub/src/modules/voice/tts.routes.ts`,
`apps/hub/src/platform/policy.ts`, SettingsStore
(`packages/core/src/modules/attachments/store.ts`), PWA
`features/settings/VoiceSettings.tsx`, `features/session/EventRow.tsx`

## Kontext

Der Nutzer will Agent→User-Nachrichten (Antworten am Lauf-Ende, offene
Fragen) per Play-Button vorgelesen bekommen, synthetisiert von demselben
lokalen TTS-Dienst, den VoidWarden für die Nyx-Ansagen nutzt (Hivemind,
`POST /tts`, eigene Hardware im Tailnet; VoidWarden ADR-0013). Nutzer ohne
Verknüpfung sollen das TTS-Ziel in den Einstellungen der PWA eintragen
können. Randbedingungen: K5 (Audio nie in Events), geteilte Serverlast mit
VoidWarden/Telegram, ehrliche Verfügbarkeit (BUG-0214: STT hat einmal aus
der Konfigurationalone `available:true` behauptet), Autoplay-Policy der
Browser, Prompt-Injection-Grenze (PRD §8.5).

## Entscheidung

1. **Hub-Proxy wie bei STT (ADR-0028).** Die PWA ruft `POST /api/tts` mit
   `{text}` auf; der Hub leitet an `tts.url` weiter — Body
   `{text, speed, language}` mit `language` als `"German"|"English"`
   (gemappt aus `de`/`en`), Antwort-WAV wird als `audio/wav`
   durchgereicht. Kein Direktaufruf der PWA auf den TTS-Dienst: CORS am
   Dienst, keine Policy-Stelle, keine zentrale Fail-loud-Verfügbarkeit.
2. **Konfiguration im SettingsStore**, nicht in `hub.config.json`:
   `tts.url/engine/language/speed/timeoutMs` über `GET/PUT /api/settings/tts`
   (Gemini-Muster, zod, Capability `settings.manage`), runtime änderbar —
   der Nutzerauftrag verlangt UI-Eintrag, und es bleibt die eine
   Konfig-Quelle. TTS gehört weder in `stt.url` noch in den
   Agenten-LLM-Katalog (VoidWarden ADR-0013).
3. **Verfügbarkeit wird geprobed, nie behauptet:** `GET /api/tts` macht
   eine echte Probe mit TTL-Cache (`makeSttProbe`-Muster, BUG-0214) und
   meldet `{available, engine, checkedMsAgo}`.
4. **Policy `voice.speak`, nur Menschen.** Agenten-, Fleet- und
   Display-Tokens bekommen 403 — der TTS-Dienst ist kein Agenten-Output-
   Kanal und keine Beschallung.
5. **Audio ist transient.** Keine Events, kein JSONL, keine Blobs, kein
   Platten-Cache (K5); der vorzulesende Text ist bereits Event-Payload, der
   Synthese-Request ist flüchtig. Der Text bleibt Daten — Wiedergabe, nie
   Instruktion (PRD §8.5).
6. **Limits im Contract** (`packages/contracts/src/voice/tts.ts`):
   `TTS_MAX_TEXT_BYTES = 4000` (über Cap sichtbar gekürzt, Hub erzwingt
   413), Timeout-Default 120 000 ms (VoidWarden-Profil), Synthese
   serialisiert (`TTS_MAX_CONCURRENT = 1`, FIFO, 429 bei vollem
   Wartebereich) — der Hivemind-Server teilt sich mit VoidWarden und dem
   Telegram-Setup.
7. **Wiedergabe in der PWA** über Blob-URL + `<audio>` (FileViewer-Muster);
   der Play-Tipp ist die Autoplay-Geste (P65-Erkenntnis), Fehler sind
   sichtbar.

## Alternativen

- **PWA direkt zum TTS-Dienst:** scheitert an CORS, umgeht Policy und
  dezentralisiert die Verfügbarkeitsaussage. Verworfen.
- **`tts`-Block in `hub.config.json` (STT-Spiegel):** bräuchte Datei-Edit
  und Hub-Restart — widerspricht dem Auftrag „in den Settings eintragen".
  Verworfen; Config-File und SettingsStore parallel wäre zwei Wahrheiten.
- **Browser-`speechSynthesis`:** geräteabhängige Stimmen, kein Fachvokabular,
  teils Cloud — dieselben Gründe wie gegen die Browser-STT-Erkennung
  (ADR-0028). Verworfen.
- **OpenAI-`/v1/audio/speech`-Dialekt:** würde eine zweite API-Form
  einführen; der vorhandene Dienst spricht `/tts`. Verworfen.
- **Automatisches Vorlesen neuer Notifications:** bewusst Out — P65-Sounds
  signalisieren „dass", VoidWarden-Ansagen sprechen Status; ein Auto-Speak
  wäre ein eigener späterer Opt-in-Auftrag.

## Folgen

- Ohne TTS-Eintrag: `GET /api/tts` → `available:false`, Play-Buttons
  disabled mit Hinweis auf die Einstellungen, `POST /api/tts` → 501. Fail
  loud, nie still.
- Chat-Text verlässt das Tailnet nicht; Hivemind-Hardware ist dafür
  freigegeben (VoidWarden ADR-0013). Keine Cloud-TTS.
- Die geteilte Box verträgt keine Parallelität: Lastspitzen aus dem Chat
  treffen auf eine Serialisierung im Hub; 429/Timeout müssen in der PWA
  verständlich werden.
- Voxtral-Langtexte können das Timeout reißen (VoidWarden ADR-0013) — das
  Text-Cap und der Ladezustand am Knopf sind die Mitigation, die echte
  Hörprobe Teil der Abnahme (EPIC-P75 → P000).
- `docs/onboarding.md` muss die Hub-eigene Sprachausgabe von VoidWardens
  Kiosk-Ansagen abgrenzen, sobald P75 umgesetzt ist.

## Nachtrag 2026-11-22 — der echte `/tts` spricht Multipart (BUG-0254)

Die Live-Abnahme fand den realen Upstream-Dialekt: Der TTS-Dienst
(pocket-tts, `POST /tts`, von HiveOS-Referenzclient `voice.py` genutzt)
nimmt `multipart/form-data` mit Feld `text` an und antwortet mit Raw-WAV-
Bytes; ein JSON-Body wird mit 422 abgewiesen. §1 bleibt im Übrigen
unverändert — der Hub sendet jetzt die Felder `{text, speed, language}`
als Form-Felder (fetch setzt Content-Type samt Boundary; `speed`/
`language` sind Hinweise, die ein Dienst ignorieren darf) und reicht die
Antwort weiter als `audio/wav`. `TtsUpstreamRequest` dokumentiert den
Dialekt; Route- und E2E-Tests pinnen die Form statt des JSON-Bodies.

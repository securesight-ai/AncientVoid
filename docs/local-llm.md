# Lokales Modell (T7.5)

**Art:** how-to

Ein lokales Coding-Modell, das echte Harnesses (opencode, dsh) mit Tools
bedienen — ohne Cloud, ohne Kosten pro Token. Entscheidung 2026-09-23:
**llama.cpp** (nicht Ollama, nicht vLLM): auf gpubox (AMD Strix Halo, RDNA
3.5, 123 GB Unified Memory) läuft das fertige Vulkan-Build ohne ROCm-Stack,
MoE-Modelle mit wenigen aktiven Parametern sind dort am schnellsten, und der
Server spricht die OpenAI-API inkl. Tool-Calls (`--jinja`).

## Betrieb auf gpubox

| | |
|---|---|
| Binärdatei | `~/ancientvoid-llm/llama/llama-server` (llama.cpp b11149, Linux Vulkan x64) |
| Modell | `~/ancientvoid-llm/models/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` (Unsloth, 17,7 GB) |
| Alias | `qwen3-coder` |
| Adresse | `http://100.64.0.10:8081/v1` — nur Tailnet-IP |
| Schlüssel | `~/ancientvoid-llm/key` (0600), per `--api-key-file` (nicht in der Prozessliste) |
| Unit | `systemctl --user {status,restart} ancientvoid-llama` (Linger aktiv) |

```ini
# ~/.config/systemd/user/ancientvoid-llama.service
[Service]
WorkingDirectory=%h/ancientvoid-llm/llama
Environment=LD_LIBRARY_PATH=%h/ancientvoid-llm/llama
ExecStart=%h/ancientvoid-llm/llama/llama-server -m %h/ancientvoid-llm/models/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf --alias qwen3-coder --host 100.64.0.10 --port 8081 --api-key-file %h/ancientvoid-llm/key --jinja -ngl 99 -c 65536 --parallel 2 -fa on --metrics
Restart=on-failure
```

**Geteilte Maschine:** `halogen-starten.sh` (securesight, Halogen) beendet
beim Start *alle* `llama-server`, um Speicher freizumachen — auch AncientVoid Text
und Vision. Das ist gewollt und wird nicht bekämpft (`Restart=on-failure`
startet nach einem sauberen Beenden nicht neu). Danach beide Dienste explizit
starten:

```sh
systemctl --user start ancientvoid-llama ancientvoid-vision
```

Der RAG-Dienst auf Port 8001 bleibt unberührt.

Durchsatz und Messbedingungen: [Messlauf P7](messlauf/2026-09-24-p7-harness-gates.md)
(Median 82 tok/s Erzeugung, 58 tok/s mit ≈ 8k Kontext).

## Harnesses anbinden

**opencode (ACP)** — Provider über `OPENCODE_CONFIG_CONTENT`:

```json
{
  "id": "opencode-lokal",
  "module": "@ancientvoid/adapter-acp",
  "config": {
    "preset": "opencode",
    "label": "opencode+lokal",
    "env": { "OPENCODE_CONFIG_CONTENT": "{\"permission\":{\"edit\":\"ask\",\"bash\":\"ask\",\"webfetch\":\"ask\"},\"provider\":{\"gpubox\":{\"npm\":\"@ai-sdk/openai-compatible\",\"options\":{\"baseURL\":\"http://100.64.0.10:8081/v1\",\"apiKey\":\"{env:LLAMA_KEY}\"},\"models\":{\"qwen3-coder\":{\"tool_call\":true}}}},\"model\":\"gpubox/qwen3-coder\"}" }
  }
}
```

**dsh (DeepSeek-Harness, ACP)** — Route in `$DSH_HOME/settings.yaml`, der
Schlüssel bleibt in der Umgebung (`apiKeyEnv`):

```yaml
llm-pi-ai:
  providers:
    gpubox:
      displayName: gpubox llama.cpp
      apiKeyEnv: LLAMA_KEY
      api: openai-completions
      baseURL: http://100.64.0.10:8081/v1
      models:
        - id: qwen3-coder
          contextWindow: 65536
```

```json
{ "id": "dsh-lokal", "module": "@ancientvoid/adapter-acp", "config": { "preset": "dsh", "model": "gpubox/qwen3-coder", "env": { "DSH_HOME": "/pfad/zu/dsh-home" } } }
```

Das Modell wird beim Start über ACP `session/set_config_option` gewählt
(`provider/modell` passt auf dsh-Werte wie `["gpubox","qwen3-coder"]`); ein
nicht angebotenes Modell bricht den Start sichtbar ab. dsh bekommt vom
Preset `DSH_PERMISSION_MODE=read-only`: Lesen läuft in der OS-Sandbox,
alles Weitere fragt am Handy.

## Gatekeeper (T7.9)

Derselbe Server bewertet Tool-Anfragen ([ADR-0024](adr/0024-tool-gatekeeper.md)):

```json
"gatekeeper": { "model": { "url": "http://100.64.0.10:8081/v1", "model": "qwen3-coder", "apiKeyFile": "~/.config/ancientvoid/llama.key" } }
```

Ohne `model` laufen nur die Regeln. Ist der Server weg (z. B. nach
`halogen-starten.sh`), gilt fail-closed: Regeln + mindestens WARNING.

## Spracherkennung (P10)

Auf gpubox läuft zusätzlich `ancientvoid-stt`, ein systemd-User-Dienst
([ADR-0028](adr/0028-local-stt.md)). Er startet `whisper-server` aus
`~/ancientvoid-stt/whisper.cpp` (Vulkan-Build) mit `ggml-large-v3-turbo-q5_0.bin`
und lauscht nur auf der Tailnet-IP, Port 8094. Er hat keinen Schlüssel.

```json
"stt": { "url": "http://100.64.0.10:8094/inference" }
```

Optional sind `engine`, `language` (Standard `de`), `vocabulary` (Wörter, die
richtig geschrieben werden sollen; die Projektnamen kommen automatisch dazu)
und `timeoutMs`. Der Hub braucht `ffmpeg`. Ohne `stt` nutzt die PWA die
Browser-Erkennung und kennzeichnet sie als Cloud.
Messwerte: [Messlauf P10](messlauf/2026-09-24-p10-stt.md).

## Videoanalyse (P10.5)

Medien-Jobs ([ADR-0030](adr/0030-media-jobs.md)) nutzen dieselben Dienste:
`stt` für Sprache und `assistant.model` (bzw. den Gatekeeper-Server) für
Kapitel und Zusammenfassung. Auf gpubox läuft zusätzlich
[Qwen2.5-VL-3B-Instruct-GGUF](https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF)
über llama.cpp mit separatem mmproj. `ancientvoid-vision` lauscht auf
der Tailnet-IP `100.64.0.10:8095`, nutzt den Alias `qwen-vl` und akzeptiert
Anfragen nur mit eigenem Schlüssel `~/ancientvoid-llm/vision.key` (0600). Die
Modellartefakte liegen außerhalb des Repositories unter
`~/ancientvoid-llm/models/`; der Hub-Schlüssel liegt in
`~/.config/ancientvoid/vision.key` (0600). Hub-Konfiguration:

```json
"media": { "vision": { "url": "http://100.64.0.10:8095/v1", "model": "qwen-vl", "apiKeyFile": "~/.config/ancientvoid/vision.key" }, "maxDurationSec": 1800, "maxFrames": 30, "keepSource": false }
```

Der User-Service `~/.config/systemd/user/ancientvoid-vision.service` startet
`llama-server` mit `-m ~/ancientvoid-llm/models/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`,
`--mmproj ~/ancientvoid-llm/models/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`,
`--alias qwen-vl`, `--host 100.64.0.10`, `--port 8095`,
`--api-key-file ~/ancientvoid-llm/vision.key`, `--jinja`, `-ngl 99`, `-c 8192`,
`--parallel 1`, `-fa on`, `--cache-ram 0` und `--metrics`. Der Dienst ist
aktiviert und startet nach einem Host-Neustart automatisch.

Ohne `vision` gibt es für Bilder nur OCR (tesseract). Gemini wird nur für
Jobs gefragt, bei denen in der PWA „Cloud erlauben“ gesetzt ist.
Messwerte: [Messlauf P10.5](messlauf/2026-09-24-p10.5-media.md).

Der 3B-Dienst ist mit Halogen und `ancientvoid-llama` parallel geladen. Nach dem
Laden standen auf gpubox 29 GiB von 123 GiB als verfügbar zur Verfügung. Die
Messung nutzte das 18-s-Slides-Fixture; Langvideos, gleichzeitige Media-Jobs
und eine echte Harness-Session sind damit nicht abgenommen.

## Was fehlt

- **aider** mit dem lokalen Modell nicht live abgenommen (aider hat kein
  Tool-Gate, `--yes-always`).
- AncientVoid Text- und Visionmodell sind geladen; größere Modelle (Qwen3.5-122B-A10B)
  gehören zu anderen Diensten und teilen denselben Unified Memory.

## Halogen Qwen3.8 (gpubox) in pi, maki und oh-my-pi

Das Modell `halogen-qwen3.8-flash-next-uncensored-iq4xs` läuft auf gpubox hinter einem OpenAI-kompatiblen Endpunkt
(`http://100.64.0.10:8100/v1`, nur Tailnet; 131072 Kontext, Reasoning). **pi** kennt es über `~/.pi/agent/models.json`
(Provider `gpubox`). maki und oh-my-pi tragen den Provider in ihre **eigene** Config ein — der Hub schreibt dort
nichts (ADR-0060); der Schlüssel steht in keiner dieser Dateien, sondern in `~/.config/ancientvoid/gpubox.key` (0600)
und kommt per `envFiles` als `GPUBOX_API_KEY` in den Agenten-Prozess.

**maki** — `~/.config/maki/providers.toml` (Schema: maki-Doku „Custom provider“; `protocol`, `base_url`, `api_key_env`):

```toml
[gpubox]
display_name = "gpubox (Halogen)"
protocol = "openai"
base_url = "http://100.64.0.10:8100/v1"
api_key_env = "GPUBOX_API_KEY"

[[gpubox.models]]
id = "halogen-qwen3.8-flash-next-uncensored-iq4xs"
tier = "strong"
context_window = 131072
max_output_tokens = 32768
```

**oh-my-pi** — `~/.omp/agent/models.yml` (`apiKey` ist der *Name* der Umgebungsvariable):

```yaml
providers:
  gpubox:
    baseUrl: http://100.64.0.10:8100/v1
    api: openai-completions
    apiKey: GPUBOX_API_KEY
    models:
      - id: halogen-qwen3.8-flash-next-uncensored-iq4xs
        name: Halogen Qwen3.8 (gpubox)
        contextWindow: 131072
        maxTokens: 32768
        reasoning: true
```

**Hub** (`hub.config.json`, je `maki`- und `omp`-Eintrag) — Schlüssel aus der Datei in die Umgebung:

```json
"envFiles": { "ZHIPU_API_KEY": "~/.config/ancientvoid/glm-coding.key", "GPUBOX_API_KEY": "~/.config/ancientvoid/gpubox.key" }
```

Danach Hub neu starten; das Modell steht als `gpubox/halogen-qwen3.8-flash-next-uncensored-iq4xs` im Modell-Dropdown
beider Harnesses (Katalog per ACP-Probe, ADR-0054) und lässt sich in der laufenden Session wechseln (ADR-0061).
Das Kontextfenster (131072) kommt aus der kuratierten Tabelle (`@ancientvoid/models`, ADR-0032).

**Live belegt 2026-11-10** (Adapter-Lauf, gpubox erreichbar): maki und omp wählen das Modell beim Start und antworten
auf „Antworte nur mit ANKUNFT“ mit „ANKUNFT“. Der Schlüssel ist dabei nie in Config, Log oder Commit gelandet.

**Metriken (EPIC-P59/ADR-0078 Nachtrag 2026-11-17):** Reicht das Gateway
`/metrics` nicht durch, zeigt `aiMetrics.servers[].metricsUrl` auf den Zähler-Endpunkt der Engine (BUG-0278);
sonst fallen kurze Anfragen zwischen zwei Abfragen. Ohne Zähler nutzt der Hub-Sampler `/health`
(Queue, busy, Slots, Kontext) und optional `aiMetrics.servers[].halogenLog`
(Pfad zum Serverlog, Format wie Kais `halogen-livelog.py`) für Prefill-/
Decode-tokens/s. Systemmetriken kommen vom Hub auf dem KI-Host
(`hostProbe`); der Home-Hub merged Peer-Reports (`mergePeers`, Default an).

Bewusst manuell auf dem Peer (User `securesight` / laufender Hub-Prozess):

```json
"aiMetrics": {
  "hostProbe": true,
  "mergePeers": true,
  "probeKnown": true,
  "servers": [{
    "url": "http://100.65.133.28:8100/v1",
    "label": "halogen",
    "apiKeyFile": "~/.config/ancientvoid/evox2.key",
    "halogenLog": "~/.local/state/llama-server/halogen.log"
  }]
}
```

Der Hub-Prozess braucht Leserecht auf `halogen.log`; sonst bleiben Tokens/s
„nicht gemeldet“, Queue aus `/health` trotzdem sichtbar. Kein Halogen-
Dienstneustart nötig.

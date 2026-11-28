# Lokale Modellkandidaten für die Harness-Arbeit (Vorschlag, Stand 27.11.2026)

**Art:** bericht (datierter Snapshot; Belege aus Sekundärquellen, Stand 27.11.2026)

Nutzerauftrag 27.11.2026: lokale Modelle werden von Hand ausgesucht, Qwen ist
der Favorit; geladen wird erst nach Zustimmung; Messläufe später (Kontingent).
Dieser Vorschlag nennt Kandidaten je Aufgabenprofil mit Belegen und
Tunbarkeit. Er ersetzt keine Messung — die örtlichen Werte liefert
[EPIC-P87](../epics/EPIC-P87-messserie-aufgabenklassen.md) (n ≥ 5, Median +
Streuung; Einzelaussagen sind Rauschen, PRD §9 / Recherche §2.5).

## Rahmen

Prüfstand ist der Strix-Halo-Host **evox2** (Ryzen AI Max+ 395, 123 GB Unified
Memory, llama.cpp Vulkan ohne ROCm-Stack; OpenAI-API inkl. Tool-Calls via
`--jinja`, [local-llm.md](local-llm.md)). Schon laufend dort:
`qwen3-coder` (Qwen3-Coder-30B-A3B, 17,7 GB), `halogen`
(Qwen3.8-Flash-Next-Finetune, IQ4_XS, 131072 Kontext), Vision (Qwen2.5-VL-3B)
und Whisper; Qwen3.5-122B-A10B läuft für ein anderes Projekt auf demselben
Speicher. Public Evidence für die Grundannahme von P87: kleine Modelle
kippen bei schweren Aufgaben (APEX-Testing über 70 echte Repos, Feb. 2026 —
„Qwen 3.5 craters on hard coding tasks“).

Ein Benchmarkwert ist stets eine Eigenschaft von **Modell + Harness**
(llmrun: dieselbe Claude-4-Sonnet-Spanne 64,9–76,8 % je nach Agent). Die
Zahlen unten nennen deshalb die Quelle; Herstellerwerte sind markiert.

## Kandidaten je Aufgabenprofil

### Profil K — kleiner Arbeiter (Aufgabenklasse „klein“, Sub-Agenten, Fallback)

| Kandidat | Lizenz | Größe (quant.) | Beleg | Tuning |
|---|---|---|---|---|
| **Qwen3.5-9B** (dense, 256K ctx) | Apache 2.0 | ~7 GB | SWE-bench Verified 50,0 (Pi-Harness, JetBrains-Vergleich) · LiveCodeBench v6 65,6 | Unsloth bf16-LoRA 22 GB; QLoRA möglich |
| **Mellum2.1-12B-A2.5B** (MoE, Instruct 25.11.2026 / Thinking 08.10.2026) | Apache 2.0 | ~7–8 GB GGUF | SWE-bench Verified 47,0 (Pi-Harness; Qwen3.5-9B 50,0 im selben Lauf) · RL-trainiert für Coding-Agenten, ~1,4× schneller als Qwen3.5-9B | Apache 2.0; GGUF + MTP-Kopf offiziell |
| **gpt-oss-20b** | Apache 2.0 | 12–16 GB | im unabhängigen iGPU-Vergleich bester Wert (14/15 easy, 3,7/10 schwer, 27 tok/s) | Unsloth MoE-QLoRA ab 12,8 GB |
| MiMo-V2.6-Distill-Qwen-9B (Xiaomi) | MIT | ~6 GB | SWE-bench Verified 61,1 avg@3 (Scaffold ungenannt — Vorsicht) | Distill *von* Qwen: belegt, dass sich Qwen destillieren lässt |

Empfehlung Profil K: **Qwen3.5-9B** (Qwen-Favorit, direkt vergleichbar mit
Mellum2.1 im selben Pi-Harness) plus **Mellum2.1-Instruct** als
Geschwindigkeitskandidat (2,5B aktiv, MTP). gpt-oss-20b als Nicht-Qwen-Vergleichszelle.

### Profil M — Arbeitspferd (Klassen „mittel“/„schwer“, Implementierung)

| Kandidat | Lizenz | Größe (quant.) | Beleg | Tuning |
|---|---|---|---|---|
| **Qwen3.8-27B** (dense VLM, Aug. 2026) | Apache 2.0 | 17,9–24 GB Q4 | SWE-bench Pro 61,7 · Terminal-Bench 2.1: 73,0 · DeepSWE 42,2 · SWE-bench Verified 80,6 (volle Präzision; Qwen-Karte) · NL2Repo-Bench 42,3 (alles Qwen-Karte, Claude-Code-Harness) | Unsloth: QLoRA ab 24 GB, LoRA > 36 GB, RL/GRPO; Dynamic-GGUF 17 GB RAM |
| Qwen3.6-27B (dense) | Apache 2.0 | ~20 GB | SWE-bench Verified 77,2 (Qwen-Scaffold) · Pro 53,5 · TB 2.0 59,3 (Qwen-Karte) | wie Qwen3.5/3.8-Familie |
| Qwen3.6-35B-A3B (MoE) | Apache 2.0 | ~24 GB | SWE-bench Verified 73,4 (Qwen-Scaffold) — im Claude-Code-Harness 64,4 (Kwaipilot) | bf16-LoRA ~74 GB (MoE-QLoRA nicht empfohlen) |
| Qwen3-Coder-30B-A3B (bereits geladen) | Apache 2.0 | 17,7 GB | SWE-bench Verified 60,4 (Sept. 2025, ältester Stand) · schnellster MoE der Klasse (~173 tok/s est. RTX 4090) | Unsloth MoE-LoRA |
| Gemma 4 26B-A4B (MoE) | **Apache 2.0** (neu seit Apr. 2026) | 15 GB MXFP4 | im unabhängigen quantisierten iGPU-Test am konsistentesten (14/15 stabil, 4/10 schwer; quantunempfindlich) — während Qwen3.5-35B unter Quantisierung flaky war (256-Experten-MoE-Vermutung, unbelegt) | QLoRA-Guides von Google |
| Devstral Small 2 24B (dense, Mistral) | Apache 2.0 | ~18 GB | SWE-bench Verified 56,4 (llmrun-Tabelle) | Apache 2.0 |

Empfehlung Profil M: **Qwen3.8-27B** — nach Kartenlage das stärkste Modell
seiner Größe („strongest model for its size“, Unsloth Changelog 14.08.2026),
Apache 2.0, dicht (auf APU ohne MoE-Routing-Overhead robust), QLoRA-fähig.
Gemma 4 26B-A4B als Nicht-Qwen-Gegenprobe: im einzigen unabhängigen
Quantisierungs-Vergleich stabilster Kandidat. Qwen3-Coder-30B-A3B bleibt als
schneller Dauerläufer (läuft schon).

### Profil S — Planungs-/Split-Modell und Obergrenze

| Kandidat | Lizenz | Größe | Beleg | Anmerkung |
|---|---|---|---|---|
| **Halogen** (läuft schon): Qwen3.8-Flash-Next, 125B-A6B + 51B N-Gram + 4B MTP | **Qwen Community License 1.0** (nicht Apache) | ~94 GB IQ4_XS | SWE-bench Pro 62,5 · DeepSWE 58,7 · SWE-Multilingual 81,0 · Toolathlon 73,5 · NL2Repo 48,1 (Qwen-Karte) | stärkster agentic Score der lokal lauffähigen; Basismodell-Lizenz + Herkunft des „uncensored“-Finetunes ungeklärt |
| Qwen3.5-122B-A10B | Apache 2.0 | ~60–65 GB IQ4 | SWE-bench Verified 72,0 · TB 2 49,4 · LiveCodeBench 78,9 (Qwen-Karte) | läuft bereits auf demselben Host für ein anderes Projekt |

Für die Split-Szenarien (P84 T84.7) ist Halogen als Planungsmodell schon
messbar; als saubere Apache-2.0-Alternative stünde Qwen3.5-122B-A10B
bereit — Lastabgleich mit dem anderen Projekt nötig.

### Profil R — Router (P89 Spur B)

**Qwen3.5-0.8B / 2B** (Apache 2.0): klein, schnell, offizielle
Unsloth-Notebooks (bf16-LoRA 3–5 GB VRAM). Laut P89 §3.5 wird ein
Sprachmodell nur gewählt, wenn es gegenüber Tabelle/Klassifikator messbar
hilft — die 0,8B/2B sind die einzigen Kandidaten, die diese Schwelle
überhaupt kostengünstig prüfen lassen.

### Profil F — Finetuning-Basis (P89 Spur A)

- **Qwen3.8-27B**: beste dokumentierte Basis — dense, QLoRA ab 24 GB,
  RL-fähig, Apache 2.0. Öffentliche kostenlose Trainings-Notebooks (Kaggle
  2×T4, 30 h) existieren; auf evox2 selbst ist Training unrealistisch
  (kein ROCm, Vulkan-Inferenz), Unsloth kündigt AMD-Support an.
- Belegt, dass Harness-Finetuning einer Qwen-MoE-Basis wirkt:
  **KAT-Coder-V2.5** (Kwaipilot-Finetune von Qwen3.6-35B-A3B) —
  64,4 → 69,4 SWE-bench Verified im selben Claude-Code-Harness.
- MoE-Basen (Qwen3.6-35B-A3B): bf16-LoRA ~74 GB; MoE-QLoRA ist laut Unsloth
  nicht empfohlen (BitsandBytes-Limit) — QLoRA-4-bit-Checkpoints (NVFP4,
  40,2 GB statt 72,9) sind die Ausnahme.

## Tunbarkeit — Lizenz- und Werkzeuglage

| Modell | Lizenz | Tunen erlaubt | Werkzeug |
|---|---|---|---|
| Qwen3.5 (0.8B–122B), Qwen3.6, Qwen3.8-27B, Qwen3-Coder | Apache 2.0 | ja, uneingeschränkt | Unsloth (LoRA/QLoRA/RL), Export nach GGUF |
| Mellum2.1 | Apache 2.0 | ja | Transformers ≥ 5.11, GGUF offiziell |
| Gemma 4 | Apache 2.0 (seit Apr. 2026; Gemma 1–3 bleiben restriktiv) | ja, ohne Flow-Down-Klauseln | Google-QLoRA-Guides |
| gpt-oss-20b/120b | Apache 2.0 | ja | Unsloth MoE-LoRA |
| **Qwen3.8-Flash-Next (Halogen-Basis)** | **Qwen Community License 1.0** | intern ja; Benennungs-Pflicht ab 100 Mio. MAU/20 Mio. USD Umsatz, separate Lizenz für MaaS/„AI Work Assistant“ ab 50 Mio. USD | Unsloth-Unterstützung unklar (Experiment) |
| MiMo-V2.6 | MIT | ja | — |

P89 §3.1-Tabelle bleibt maßgeblich: **Ausgaben von Anthropic/OpenAI/z.ai
nicht zum Training**; lokal erlaubte Quellen sind obige Apache/MIT-Modelle.
Achtung für die aktuelle Halogen-Zelle: Basis-Lizenz (QCL 1.0) und
Finetune-Herkunft sind ungeprüft — vor P89 Spur A klären, wenn auf
Halogen-Läufen trainiert werden soll.

## Größenleiter für P87 Stufe 3 (Kipppunkt)

Vorschlag (Laden je nach Zustimmung; Halogen und qwen3-coder vorhanden):

1. Qwen3.5-2B (Router-Bedarf deckt mit ab) — ~2 GB
2. Qwen3.5-9B — ~7 GB
3. Mellum2.1-12B-A2.5B-Instruct — ~8 GB
4. Gemma 4 26B-A4B MXFP4 — 15 GB (Nicht-Qwen-Regulativ)
5. Qwen3.8-27B Q4 — ~18–24 GB
6. Qwen3.6-35B-A3B — ~24 GB
7. Qwen3.5-122B-A10B IQ4 — ~60–65 GB (Lastabgleich mit Fremdprojekt)
8. Halogen (Qwen3.8-Flash-Next IQ4_XS, läuft) — ~94 GB

Achtung: Qwen3.5-35B-A3B liegt im independent-Quantisierungstest unter
Gemma 4 — die Hybridarchitektur (Gated DeltaNet + 256-Experten-MoE) könnte
quantisierungsempfindlicher sein (Vermutung des Testers, unbelegt). Für die
Leiter bedeutet das: Quantisierung je Stufe im Fingerprint festhalten
(P87 §3.3 macht das ohnehin).

## Was das nicht sagt

- Alle Kartenwerte sind Herstellerangaben in deren eigenem Scaffold — außer
  Pi-Vergleich (JetBrains), iGPU-Quant-Vergleich (msf.blog), KAT-Coder
  (Kwaipilot), APEX (Reddit). Rangfolgen daraus sind Hypothesen.
- Nichts davon ist auf evox2/Strix Halo quantisiert gemessen; Vulkan-tok/s
  und Quantisierungsverluste liefert erst P87.
- Keine Aussage über Trainingskontamination der Benchmarks (SWE-bench
  Verified gilt als gesättigt; Public-Historie dieses Repos bleibt
  Risiko lt. P87-Premortem).
- PrismML „Ternary Bonsai 2.5“ (Qwen3.8-27B auf 5,93 GB, 75,6 SWE-bench
  Verified, selbstbericht) braucht einen Fork von llama.cpp — bewusst
  **nicht** vorgeschlagen (Laufzeit-Lock-in, kein unabhängiger Nachweis).

## Quellen (Abruf 27.11.2026)

- Qwen3.8-Flash-Next-Karte (HF) + Tech-Report + Alibaba-Release;
  QwenLM/Qwen3.8-GitHub; Unsloth-Changelog und -Guides (Qwen3.5/3.8, MoE);
  JetBrains-Blog und Mellum2.1-Karten (HF); Google-Blog + HF zu Gemma 4;
  msf.github.io (quantisierter iGPU-Vergleich, Apr. 2026); llmrun
  (SWE-bench-local-Leaderboard, Nov. 2026); dreaming.press (Nov. 2026);
  vanikedge (Qwen3.6/3.8-Kartenwerte); Kwaipilot via LLMCheck; refusalrate;
  TechTimes (PrismML, 26.11.2026); Reddit r/LocalLLaMA (APEX, Feb. 2026);
  MarkTechPost (Mellum2.1).

# Example adapter: OpenAI-compatible endpoint

Zeigt, wie man **einen eigenen Endpunkt** (Provider, Coding-Tool oder lokales
Coding-System) an den Hub anbindet — ohne den Hub selbst anzufassen.

Kompatibel mit allem, was `/v1/chat/completions` (Streaming) spricht:
llama.cpp server · LM Studio · Ollama · vLLM · Gateway-Proxys.

## Anbinden

1. Config erweitern (Datei: `hub.config.json`, liegt neben dem Adapter-Pfad):

```json
{
  "adapters": [
    {
      "id": "my-endpoint",
      "module": "./examples/adapters/openai-compat/adapter.ts",
      "config": {
        "baseUrl": "http://127.0.0.1:8080/v1",
        "model": "qwen2.5-coder:14b",
        "apiKeyEnv": "LOCAL_LLM_API_KEY"
      }
    }
  ]
}
```

2. Hub neu starten — der Adapter erscheint in `GET /api/adapters` und in der
   Session-Erstellung der PWA.

3. Contract-Tests laufen lassen (Pflicht vor Contribution):

```ts
import { runContractTests, assertContractGreen } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "./adapter.ts";

const results = await runContractTests(createAdapter);
assertContractGreen(results);
```

## Beispiel: DeepSeek (T3.14)

DeepSeek braucht **keinen eigenen Adapter** — die API ist laut DeepSeeks
eigener Dokumentation OpenAI-kompatibel, derselbe `adapter.ts` reicht, nur
mit anderer Config:

```json
{
  "adapters": [
    {
      "id": "deepseek",
      "module": "./examples/adapters/openai-compat/adapter.ts",
      "config": {
        "baseUrl": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "apiKeyEnv": "DEEPSEEK_API_KEY"
      }
    }
  ]
}
```

**Ehrlich unproven:** In dieser Umgebung liegt kein `DEEPSEEK_API_KEY` vor,
also wurde nie ein echter Request gegen `api.deepseek.com` gefahren — Adresse
und Modellname sind aus DeepSeeks öffentlicher API-Doku übernommen, nicht
live verifiziert. Ohne Key läuft `runCompletion()` real gegen den Endpunkt,
bekommt aber einen echten `401`, der als `error`-Event sichtbar wird (kein
stiller Fehlschlag) — sobald ein Key vorliegt, ist die Prüfung ein reiner
Config-Wert, kein Codepfad, der noch fehlt.

## Regeln

- Nur `@ancientvoid/contracts` importieren — alles andere kommt über `AdapterContext`.
- Große Outputs (Reasoning, Tool-Output) via `ctx.blob()` auslagern (K5).
- `ctx.signal` respektieren — Stop/Park muss sofort durchgreifen.
- `capabilities()` ehrlich ausfüllen — sie ist ein Versprechen, kein Marketing.

## Compaction

**Einstellungen → Dienste → AncientVoid-Compaction** aktiviert die
automatische Kürzung älterer, wortgleicher Assistentenantworten. Ein
`/compact` in der laufenden Session fordert die Kürzung für die nächste
Antwort an. Der Adapter behält den vollständigen Verlauf im Handle und
meldet die eingesparten Bytes im Session-Verlauf.

# Harness-Matrix (ADR-0018)

**Art:** referenz

Was jede Session eines Harness wirklich kann. Das ersetzt „Steer vorhanden“.
Die Spalten entsprechen `capabilities().features` bei **Standard-Konfiguration**
des Adapters. `npm run check:adapter-matrix` vergleicht diese Tabelle mit dem
Code und bricht bei Abweichung ab.

Zeichen: ✓ kann es, — kann es nicht. Tool-Gate: `native` fragt pro Tool,
`sandbox` Tools in OS-Sandbox ohne Nachfrage, `allowlist` feste Liste ohne
Nachfrage, `bypass` alles ungefragt, `none` keine Tools unter Kontrolle
dieser Session. Command-Geltung: `start` beim Start, `steer` im
Folgezug und `both` in beiden Fällen. Die Tabelle beschreibt die
Deklarationen. Live-Belege stehen bei den jeweiligen Adapterpfaden.

<!-- harness-matrix:start -->
| Adapter | geprüfte CLI | Folgeprompt | Anhalten | Tool-Gate | Rückfragen | Modellwahl | Agenten | Bilder | Dateien | Abzweig | Modell wechseln | Modi | Skills | Commands (scope) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude | 2.1.280 | ✓ | ✓ | native | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | auto, manual, plan, acceptEdits, dontAsk, bypassPermissions | ✓ | `/clear:both`, `/compact:both` |
| codex | 0.156.1 `app-server` | ✓ | ✓ | native | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | `/compact:steer` |
| opencode | 1.18.32 | ✓ | ✓ | allowlist | — | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ | — |
| copilot | 1.0.88 | ✓ | ✓ | bypass | — | ✓ | ✓ | — | — | — | — | — | — | — |
| pi | pi coding agent 1.4.0 (`pi -p`), 2026-10-26 | ✓ | ✓ | bypass | — | ✓ | — | — | — | — | — | — | — | `/compact:steer` |
| aider | 0.86.2 | — | ✓ | bypass | — | ✓ | — | — | — | — | — | — | — | `/clear:start`, `/reset:start`, `/add:start`, `/tokens:start` |
| hermes | hermes-agent venv, 03.10.2026 | ✓ | ✓ | bypass | — | ✓ | — | — | — | — | — | — | — | — |
| cursor-clip | Cursor state.vscdb | — | — | none | — | — | — | — | — | — | — | — | — | — |
| claude-clip | Transcript JSONL | — | — | none | — | — | — | — | — | — | — | — | — | — |
| dummy | — | ✓ | ✓ | none | — | — | — | — | — | — | — | — | — | `/compact:both` |
| acp · copilot | 1.0.88 `--acp` | ✓ | ✓ | native | — | — | — | ✓ | ✓ | — | — | — | — | `/compact:both`, `/usage:both` |
| acp · opencode | 1.18.32 `acp` | ✓ | ✓ | native | — | ✓ | — | ✓ | ✓ | — | ✓ | — | — | `/init:both`, `/review:both`, `/compact:both` |
| acp · dsh | 0.2.1-rc.2 `--profile acp` | ✓ | ✓ | native | — | ✓ | — | — | ✓ | — | ✓ | — | — | — |
| acp · maki | 0.6.5 `maki acp` | ✓ | ✓ | native | — | ✓ | — | ✓ | ✓ | — | ✓ | — | — | — |
| codex · exec | `codex exec` | ✓ | ✓ | sandbox | — | ✓ | — | — | — | — | — | — | — | — |
| cursor | `cursor-agent -p` | ✓ | ✓ | allowlist | — | ✓ | — | — | — | — | — | — | — | — |
| acp · omp | `omp acp` | ✓ | ✓ | native | — | ✓ | — | ✓ | ✓ | — | ✓ | — | — | `/new:both`, `/compact:both` |
| acp · maki mit Brücke | `bridgeCommands: true` | ✓ | ✓ | native | — | ✓ | — | ✓ | ✓ | — | ✓ | — | — | `/new:both` |
| acp · eigener Befehl | generischer ACP-Adapter | ✓ | ✓ | native | — | ✓ | — | ✓ | ✓ | — | ✓ | — | — | — |
| OpenAI-kompatibler Direktadapter | Chat Completions SSE | ✓ | — | none | — | — | — | — | — | — | — | — | — | `/compact:steer` |
<!-- harness-matrix:end -->

## Belege je Zeile

- **claude:** Modus und Modell (ADR-0033): `--permission-mode` und `--model` bei jedem Spawn, auch
  bei `--resume` (gegen claude 2.1.288 geprüft: Haiku→Sonnet, Modus `auto`, gleiche Session-ID),
  `adapter.test.ts` „ADR-0033“. Folgeprompt/Anhalten über `--resume` bzw. Prozessende:
  `packages/adapters/claude/test/adapter.test.ts` gegen echte Captures
  (`test/fixtures/*.jsonl`), E2E `session.spec.ts`. Modellwahl: Kürzel aus
  `claude --help` (2.1.280). Agent: `--agent` (ADR-0005). Tool-Gate
  `native` (T7.2): `--permission-prompt-tool` über die MCP-Brücke des Hubs,
  Rückfragen (`AskUserQuestion`) auf demselben Weg — Hub-Integration
  `apps/hub/test/modules/approvals/tool-permissions.test.ts`, Brücke
  `apps/gateway-mcp/test/permission.test.ts`, E2E `harness.spec.ts` (Erlauben,
  Ablehnen, Rückfrage). `permissionPrompts: "off"` → `allowlist`,
  `--dangerously-skip-permissions` → `bypass`.
- **codex:** Standard ist seit T7.2 `mode: "app-server"` — ein dauerhafter
  `codex app-server` je Session: Befehle und Dateiänderungen fragen vorher
  (`approvalPolicy: "untrusted"`, nie „für die Session erlauben“), Rückfragen
  (`request_user_input`), Modellkatalog (`model/list`), Kontingent
  (`account/rateLimits`, 5 h und 7 Tage). Belege: `test/app-server.test.ts`
  (nachgebauter app-server, echtes v2-Protokoll), Live-Messlauf
  `scripts/messlauf-p7.mjs codex-gate` mit codex-cli 0.156.1 — Erlauben schreibt
  die Datei, Ablehnen verhindert sie (2026-09-24). `mode: "exec"` bleibt:
  ein Prozess pro Zug, fragt nie, Tools in `workspace-write` (`sandbox`).
- **opencode:** `--session` für Folgeprompts (`test/fixtures/*.jsonl`), `--agent`,
  Modellkatalog `opencode models` (15 Modelle am 2026-09-23). `opencode run`
  lehnt `ask` automatisch ab, niemand wird gefragt (Live-Versuch 2026-09-23).
  `--auto` macht daraus `bypass`.
- **copilot:** läuft im Skriptbetrieb nur mit `--allow-all-tools`
  (`test/fixtures/tool-*.jsonl`).
- **aider:** Folgeprompt nicht verdrahtet (`steer(prompt)` lehnt ab), `--yes-always`.
- **cursor-clip / claude-clip:** nur lesend, siehe jeweilige Adapter-Tests.
- **acp (T7.2):** ein Adapter für jeden Agent-Client-Protocol-Harness,
  dauerhafter Agent-Prozess (tmux-Pipe-Modus), `session/request_permission` →
  Handy, nie „immer erlauben“. Belege: `packages/adapters/acp/test/*`
  (echter Agent-Prozess, Vertrags-Suite), E2E `harness.spec.ts` (Freigabe,
  Übernahme nach SIGKILL), Live-Messlauf `scripts/messlauf-p7.mjs acp-gate`:
  **copilot 1.0.88** und **opencode 1.18.32** — Erlauben schreibt die Datei,
  Ablehnen verhindert sie (2026-09-24). Das opencode-Preset setzt
  `permission: ask` für edit/bash/webfetch, sonst würde opencode ungefragt
  ausführen. **dsh 0.1.5-rc.3 (T7.5):** Preset setzt
  `DSH_PERMISSION_MODE=read-only` — Lesen läuft in dsh' OS-Sandbox, jeder
  Befehl, der mehr braucht, fragt per `request_permission` (nur mit
  `toolCallId`; der Adapter ergänzt Befehl und Titel aus dem vorigen
  `tool_call`). Live mit lokalem Modell (gpubox, llama.cpp): Erlauben schreibt
  die Datei, Fehlschlag kommt als Fehler an
  ([Messlauf](messlauf/2026-09-24-p7-harness-gates.md)).
  **Modellwahl:** `session/set_config_option` (Kategorie `model`) bzw. das
  ältere `session/set_model`; ein Modell, das der Agent nicht anbietet,
  bricht den Start ab. Live belegt mit dsh (`["gpubox","qwen3-coder"]`) und
  opencode 1.18.32 (15 Modelle, Wechsel per `set_config_option`). copilot
  1.0.88 bietet über ACP keine Modellwahl an (live geprüft) — Zelle „—“.

## Anhänge (T7.10, ADR-0022)

„Bilder“/„Dateien“ ✓ heißt: der Harness bekommt die Datei selbst — claude
liest Bilder und PDFs über den Pfad (`--add-dir`), codex bekommt Bilder als
`localImage`, opencode Bilder und PDFs über `-f`, ACP-Agenten Bilder als
Bildblock, wenn sie es beim `initialize` anbieten. Alles andere (und jeder
Harness ohne ✓) bekommt den ausgelesenen Text im Prompt — lokal über
pdftotext, tesseract (deu+eng) und die Office-XML, sonst über Gemini, wenn
ein Schlüssel hinterlegt ist. Belege: `packages/core/test/modules/attachments/extract.test.ts`
(echte PNG/PDF/DOCX/XLSX/CSV), Adapter-Tests je Weg.

## Live-Konfiguration auf workstation (Stand 2026-09-23)

Der Heim-Hub weicht von der Standard-Konfiguration ab: claude mit
`--dangerously-skip-permissions` und opencode mit `--auto` laufen dort als
`bypass`. Die PWA warnt beim Start und auf der Status-Seite. Claude kann
`native` laufen, sobald das Skip-Flag aus `hub.config.json` entfernt ist
(Umstellung nach dem Live-Messlauf, T7.2).

## Direktadapter und geplante Adapter

- `deepseek`/`local-llm` über `examples/adapters/openai-compat`: Modell-Endpunkt
  ohne Tools (`toolGate: none`), kein Coding-Harness. Mit Tools läuft das
  lokale Modell über opencode oder dsh (Zeilen `acp · …`,
  [local-llm.md](local-llm.md)).
- `swarm`: kommt mit T7.5.

**maki (2026-10-27):** `preset: "maki"` startet `maki acp` (Rechte-Abfragen im Client, `question` als ACP-Formular). Installation `~/.local/bin/maki`. Provider-Plan und Thinking stehen in `~/.config/maki/providers.toml` (`[zai] plan = "coding"`) und `init.lua` (`always_thinking = "high"`, GLM-5.3 verlangt low/high/max). Der Key kommt per `envFiles: { ZHIPU_API_KEY: "~/.config/ancientvoid/glm-coding.key" }`. Live: Hub-Session antwortet „OK“ (glm-5.3).

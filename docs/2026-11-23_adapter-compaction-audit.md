# Compaction in AncientVoid — 23.11.2026

Bestandsaufnahme für den Arbeitsstand `2a7eab27`. Grundlage sind die
Adapter-Factorys, die ACP-Presets, das OpenAI-kompatible Adapterbeispiel
und die Dokumentation der jeweiligen Harnesses. Der Hub lädt Adapter aus
der Konfiguration. Die lokale CLI-Version allein belegt keine produktive
Einstellung und keinen erfolgreichen Compaction-Lauf.

## Befund je Adapterpfad

| Pfad | Nachweis in AncientVoid | Was der Harness anbietet |
|---|---|---|
| Claude CLI | `/compact` ist in [capabilities()](../packages/adapters/claude/src/index.ts) bei Start und im Folgezug deklariert. Der native Verlauf gehört Claude. | Automatische Compaction nahe dem Fensterlimit und manuelle Zusammenfassung in [Claude Code](https://code.claude.com/docs/en/how-claude-code-works). |
| Codex App Server / Exec | Native Threads werden fortgesetzt. [Der App-Server-Normalizer](../packages/adapters/codex/src/app-server-events.ts) erkennt `contextCompaction` und gibt dazu kein Hub-Event aus. Im Adapter ist kein manueller Compaction-RPC verdrahtet. | Der [App Server](https://developers.openai.com/codex/app-server/) dokumentiert `thread/compact/start` und eigene Progress-Events. Die [Responses-API](https://developers.openai.com/api/docs/guides/compaction) hat zusätzlich providerseitige Compaction für unterstützte Routen. |
| OpenCode CLI / ACP | Der [CLI-Pfad](../packages/adapters/opencode/src/index.ts) setzt native Sessions fort. Der [ACP-Preset](../packages/adapters/acp/src/index.ts) deklariert `/compact` und dokumentiert einen Live-Beleg für Start und Ende. | [OpenCode](https://opencode.ai/docs/compaction/) dokumentiert Auto- und manuelle Compaction, einen geschützten jüngeren Ausschnitt sowie versionsabhängige Regeln für den Puffer. |
| Copilot CLI / ACP | Der [CLI-Pfad](../packages/adapters/copilot/src/index.ts) nutzt native Fortsetzung. Der ACP-Preset bietet `/compact` an. Von der Deklaration allein ist der Lauf auf einem konkreten Host unbelegt. | [Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) bietet `/compact` mit optionalem Fokus. [GitHub](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/cli-best-practices) dokumentiert auch automatische Checkpoints. |
| Pi | Der [Normalizer](../packages/adapters/pi/src/normalize.ts) verarbeitet `compaction_start/end`. Die Ereignisse sind eine Schnittstelle, aus der sich ohne passende End-to-End-Daten weder die tatsächliche Konfiguration noch die Tokenersparnis ergibt. | [Pi](https://docs.pi.dev/latest/compaction) dokumentiert Auto-Compaction, einen reservierten Puffer, unveränderte jüngere Nachrichten und einen optionalen Fokus. Die [RPC-Doku](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md) unterscheidet geschätzten Kontext nachher von Usage für den Summary-Aufruf. |
| OMP über ACP | Der ACP-Preset deklariert `/compact`. Hub-seitige Kennzahlen je Methode und abgeschlossener Compaction sind unbelegt. | [Oh My Pi](https://github.com/can1357/oh-my-pi/blob/main/docs/compaction.md) bietet mehrere versionsabhängige Strategien und eigene ACP-Notifications. |
| Maki über ACP | Der Hub deklariert bei aktivierter Brücke `/new`. Das erzeugt eine neue Session. `/compact` ist in diesem Hub-Pfad unbelegt. | [Maki](https://maki.sh/docs/context/) dokumentiert native Auto-Compaction und den manuellen Befehl für den Harness. |
| Hermes CLI | Der [Adapter](../packages/adapters/hermes/src/index.ts) benutzt natives `--resume`. Compaction-Einstellung, Anzahl und Netto-Tokenersparnis sind im Hub nicht separat belegt. | [Hermes](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching) dokumentiert Pruning alter Tool-Ergebnisse, geschützte aktuelle Runden und strukturierte Summaries. Den Stand eines lokal abweichenden Builds muss ein Fixture belegen. |
| Cursor Agent CLI / Cursor Clip / Claude Clip | Der [Cursor-CLI-Adapter](../packages/adapters/cursor/src/index.ts) setzt nativ fort und bietet keinen eigenen Compaction-Befehl an. Die Clips beobachten Transkripte und können deren Kontext nicht steuern. | Der [Cursor CLI](https://cursor.com/docs/cli/reference/slash-commands) beschreibt `/summarize` bzw. `/compress`. [Cursor Hooks](https://cursor.com/docs/hooks) unterscheiden automatische und manuelle Compaction. |
| Aider | Der [Adapter](../packages/adapters/aider/src/index.ts) hat derzeit keinen Folgeprompt. Die Start-Kommandos enthalten `/clear` als Reset des Verlaufs. | [Aider](https://aider.chat/docs/config/aider_conf.html) fasst Chat-Historie oberhalb des konfigurierbaren Limits zusammen. Langlauf-Nutzen über den derzeitigen Hub-Pfad ist unbelegt. |
| dsh und benutzerdefinierte ACP-Prozesse | Für dsh gibt es keine im Hub belegte Compaction. Ein ACP-Preset oder ein kompatibler Transport allein belegt keine Laufzeiteinstellung. | Versions- und Provider-spezifisch. |
| OpenAI-kompatibles Beispiel, u. a. `local-llm` und `deepseek` | [Der Adapter](../examples/adapters/openai-compat/adapter.ts) hängt Nachrichten im In-Memory-Verlauf an und sendet die Historie bei jedem Folgeaufruf. Eine Kürzung oder Verdichtung dieses Verlaufs fehlt. | Hier wäre eine kontrollierbare Integrationsstelle im Adapter vorhanden. |
| Dummy, Loop- und Drittadapter | Dummy meldet `/compact` als Testdouble. Loop-Connectoren spiegeln bzw. orchestrieren darunterliegende Harnesses. Zusätzliche Adapter müssen je Factory, Version und Modus beurteilt werden. | Kein gemeinsamer Provider-Request im Hub. |

`npm run check:adapter-matrix` hat zehn Factorys gegen die bestehende
Capabilities-Matrix geprüft. Die Matrix deckt die dort geprüften
Fähigkeiten ab. Eine zusätzliche direkte `capabilities()`-Probe über 17
Factory-/Preset-Kombinationen fand `/compact` bei Claude, ACP-Copilot,
ACP-OpenCode und ACP-OMP sowie beim Dummy. Die Probe misst weder
automatische Compaction noch Tokenersparnis. `--version`
lief ohne Modellaufrufe unter anderem für Claude 2.1.330, Codex 0.171.0,
Copilot 1.0.114, Pi 1.6.0, OMP 19.1.0, Maki 0.6.5, Hermes 0.21.0 mit
lokalen Änderungen, Aider 0.86.2 und Cursor Agent 2026.11.22-e9042b2.
Für OpenCode und dsh lieferte die Probe keine Versionszeile.

## Empfohlene Reihenfolge für hohe Qualität bei niedrigen Kosten

1. **Weniger Kontext erzeugen.** Deterministische Aufgaben wie Validierung,
   Zählen, Filtern, Formatieren und Regressionstests mit Skripten erledigen.
   Große Ausgaben gezielt abfragen oder als abrufbares Artefakt speichern.
   Der Prompt trägt Ergebnis, fundierte Fundstellen und die nächsten
   Entscheidungen. Der vorhandene Skill-Ratchet und P72s Kurator sind
   Beispiele. In der Forschung ist Just-in-time Retrieval ein bewährtes
   Muster. [Anthropic Context Engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
2. **Ältere Tool-Ergebnisse deterministisch ausdünnen, wenn verfügbar.**
   Bei einem kontrollierbaren LLM-Aufruf alte oder doppelte Beobachtungen
   durch kleine Marker mit dauerhaftem Abrufpfad ersetzen. Ziel, Nutzerregeln,
   Entscheidungen, Fehlerzeilen, Dateipfade und aktuelle Tool-Aufruf-/Antwortpaare
   schützen. Ein Abruf muss die Originalbytes nach Restart liefern.
   Der SWE-bench-Vergleich bietet dafür stärkere unabhängige Evidenz als
   eine Hersteller-Sparquote. Seine Ergebnisse gelten für den untersuchten
   Agenten und Benchmark. [The Complexity Trap](https://arxiv.org/abs/2508.21433)
3. **Native Compaction bei echtem Kontextdruck einsetzen.** Provider- und
   Harness-eigene Pfade kennen Sessionzustand und Tool-Protokoll. Einen
   Tokenpuffer für den nächsten Zug lassen und automatische wie manuelle
   Aufrufe pro Adapterversion belegen. Eine stabile Instruktionspräfixfolge
   begünstigt Cache-Wiederverwendung. Separat messen, ob die Summary, der
   erneute Prefill oder zusätzliche Retrieval-Züge die Ersparnis auffressen.
   [OpenAI Prefix-Caching](https://developers.openai.com/api/docs/guides/keep-prefix-unchanged)
4. **Bei einem Aufgabenwechsel mit kleinem, überprüfbarem Handoff neu
   starten.** Ziel, Branch/Commit, Entscheidungen, Testbefehle mit Ergebnis,
   offene Befunde und Dateipfade aus Git, Taskliste und Testergebnissen
   ableiten. Wenn Prosa nötig ist, sichern exakte Quellenlinks die Details.
   Wiederholtes freies Umschreiben derselben Summary erhöht das Risiko von
   Informationsverlust. [Anthropic Context Engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)

**Headroom/CCR** ist ein Kandidat für einen begrenzten Versuch an
kontrollierbaren Tool-Ausgaben. Die Originale müssen zuverlässig
wiederauffindbar bleiben. Der Hub besitzt derzeit keinen universellen Hook
vor jedem Provider-Request der externen CLI/ACP-Harnesses. Der dafür
vorgesehene P55-Entwurf hängt an P30/P31. **LLMLingua-2** ist eine weitere
experimentelle Vergleichsvariante für geeignete Textblöcke. Die
publizierten Benchmarks belegen keine unveränderte Qualität für exakte
Diffs, Fehlermeldungen oder AncientVoid-Sessions. [Headroom CCR](https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/ccr.mdx),
[LLMLingua-2](https://arxiv.org/abs/2403.12968)

## Was die Benchmarks tatsächlich zeigen

In SWE-bench Verified halbierte Observation Masking in der untersuchten
SWE-agent-Konfiguration die Kosten gegenüber dem Rohverlauf. Die Lösungsrate
lag auf dem Niveau der LLM-Zusammenfassung oder leicht darüber. Der
getestete Hybrid war dort nochmals günstiger. Der neuere CompAct-Bench
zeigt zugleich, dass aggressive Verdichtung selbst bei starken Modellen
relevante Zustände verfälschen kann. ACON demonstriert Vorteile optimierter
Zusammenfassungsregeln auf AppWorld, OfficeBench und QA. Das dort
gemessene Spitzenfenster ist eine andere Kennzahl als billige, erfolgreiche
Coding-Aufgaben. Für AncientVoid folgt daraus ein Qualitätskriterium vor
der Kostenoptimierung. [The Complexity Trap](https://arxiv.org/abs/2508.21433),
[CompAct-Bench](https://arxiv.org/abs/2611.25673),
[ACON (ICML 2026)](https://proceedings.mlr.press/v306/kang26b.html)

## Reproduzierbarer Qualitäts- und Kostenvergleich

- Variante A verwendet den nativen Standard. B lässt deterministisch
  kürzere Tool-Ausgaben einfließen. C ergänzt providerseitige oder
  reversible Compaction an einem nachweislich passenden Adapterpfad.
  Pro Harness und Modell paarweise dieselben Repos, Start-Commits und
  Aufgaben verwenden. Version, Einstellungen und warmen oder kalten Cache
  protokollieren. Stochastische Modellläufe brauchen Wiederholungen.
- Harte Kriterien ohne LLM-Judge prüfen: erlaubte Dateien, exakte
  Fehler-/Constraint-Wiedererkennung, Exitcodes, Regressionstests, korrektes
  Anknüpfen nach Restart, vollständige Originalabrufe und keine zusätzlichen
  unautorisierten Aktionen. Ergebnisse aus der Anwendung und dem Test-Hub
  erfassen. Reine Tool-Ausgabegröße ist kein Qualitätstest.
- Pro erfolgreich gelöster Aufgabe die relevanten providerseitigen Token
  für Eingang, Cache-Lese-/Schreibvorgänge, Ausgabe, Kompression und
  Retrieval erfassen. Fehlende Felder bleiben unbekannt und getrennt von
  Schätzungen. Gemessene Zeit und Zahl der Wiederholungen ergänzen.
  [AncientVoids Token-Aggregation](../packages/core/src/modules/sessions/token-totals.ts)
  unterscheidet bereits Cache-Lesevorgänge und Schätzungen.
- Eine Variante mit einem verlorenen harten Kriterium aussortieren.
  Unter gleich erfolgreichen Varianten den tatsächlichen Nettoverbrauch und
  die Laufzeit vergleichen. Die Auswertung kann vollständig durch Skripte
  laufen. Die eigentlichen Modellläufe dieser Vergleichsmessung wurden
  für den Audit nicht gestartet.

**Fazit:** Native Compaction ist in mehreren Adapterpfaden vorhanden.
Ein einheitlich beobachteter und als optimal belegter Stand über alle
Adapter fehlt. Für AncientVoid ist deterministisches Kürzen an der Quelle
plus selektive native Compaction die begründete Reihenfolge. Der
OpenAI-kompatible Direktadapter und Codex' derzeit ungenutzte
Compaction-Telemetrie sind zwei klar lokalisierte Ansatzpunkte.

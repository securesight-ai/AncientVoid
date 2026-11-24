---
id: BUG-0265
slug: kontextueberlauf-meldet-anmeldeproblem
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: ""
created: 2026-11-23
reporter: Kai
---

# BUG-0265 — Kontextüberlauf meldet „CLI ist nicht angemeldet"

## Gesehen

Banner in der Session „Garmin GTA VI": **Session benötigt eine Entscheidung —
Die CLI ist nicht (mehr) angemeldet oder der Schlüssel ist ungültig. Am PC neu
anmelden.** (Unterbrechung erkannt · 23.11.2026, 11:18:34). Nichts war
abgemeldet; die Pi-Instanz hat zur selben Zeit in einer anderen Session
weitergearbeitet.

## Erwartet

Die Meldung nennt die wirkliche Ursache — der Verlauf passt nicht mehr ins
Modell — und den Weg, der hilft (Übergabe in eine neue Session oder ein Modell
mit größerem Kontext). Ein Hinweis auf An-/Abmeldung ist hier eine Fährte ins
Leere.

## Repro

1. Hub auf Windows, Adapter `pi`, Modell mit 204 800 Tokens Kontext
   (`strata/qwen3.8-flash-next-iq3_s`).
2. Eine lange Sitzung führen, bis der Verlauf die Modellgrenze überschreitet.
3. Zug senden → Chat zeigt das Anmelde-Banner statt der Kontextmeldung.
   Nachweis aus dem EventStore, Sitzung `943797b3-a698-454d-a096-4e42fdab782a`,
   vier identische Rohfehler (seq 3969/4975/5777/6547):

       400: {"type":"invalid_request_error","message":"request exceeds the context
       window: prompt (237428 tokens) leaves no room to answer in the context
       (204800); requests are never truncated"}

   Klassifiziert als `category: "auth"` —gemessen in
   `data/sessions/943797b3-…/events.jsonl`.

## Ursache und Prüfung

`classifyProviderError` (ADR-0015) prüft Anmelde-Muster mit
`invalid.*(api.?key|token)` — das `.*` überbrückt den ganzen Text. In
`invalid_request_error` steht „invalid", und weiter hinten steht „tokens":
Treffer, Kategorie `auth`. Zwei der vier Fälle liefen zusätzlich auf `unknown`
(OpenAI-Formulierung „maximum context length is … tokens") — Rot-vor-Grün in
`packages/contracts/test/harness/provider-error.test.ts`: **6 failed |
18 passed**, davon einer explizit „expected 'auth' to be 'context'".

## Umgebung

Windows 11, Hub 127.0.0.1:7373, Adapter `pi`, Node 24. Mehrere Hub-Instanzen
waren **nicht** die Ursache: genau ein Hub-Prozess (`Get-CimInstance
Win32_Process`, PID 7188, Start 09:10:38).

## Tests

`packages/contracts/test/harness/provider-error.test.ts` — nach dem Fix
**24 passed**: vier Kontextformulierungen werden `context`, die Tokenzahlen
(237428 / 204800) stehen im Text, echte Anmeldefehler (`401 Unauthorized`,
`invalid api key provided`, `Not logged in · Please run /login`,
`authentication failure`, `403 forbidden`) bleiben `auth`.

## Eingrenzung

Contracts: neue Kategorie `context` (ADR-0115), scharfe `auth`-Regel,
Kontext-Prüfung **vor** quota/auth. Kein Adapter change, keine DB, keine
Migration. Ältere Clients zeigen den Klartext (unbekannte Kategorie fällt auf
`unknown`).

## Handoff

Fix im selben PR (Self-Review: `gates` → `pr-review`).

## Abschluss (2026-11-24)

Nachgestellt: `ProviderErrorCategory` kennt `context`, `CONTEXT_RE` prüft vor
quota/auth (`packages/contracts/src/harness/provider-error.ts:43,61`).
`npx vitest run packages/contracts/test/harness/provider-error.test.ts` →
24 passed. Fix im Stand (ADR-0115).

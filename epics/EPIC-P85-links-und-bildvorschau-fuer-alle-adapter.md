# EPIC-P85 — Externe Links im Standardbrowser; Bildvorschau modular für alle Adapter

**Status:** Planungsentwurf (Nutzerauftrag 25.11.2026) · **Phase:** P85 · **Dauer:** 1–2 Agenten-Wochen · **Tracker:** [#441](https://github.com/securesight-ai/AncientVoid/issues/441); Defekt [BUG-0290 / #440](https://github.com/securesight-ai/AncientVoid/issues/440)
**Abhängigkeit:** Epic-Gating regulär (P82 grün als letztes abgeschlossene Phase; P83/P84 sind Planungsentwürfe, P30/P31 bleiben On hold und unberührt). Der ausdrückliche Planungsauftrag erlaubt den Entwurf vor grünen Vorgängern, keine Umsetzung. Geräteabnahme → [P000](EPIC-000-testsuite-fuer-menschen.md).

## 1. Ziel

Zwei Nutzerbefunde vom 25.11.2026, zusammengefasst:

1. **Links.** Ein Link im Chat öffnet auf den genutzten Endgeräten nicht den
   Standardbrowser. Zielzustand: Ein Klick auf einen externen Link führt
   garantiert dorthin, wo der Nutzer erwartet hinzukommen (Standardbrowser),
   auf jedem unterstützten Client-Weg; eigene Hub-Links bleiben
   in-app (Vollbild/Route, wie [`docs/bild-links-fuer-agenten.md`](../docs/bild-links-fuer-agenten.md)
   es verspricht). Was ein Weg nicht kann, bleibt sichtbar — nie still.
   PRD §9: K2/K6/K10; Fail-loud-Regel AGENTS.md.
2. **Bildvorschau für alle.** Das Pi-Feature (Bild gelesen → Mini-Screenshot
   im Chat, anklickbar, Vollbild; Nutzerfund 23.11.2026,
   `apps/pwa/src/features/session/tool-image.ts`) funktioniert heute nur für
   pi-artige Ereignisse. Ziel: dieselbe Vorschau für jede Adapter-Familie,
   deren Ereignisse Bildpfade tragen — und eine **modulare Registry**, damit
   weitere Familien nach und nach als Daten eingetragen werden, nicht als
   Sonderfälle im Chat-Renderer. K3/K5/K7; F-Referenz: Funktionsinventar S82.

**Kein Ziel:** Adapter-Payloads umzubauen (Vertragsstabilität; der Resolver
im Client ist tolerant), native Clients (P32 bleibt vertagt), Bildvorschau für
Adapter ohne feingranulare Tool-Events (aider/hermes/jsonrpc — sichtbare
Grenze, §3.3).

## 2. Scope (In / Out)

**In:** Evidenzmatrix Link-Klick pro Client-Weg; zentrale Link-Klick-Policy
(im App-Ursprung bleiben vs. Standardbrowser); Plattformpfade für installierte
PWAs; gemeinschaftlicher Tool-Resolver (Namensauflösung + Pfad-Schlüssel) aus
`turns.ts` auch für `tool-image.ts`; deklarative Visualizer-Registry mit
Tests je Adapter-Familie; Doku-Fortschreibung.

**Out:** Umbau der Adapter-Normalisierung (`name` vs. `tool` bleibt, solange
der Contract es erlaubt — Änderungen am Adapter-Contract bräuchten ein ADR);
Bildvorschau auf fremden Hosts (`sessionRefFor`-Grenze bleibt); OCR/Auslese
(T7.10, BUG-0266/0267, unberührt); nativer Mobile-Client; neue Manifests
(P77).

## 3. Design-Details

### 3.1 Bestand Links (Code-Sichtung 25.11.2026)

- `apps/pwa/src/shared/Markdown.tsx` rendert Links mit
  `target="_blank" rel="noopener noreferrer nofollow"`; nacktes Linking und
  `SAFE_HREF` (nur http(s)/mailto) sind in `shared/markdown.ts` +
  `test/shared/markdown.test.ts` abgedeckt. Im normalen Browser-Tab ist das
  damit korrekt — der gemeldete Defekt ist ein Verhalten der Client-Wege.
- Installierte App: `shared/device-status.ts` erkennt `display-mode:
  standalone` bereits. Plattformverhalten ist **hypothetisch und zu belegen**
  (nicht nachgebaut): Android-WebAPK/Chrome öffnet Klicks aus der App
  vermutlich in App-Fenstern statt im Standardbrowser; iOS-Home-Screen-Web-App
  ignoriert `target="_blank"` traditionell; im Desktop-Browser-Tab wird ein
  zweiter Tab erwartet. Diese drei Wege (plus evtl. genutzte Browser-Kombis)
  messen, nicht glauben — Muster wie P77 §3.2.
- Eigene Links (`https://<hub>/#/…`, `#/anhang/<id>`): aus dem Chat sollen sie
  der vorhandenen In-App-Route folgen (`app/route.ts` `attachmentHash`), nicht
  ein zweites Fenster öffnen.
- berührt auch: `EventRow.tsx` `ToolImageView`-Link (`target="_blank"` auf die
  Roh-Route) und `onCardClick`-Ausparung für `a` (Zeile 199–203) — die
  Klick-Kette muss bei einer zentralen Policy mitgedacht werden.
- Der Defekt ist als [BUG-0290](../bugs/bug-0290-chatlink-geht-nicht-im-standardbrowser-auf.md)
  erfasst; dieses Epic arbeitet ihn ab.

### 3.2 Link-Klick-Policy (Vorschlag, nach Evidenz zu bestätigen)

Eine Stelle klassifiziert vor dem Klick (Renderer unverändert lassen heißt:
ein zentraler Klick-Handler am Markdown-Container, identische Rule für Chat-Zeilen,
Bildvorschau-Links und künftige Renderer):

1. **Gleicher Hub-Ursprung** (Hash-Route des eigenen Hubs) → In-App-Navigation
   über den bestehenden Router (`location.hash`), kein neues Fenster.
2. **Externer Link, Browser-Tab-Modus** → bestehendes `target="_blank"` (behält den
   Testschutz aus `markdown.test.ts`).
3. **Externer Link, standalone/installiert** → Plattformweg aus der
   Evidenzmatrix (Kandidaten: Android `intent://…#Intent;action=
   android.intent.action.VIEW;S.browser_fallback_url=…;end`; iOS kein
   verlässliches Fenster-Ziel ⇒ sichtbarer Fallback: „Im Browser öffnen“-Sheet
   bzw. URL-Kopieren — niemals nur nichts tun).
4. **Alles andere** (mailto, bekannte Fremd-Origin-Muster) bleibt unverändert.

Fail loud: kann ein Weg das Fenster nicht nachweislich öffnen, gibt es eine
sichtbare Rückmeldung mit URL (Toast/Sheet mit Kopieren), keinen stillen Drop.

### 3.3 Stand Bildvorschau je Adapter-Familie (Code-Sichtung 25.11.2026)

Heutige Weiche in `tool-image.ts`: direkte Vorschau nur bei exakt
`payload.name === "read"` (case-sensitive, `name`-Schlüssel); Shell-Trefferliste
`bash|shell|exec|exec_command|local_shell_call|container.exec` liest ebenfalls
nur `payload.name` (immerhin lowercase-verglichen); Pfad-Schlüssel bereits
`path|file_path|file|filePath`; Vorschau nur für eigene Hub-Sitzungen
(`sessionRefFor`, hostId-Vergleich — Feldbefund-Fix vom 23.11. bleibt).

| Familie | tool_use-Payload (real) | heute | Weg zur Parität |
|---|---|---|---|
| pi | `name:"read"`, `input.path` | ✅ | Referenzfall, unverändert |
| claude / claude-clip / cursor (stream-json) | `name:"Read"`, `input.file_path` | ❌ | Alias case-insensitiv (`KIND_RULES`-Lesart) |
| codex | `name:"view_image"`, `input.path` | ❌ | Alias `view_image` |
| opencode / copilot / cursor-clip | **Schlüssel `tool`** statt `name` | ❌ (direkt + Shell-Scan blind) | gemeinsamen `toolName()`-Resolver (name∨tool∨command) nutzen |
| acp (cp-Provider) | `name` frei, `kind:"read"` vorhanden | ❌ | `kind` als Match-Signal aufnehmen |
| aider / hermes / jsonrpc / dummy | keine feingranularen tool_use-Ereignisse bzw. nur Echo | ❌ prinzipbedingt | sichtbare Grenze (Doku), kein Sonderfall im Code |

### 3.4 Modulare Registry (Kern des Auftrags)

`tool-image.ts` wird ein Konsument einer deklarativen Registry
(`apps/pwa/src/features/session/visualizers/`, PWA-shared; kein
Contract-/Adapter-Wechsel, keine ADR-Pflicht):

```
{ id, match: { namePattern /* case-insensitiv */ | kind }, inputPathKeys: [...], enabled }
```

- Erste Einträge: `read-family` (Aliases aus `turns.ts` KIND_RULES-Zeile
  `read|view|cat|open|read_file|readfile|notebookread|view_image` + `kind:
  read` für ACP), `shell-family` (heutige Liste + Resolver-Fallback), je
  Familie testbar über `apps/pwa/test/fixtures/turns/`-Fixtures.
- `turns.ts` (`toolName()`, `inputOf()`) wird die gemeinsame
  Namens-/Eingabe-Auflösung; `tool-image.ts` und `EventRow` konsumieren sie —
  keine zweite, abweichende Implementierung.
- Eingebaute Grenzen bleiben unverändert: nur Pfade, die der Hub liefern kann
  (Projekt-/Sitzungswurzel, kein `..`, K5, MAX_VORSCHLAEGE mit sichtbarem
  „nicht gezeigt“-Zähler). Neue Familien = neuer Registry-Eintrag + Fixture,
  kein Renderer-Code.

## 4. Aufgaben

- [ ] **T85.1 — Evidenzmatrix Link-Klick** (Code-Sichtung §3.1 als Ausgang;
  Matrix `supported | unsupported | not_run` mit Datum/Gerät/Installationsart
  für Desktop-Browser, Android installiert, iOS Home-Screen, Browser-Tab):
  messen wo `target="_blank"` heute landet; Emulation genügt nicht für
  OS-Verhalten — Geräteläufe nach P000 delegieren (Gerätetermin notieren).
  Ohne Messung kein Plattform-Claim.
- [ ] **T85.2 — Zentrale Link-Klick-Policy** §3.2: Klassifizierung +
  Behandlung an einer Stelle; rote Tests zuerst (`markdown.test.ts` um
  Klassifizierung erweitern, Unit für Policy-Entscheidung; E2E in der Spur
  von `anhang-bilder.spec.ts`: eigener Link bleibt in-app; externer Link im
  Browser-Modus neuer Tab).
- [ ] **T85.3 — Plattformwege** solo aus T85.1-Evidenz (intent-URI /
  sichtbarer Fallback); Fail-loud-Rückmeldung; `fixes BUG-0290`.
- [ ] **T85.4 — Gemeinsamen Tool-Resolver** aus `turns.ts` wiederverwenden:
  `tool-image.ts` auf Resolver umstellen (name-Exaktheit fällt; `tool`-Schlüssel
  werden sichtbar). Rote Tests zuerst je Familie: claude-`Read`+`file_path`,
  codex-`view_image`, opencode/`tool`-Schlüssel, acp-`kind:read` — Fixtures
  existieren bereits oder werden analog `pi-tool-use.json` ergänzt
  (`tool-image.test.ts` rot→grün).
- [ ] **T85.5 — Deklarative Registry** §3.4 inkl. Shell-Scan über Resolver;
  Grenze aider/hermes/jsonrpc dokumentiert sichtbar (kein stiller Drop).
- [ ] **T85.6 — Doku:** `docs/bild-links-fuer-agenten.md` (Was passiert
  woorhin — je Client-Weg; Stand je Adapter-Familie), Funktionsinventar S82,
  `docs/harness-matrix.md`-Fußnote falls sichtbar dargestellt.

## 5. Acceptance Criteria

- **AC-P85-1:** In jedem per T85.1 gemessenen Client-Weg führt ein Klick auf
  einen externen Chat-Link nachweislich in den Standardbrowser oder in eine
  sichtbare, bedienbare Rückfall-Ansicht; nie „nichts passiert“.
- **AC-P85-2:** Eigene Hub-Links (z. B. `#/anhang/<id>` aus dem Chat) öffnen
  die In-App-Ansicht; das in `docs/bild-links-fuer-agenten.md` versprochene
  Verhalten gilt auf jedem unterstützten Weg (mit dokumentierter Ausnahme,
  falls ein Weg sie nicht kann).
- **AC-P85-3:** Bild-Lesevorgang zeigt Vorschau + Öffnungslink auf allen
  Familien der Tabelle §3.3 mit feingranularen Ereignissen (pi unverändert,
  claude/cursor/claude-clip, codex, opencode/copilot/cursor-clip, acp);
  jede Familie durch Fixture-Test belegt; pi-Verhalten regressionsfrei.
- **AC-P85-4:** Registry ist datengetrieben: eine neue Familie braucht nur
  Eintrag + Fixture. Kein Adapter-Code, kein Contract-Change geändert.
- **AC-P85-5:** Grenzen bleiben heilig: `sessionRefFor` (eigener Hub),
  Projektwurzel/`..`-Regeln, K5, sichtbarer „nicht gezeigt“-Zähler — alle
  bestehenden Tests grün.
- **AC-P85-6:** Menschen-Abnahme (Link-Klick auf den echten Geräten,
  Bildvorschau in echter Pi-/Claude-/Codex-Session) → nach P000 verschoben
  (P000-Einträge anlegen).

## 6. Premortem

1. **„Plattformverhalten geraten statt gemessen“** — Policy wirkt auf dem
   Entwicklungsweg, bleibt auf Kais Handy aber tot. ⇒ T85.1 vor T85.3;
   nicht gemessene Wege heißen `not_run` und werden nicht versprochen.
2. **Registry wird Sonderfallsammlung** — nach drei Familien liest der Code
   wie if-Ketten. ⇒ Registry bleibt rein deklativ; `ponytail-review`-Linse;
   jede Familie genau ein Fixture-Test.
3. **Klick-Policy bricht bestehende E2E** (`deeplink.spec`,
   `anhang-bilder.spec`, Tooltip-Langpresser-Unterdrückung in
   `shared/Tooltip.tsx`) — Touch-Taps auf Links laufen durch den
   Click-Capture des Tooltip-Layers. ⇒ E2E für beide Klickarten vor dem
   Merge; Vollen Gate fahren.
4. **Resolver-Refactor stillt Tests, nicht Realität** — fixtures sind
   nachgebaut, real liefert z. B. cursor-clip andere Formen. ⇒ mindestens
   ein Live-Messlauf pro neugedeckter Familie vor AC-Abschluss (Muster
   `scripts/messlauf-*`), sonst `not_run`.

## 7. Definition of Done

`npm run lint && npm run typecheck` und die betroffenen Testsuite-Dateien
rot-dann-grün (`tool-image.test.ts`, `markdown.test.ts`, `turns.test.ts`,
neue Familien-Fixtures); neue E2E-Specs in `e2e/specs/`; `npm run gate` grün
(inkl. `check:arch`, `check:commits`, `check:context`); GitHub-Actions
(`verify` + nightly-Vollsuite) grün; BUG-0290 per `Fixes #` geschlossen;
Doku-Punkte T85.6 geschrieben; Gerätetermine nach P000 eingetragen;
Erreichbarkeit: Policy und Registry sind im Standardpfad aktiv, nicht hinter
einem Schalter begraben.

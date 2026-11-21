# EPIC-P61 — Mehrsprachigkeit: Oberfläche auf Englisch oder per Spracheinstellung

**Status:** in Arbeit — beauftragt und umgesetzt ab 21.11.2026 (ADR-0101 ✓) · **Issue:** [#6](https://github.com/securesight-ai/AncientVoid/issues/6) · **Phase:** P61 · **Dauer:** 4–6 Agenten-Wochen (gemessen, s. §3.1)
**Abhängigkeit:** keine fachliche offene (Quer-Epic, Präzedenz P50–P53/P58–P60; Vorgänger P60 umgesetzt 14.11.2026). Berührt P33 (englische Einstiegsdoku, „vertagt") nur an der Grenze: P33 = Doku, P61 = Produktoberfläche.

Quelle: Nutzerauftrag vom 15.11.2026 im Zuge der Veröffentlichung
([Audit](../docs/2026-11-15_public-release-audit.md), Abschnitt „Erster Eindruck"):
„die ganze App auf Englisch oder mit Spracheinstellung".
**Aktualisiert 17.11.2026** (Nutzerauftrag): Default ist die **Browsersprache**,
wenn ein Katalog dazu passt (sonst Englisch); manuell in den Einstellungen
wählbar und pro Gerät persistierbar; die Sprachliste ist modular, damit
weitere Sprachen ohne Umbau folgen können — der Browsersprach-Match läuft
dann automatisch mit.

## 1. Ziel

Wer AncientVoid öffentlich findet, kann es ohne Deutschkenntnisse bedienen.
Jede für Menschen bestimmte Oberfläche — PWA, Hub-Meldungen (Notifications,
Push, API-Fehlertexte), `hubctl`-Ausgabe, Sprachsteuerung — erscheint in der
gewählten Sprache **Deutsch oder Englisch**. Die Sprache ist pro Gerät
einstellbar und persistierbar; **neue Installationen starten in der
Browsersprache, wenn ein Katalog dazu passt, sonst auf Englisch**
(Entscheidung 17.11.2026, zuvor offen — der Match gegen die Sprachliste
ist Daten und gilt automatisch für jede später hinzukommende Sprache).
Neue hart codierte UI-Texte werden vom Gate
abgelehnt, damit der Zustand nicht zurückdriftet.

Kein Ziel dieser Phase: eine dritte Sprache **liefern**. Die Architektur
nimmt weitere Sprachen aber ohne Umbau auf: Die Sprachliste ist Daten —
pro Sprache genau ein Katalog plus ein Eintrag in `availableLanguages`
(Code, Label, ggf. Locale-Aliasse); Settings, `t()` und Typprüfung lesen
diese Liste, kein Aufrufort hardcodet „de/en“.

## 2. Scope (In / Out)

**In:**

- Leichtgewichtiges Eigen-i18n in der PWA (kein Framework): typisierte
  Kataloge, `t()`-Helfer, Interpolation, Plural über `Intl.PluralRules`,
  Datums-/Zahlformat über `Intl` mit der gewählten Locale.
- Sprachwahl in den Einstellungen, pro Gerät persistiert; **Default
  „Automatisch (Browsersprache)"** (17.11.2026 entschieden): Match von
  `navigator.language` gegen `availableLanguages` (Sprachpräfix, z. B.
  `de-AT` → `de`), ohne Treffer Englisch; `<html lang>` folgt der Wahl.
- Migration aller PWA-Texte (134 von 178 Dateien, §3.1) nach Feature-Bereich.
- Hub-Texte, die über die Leitung gehen: Notifications (ADR-0015),
  Web-Push-Payloads, API-Fehler mit `code` → Text im Client.
- `hubctl`-Ausgabe zweisprachig (`--lang`, sonst `AV_LANG`/`LANG`).
- Sprach-Eingabe: Browser-STT (`recognizeOnce("de-DE")` hart codiert) und
  Hub-STT (`stt.language`) folgen der Gerätesprache, soweit die Engine sie
  kann; Befehlspalette/Quick-Commands erkennen Schlüsselwörter beider Sprachen.
- Gate-Check gegen neue hart codierte UI-Strings (Ratchet).
- E2E: Sprachwechsel-Spec; bestehende Specs laufen explizit mit `de`.

**Out:**

- Übersetzung von Agenten-Output, Provider-Fehlertexten im Wortlaut,
  Tool-Namen, Logs, Commit-Nachrichten — das sind Daten, keine UI
  (PRD §8.5: Agenten-Output wird nie umgedeutet).
- Projektdoku (`docs/`, `epics/`, ADRs) — bleibt Deutsch; englische
  Einstiegsdoku ist P33.
- RTL-Sprachen, Übersetzungsplattformen (Crowdin & Co.), Laufzeit-Download
  von Katalogen aus dem Netz.
- Adapter-interne Texte (`packages/adapters/**`), außer sie landen als
  feste Statusmeldung in der UI — dann bekommen sie einen Schlüssel.

## 3. Design-Details

### 3.1 Bestandsaufnahme (gemessen 15.11.2026, `main` @ `1e5db943`)

TS-AST-Scan (`typescript`-Parser; JSX-Text, JSX-Attribute, sonstige
String-Literale mit Wortcharakter/Leerzeichen/Umlaut; Imports ausgenommen).
Obergrenze — enthält auch technische Strings, Duplikate und bereits
englische Fehlermeldungen:

| Bereich | Dateien mit Text | JSX-Text | JSX-Attribute | weitere Literale | Summe (davon mit Umlaut) |
|---|---|---|---|---|---|
| `apps/pwa/src` | 134 / 178 | 905 | 629 | 1.125 | 2.659 (644) |
| `apps/hub/src` | 48 / 59 | — | — | 564 | 564 (102) |
| `packages/core/src` | 92 / 150 | — | — | 1.116 | 1.116 (275) |
| `apps/hubctl/src` | 6 / 7 | — | — | 129 | 129 (41) |
| `packages/contracts/src` | 13 / 49 | — | — | 109 | 109 (26) |
| `e2e/specs` | 104 / 104 | — | — | 3.138 | 3.138 (752) |

Dazu ~20 Stellen `toLocaleString("de-DE")`/`toLocaleTimeString("de-DE")`
und `<html lang="de">`. Schätzung echter UI-Strings: PWA ~1.800–2.200,
hub/core nutzerseitig ~300–400 (Rest sind Logs/Fehlerinterna), hubctl ~100.
Bei ~400 Strings pro Agenten-Tag inkl. Review → 4–6 Agenten-Wochen gesamt.

### 3.2 Katalog und `t()` (PWA)

- `apps/pwa/src/shared/i18n/de.ts` ist Quelle der Schlüssel:
  `export const de = { "settings.language.title": "Sprache", … } as const`.
- `en.ts` ist als `Record<keyof typeof de, string>` typisiert — fehlender
  oder überzähliger Schlüssel ist ein `tsc`-Fehler (Typecheck-Gate), kein
  Laufzeitfund.
- `t(key, params?)`: `{name}`-Interpolation, Plural über Schlüssel-Suffixe
  (`.one`/`.other`) + `Intl.PluralRules`. Fehlender Schlüssel zur Laufzeit
  (nur bei Daten aus dem Hub denkbar): sichtbarer Fallback auf `de`, im
  Dev-Build `console.warn` — fail loud, nie leerer Text.
- `fmtDate/fmtTime/fmtNumber` in `shared/i18n/format.ts` ersetzen alle
  `"de-DE"`-Literale.
- Schlüssel sind fachlich (`session.stop.confirm`), nicht der deutsche Text.
- Beide Kataloge werden gebündelt und vom Service Worker vorgeladen (K10:
  offline ohne Netz umschaltbar). Größe beobachten; ab > 60 KB gzip pro
  Katalog Lazy-Import des nicht aktiven Katalogs.

### 3.3 Spracheinstellung

- Einstellungen → Darstellung → „Sprache": Automatisch (Browsersprache,
  Default) · Deutsch · English. Persistiert pro Gerät in `localStorage`
  (wie Presets), mit try/catch-Fallback auf „Automatisch".
- **Default „Automatisch" (entschieden 17.11.2026, Nutzerauftrag — löst die
  ursprünglich offene Frage „Browsersprache oder fest Englisch?“):** Neue
  Installationen folgen der Browsersprache, wenn ein Katalog passt, sonst
  Englisch; der Match läuft gegen die modulare Sprachliste und gilt damit
  ohne Anpassung auch für jede später hinzugefügte Sprache. Der Wechsel lädt die PWA neu (deterministisch; kein Live-Re-Render aller
  Bäume). Offener Entwurf (Composer, Vormerkung) bleibt durch bestehende
  Draft-Persistenz erhalten — in T61.2 nachweisen.
- Der Hub erfährt die Sprache pro Gerät über `Accept-Language` und beim
  Push-Abo (Feld `locale` am Abo, s. §3.4).
- **Entschieden (17.11.2026, Nutzerauftrag):** Default ist **„Automatisch
  (Browsersprache)"** — der Match gegen die modulare Sprachliste geht für
  alle (auch künftige) Sprachen gleich einfach auf; ohne Treffer startet
  die PWA auf Englisch. Manuelle Wahl (Deutsch/English/spätere Sprachen)
  bleibt pro Gerät persistierbar.

### 3.4 Hub-Texte über die Leitung (Contract, ADR Pflicht)

Texte, die der Hub erzeugt und die die PWA anzeigt, bekommen einen
Nachrichtenschlüssel statt fertiger Prosa:

- `HubNotification` (ADR-0015) erhält **additiv** `messageKey?: string` und
  `params?: Record<string, string | number>`; `title`/`detail` bleiben als
  Fallback (Deutsch) für Alt-Clients und Alt-Journal. K5: Params klein,
  keine Freitexte > 512 B (sonst `detail`).
- Persistierte Notifications/Events aus der Zeit vor P61 haben keinen
  Schlüssel → Fallback-Text, keine Migration der JSONL (K7 unverändert).
- API-Fehler: bestehende `code`-Felder werden Katalogschlüssel
  (`error.<code>`); unbekannter Code zeigt die Hub-Message wörtlich.
- Web-Push rendert der Hub selbst (kein Client-Code beim Empfang): Hub hält
  einen kleinen Server-Katalog (`packages/core/src/modules/notifications/i18n/`)
  nur für Push-Titel und wählt per `locale` des Abos.
- Schlüssel-Typen (String-Literal-Unions, keine Enums — strip-types) liegen
  in `packages/contracts/src/notifications/`. ADR **vor** der ersten
  Contract-Änderung (AGENTS.md Regel 1).

### 3.5 hubctl und Sprache

- `hubctl`: kleiner eigener Katalog in `apps/hubctl/src/i18n/`, Auswahl
  `--lang` > `AV_LANG` > `LANG`; Default Englisch, wenn nichts passt.
  Maschinenlesbare Ausgabe (`--json`) bleibt sprachneutral.
- STT: Browser-Erkennung nutzt `de-DE`/`en-US` nach Gerätesprache; Hub-STT
  nimmt `language` pro Anfrage, sonst `stt.language` aus `hub.config.json`.
  K6-Messlauf (Skill `messlauf`, `scripts/messlauf-stt.mjs`) einmal mit `en` wiederholen.
- Quick-Commands/Nyx: Schlüsselwörter aus dem Katalog (beide Sprachen
  gleichzeitig erkannt, damit Muskelgedächtnis nach dem Wechsel nicht bricht).

### 3.6 Gate gegen Rückfall

`scripts/check-i18n.mjs` (im `gate`, mit `check-i18n.test.mjs`): derselbe
AST-Scan wie §3.1 über `apps/pwa/src` außerhalb `shared/i18n/`, meldet
JSX-Text und `title`/`aria-label`/`placeholder`/`alt`-Literale.
Ratchet-Baseline `scripts/check-i18n.baseline.json` (Anzahl pro Datei):
darf sinken, nie steigen; am Epic-Ende leer. Ausnahmen per Kommentar
`// i18n-ignore: <Grund>` (z. B. Markennamen, Tastenkürzel).

### 3.7 E2E

- Bestehende 104 Specs suchen nach deutschen Texten → Fixture setzt
  `locale: "de-DE"` und die Gerätesprache explizit auf `de`; kein
  Massen-Umbau der Specs in P61.
- Neue Spec `e2e/specs/i18n-language.spec.ts`: Sprache wechseln, Reload,
  Kernseiten (Übersicht, Session, Neue Session, Einstellungen,
  Benachrichtigungen) zeigen englische Texte, `<html lang="en">`, keine
  Katalog-Warnung in der Konsole; Offline-Wechsel (K10).

### 3.8 Skalierung auf weitere Sprachen (Konzept-Entwurf 21.11.2026, wartet auf Genehmigung)

Der Rahmen aus §3.2–3.4 ist bereits sprachneutral; nur `de`/`en` sind heute
hart verdrahtet. Für „praktisch alle Sprachen" gilt:

1. **Quell-Katalog bleibt `de.ts`**, `en.ts` bleibt der von Hand gepflegte,
   gelesene Zuverlässigkeits-Fallback (T61.11 Glossar bleibt Pflicht).
2. **Jede weitere Sprache = eine generierte Datei**
   `shared/i18n/generated/<lang>.ts` via `scripts/translate-catalog.mjs`:
   liest `de.ts` + Glossar, schreibt vollständige Kataloge mit Header
   `// machine-generated via <tool>, unreviewed`. Kein per-Sprache-Code;
   die modulare Sprachliste (§3.3) wird aus dem Verzeichnis gespeist —
   eine neue Sprache ist ein Datei-Commit plus optionaler Review-Pass.
3. **Fallback-Kette:** gewählte Sprache → fehlender Schlüssel → `en` → `de`
   (`t()`-Pfad, fail loud wie heute). Generierte Kataloge sind typisiert als
   `Partial<Record<keyof typeof de, string>>` — das `tsc`-Gate (§3.2) bleibt
   für `en` voll, für generierte Sprachen gilt Vollständigkeit per Skript.
4. **Plural/Format:** unverändert über `Intl.PluralRules`/`Intl.*Format`;
   das Skript übersetzt nur Werte, nie Schlüssel/Plural-Suffixe.
5. **Übersetzungswerkzeug:** konfigurierbar (lokales Modell via gpubox-
   Endpunkt oder vom Nutzer freigegebener Dienst) — bewusst keine
   Übersetzungsplattform (§2 Out); ein Lauf pro Sprache zum Release, nicht
   pro PR.
6. **Qualitätsschiene:** `de`/`en` auf Menschenlesen-Niveau (T61.11);
   Maschinensprachen sind ausdrücklich „ungeprüft, aber vollständig" —
   ein Review-Pass pro Sprache ist Nutzeraufgabe, kein Gate.

## 4. Aufgaben (Checkliste T61.m)

- [x] **T61.1** ADR „Mehrsprachigkeit: Kataloge, Nachrichtenschlüssel im
  Notification-Contract, Locale am Push-Abo" — vor jeder Contract-Änderung.
- [x] **T61.2** PWA-Grundgerüst: `shared/i18n/{de,en,index,format}.ts`,
  Sprachwahl in Einstellungen, `<html lang>`, Reload-Pfad mit Draft-Erhalt;
  Unit-Tests für `t()`, Plural, Fallback. (K10)
- [x] **T61.3** `check-i18n` mit Baseline ins Gate; Test mit positivem und
  negativem Fixture; `docs/check-context.md`-Eintrag „script-ref" erfüllt.
- [x] **T61.4** Migration Shell/Übersicht/Status/Benachrichtigungen
  (häufigste Erstkontakt-Flächen) inkl. `fmt*`-Ersatz der `"de-DE"`-Literale.
- [ ] **T61.5** Migration Session/Composer/Approvals/Neue Session/Setup-
  und Onboarding-Pfade.
- [ ] **T61.6** Migration übrige Features (Workspace, Files, Vault, Graph,
  Fleet, Teams, Automations, Forge, Media, Metriken, Settings …) — je
  Feature-Bereich ein MR, Baseline sinkt nachweisbar.
- [x] **T61.7** Contract + Hub: `messageKey`/`params` an Notifications,
  `error.<code>`-Mapping, `locale` am Push-Abo, Server-Push-Katalog. (K5, K7)
- [ ] **T61.8** `hubctl`-Katalog und `--lang`; Referenz-Doku neu generieren
  (`npm run docs:reference`).
- [ ] **T61.9** Sprache für STT/Quick-Commands/Nyx; K6-Messlauf mit `en`. (K6)
- [ ] **T61.10** E2E: Locale-Fixture für Bestands-Specs, neue
  `i18n-language.spec.ts`; Eintrag in `docs/funktionsinventar.md`.
- [ ] **T61.11** Englisches Korrekturlesen aller Kataloge (ein Durchgang,
  konsistente Terminologie: Session, Hub, Harness, Approval, Fleet …),
  Glossar als Kopf von `en.ts`.

## 5. Acceptance Criteria (AC-P61-k)

- **AC-P61-1:** Mit Sprache „English" zeigen alle Seiten der PWA keine
  deutschen UI-Texte; Beleg: `check-i18n`-Baseline leer **und**
  `i18n-language.spec.ts` grün.
- **AC-P61-2:** `en.ts` und `de.ts` haben identische Schlüsselmengen —
  erzwungen durch `tsc`; ein absichtlich fehlender Schlüssel lässt
  `npm run typecheck` scheitern (Negativprobe im MR belegt).
- **AC-P61-3:** Sprachwahl überlebt Reload und Offline-Start; offline
  umschalten zeigt die andere Sprache ohne White-Screen (K10).
- **AC-P61-4:** Eine nach P61 erzeugte Notification erscheint in der
  Gerätesprache; eine vor P61 persistierte erscheint mit ihrem
  ursprünglichen Text; Hub-Restart rekonstruiert beide identisch (K7).
- **AC-P61-5:** Web-Push-Titel kommen in der Sprache des jeweiligen Abos
  (zwei Geräte, zwei Sprachen, ein Ereignis).
- **AC-P61-6:** K2 unverändert: Session-Tail bei 30 Events/s ohne neuen
  Frame-Lag (`t()` ist Map-Lookup; Messlauf-Vergleich vor/nach).
- **AC-P61-7:** `hubctl --lang en status` und `--lang de` liefern
  übersetzte Ausgabe; `--json` byte-identisch in beiden Sprachen.
- **AC-P61-8:** K6-Messlauf mit englischer Spracheingabe ≤ 1,5 s.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Halbmigration bleibt liegen** — nach T61.4 ist die Hälfte englisch, der
   Rest deutsch, gemischte UI wirkt kaputter als vorher → Ratchet-Gate ab
   T61.3, Baseline-Zahl im Epic-Status sichtbar; „English" erst nach T61.6
   in der Einstellung freischalten (vorher nur per Dev-Flag).
2. **E2E-Massenbruch** — Specs finden Texte nicht mehr, weil ein Default auf
   Englisch kippt → Locale-Fixture `de` zuerst (T61.10 vorziehen, vor
   T61.4 mergen); keine Spec wird „grün gemacht", indem Erwartungen
   gelockert werden.
3. **Contract-Bruch an Alt-Clients/Alt-Journal** — Pflichtfeld statt
   optionalem Schlüssel, oder Umschreiben persistierter Notifications →
   Felder additiv und optional, `title` bleibt; keine JSONL-Migration;
   ADR vor Code; Replay-Test mit Alt-Fixture (K7).
4. **Schlechte, inkonsistente Übersetzung** — maschinell übersetzte
   Einzelstrings ohne Kontext („Vormerken", „Übergeben", „Zug") → Glossar
   zuerst (T61.11 startet parallel zu T61.2), Schlüssel fachlich benannt,
   Kontextkommentar bei mehrdeutigen Begriffen.
5. **Text-Expansion bricht Layouts** — englische/deutsche Längen
   unterscheiden sich, Dock/Buttons/Chips laufen über (vgl. BUG-0098) →
   Zoom-/Breiten-Specs (P50-Muster) einmal je Sprache laufen lassen.
6. **Bundle-/Offline-Kosten** — zwei Kataloge vergrößern die PWA und den
   Precache → Größe im Build-Log beobachten; Lazy-Import ab Schwelle
   (§3.2), Katalog trotzdem im Precache (K10 vor Ladezeit).

## 7. Definition of Done

Alle T61.* und AC-P61-* mit Evidenz. `npm run gate` lokal grün
(inkl. `check-i18n` mit leerer Baseline); Pipeline-Job `e2e` zusätzlich nur
bei aktivem lokalem GitLab-Server (auf `gitlab.com`: „CI nicht anwendbar").
Neue Abläufe mit Spec in `e2e/specs/` und Eintrag in `docs/funktionsinventar.md`;
Sprachwahl in den Einstellungen erreichbar und in `docs/` (Bedienung)
erwähnt. ADR gemerged vor der Contract-Änderung. K2/K5/K6/K7/K10
nachweisbar unverändert bzw. erfüllt; kein TODO ohne Epic-Bezug.

---
id: BUG-0176
slug: starten-klick-von-arbeitsort-feld-ueberdeckt
status: done
severity: S3
area: e2e
instance: dev
commit: "56f8e8c2"
forge: "https://github.com/securesight-ai/AncientVoid/issues/28"
created: 2026-11-16
reporter: "E2E-Läufe (Phone main + PR-#17-CI)"
---

# BUG-0176 — Starten-Klick im Neue-Session-Formular wird zeitweise vom Arbeitsort-Feld überdeckt

## Gesehen

Der E2E-Test „Projektauswahl zuerst …“ (session.spec.ts:31) scheitert
zeitweise am Klick auf „Starten“: Das Element ist sichtbar/enabled/stable,
aber Pointer-Events werden vom `.card.form-grid` bzw. vom
`fieldset.workplace-choice` (Radio „Arbeitsort direkt im Ordner“)
abgefangen — bis zum 45-s-Timeout. Einmal als Phone-Lauf auf main
(16.11., Run 3 nach Speicherbereinigung, Test 58) und einmal als
Desktop-e2e in der CI des PR #17 (toHaveURL-Timeout nach 12 s, Lauf
43875166404). In beiden Fällen lief derselbe Test direkt danach und in
Wiederholungen grün (lokal 10/10; Phone-Run 2 komplett grün).

## Erwartet

Der Klick auf „Starten“ erreicht den Button unabhängig von
Render-/Layout-Timing; der Test ist stabil.

## Repro

Nicht deterministisch reproduziert. Beobachtet in:

1. Phone: `CI=false npm run test:phone` am OnePlus A6013, main 56f8e8c2
   — `Target page … closed` nach Endlos-Retry: „`<div class="card
   form-grid">` intercepts pointer events“, danach „`<input type="radio"
   value="direct" name="workplace">` … intercepts pointer events“.
2. CI: PR #17, Job `e2e` — `expect(page).toHaveURL(/#\/sessions\//)`
   rot, Klick führte nicht zur Navigation (12,2 s).
3. Lokal (PR-#17-Branch, Desktop): `npx playwright test
   e2e/specs/session.spec.ts:31 --repeat-each=5` → 10/10 grün (1,6 s je
   Lauf); Phone-Run 2 auf main: grün.

**Häufigkeit:** selten (2 rote Läufe von ~5 Gesamtfolgen an dem Tag, nie
in Wiederholungen desselben Laufs).

## Eingrenzung

Offen. Vermutung: Layout-Verschiebung im Formular während des Klicks —
die Arbeitsort-Vorschau (`/api/workspace/preview`) lädt nach, das
Fieldset wächst unter dem Zeiger, Playwrights Stabilitätsprüfung läuft
vor der Verschiebung durch. Keine Produktbeobachtung außerhalb der E2E
bekannt; produktseitig wäre dasselbe Überdeckungs-Szenario aber nur ein
zweiter Tipp.

## Testlücke

Kein Test deckt das Timing „Vorschau trifft während der Bedienung ein“;
der Zeuge ist der flaky Test selbst. Für den `bugfix`: entweder Layout
(Überdeckung) fixen oder den Test auf abgeschlossene Vorschau warten
lassen — erst mit Repro entscheiden.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt ([#28](https://github.com/securesight-ai/AncientVoid/issues/28))
- [x] `bugfix` oder offen lassen

## Fix (2026-11-23)

Testseitig (die im Issue genannte zweitere Option): Das Arbeitsort-Feld
trägt seinen Vorschau-Zustand sichtbar (`data-preview="pending|done|failed"`
auf dem Fieldset), und die beiden Start-Klicks in `session.spec.ts` warten
über `startWhenPreviewSettled()` auf den abgeschlossenen (oder fehlgeschlagenen)
Vorschau, bevor sie klicken — das Einwachsen des Formulars kann nicht mehr
unterm Zeiger passieren. Der seltene Flake selbst ist nicht deterministisch
reproduzierbar (2 Läufe von ~5 am 16.11., nie in Wiederholungen); die
Änderung beseitigt die Race-Bedingung statt ihres Symptoms.

Grün: `session.spec.ts` mobil 22/22, lint + typecheck.

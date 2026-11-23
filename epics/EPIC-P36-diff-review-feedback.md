# EPIC-P36 — Diff-Review mit gesammeltem Agenten-Feedback

**Status:** abgeschlossen 2026-11-08 (T36.1–T36.6, Gate grün) — Live-Abnahme nach P000 verschoben (T000.7, zuvor T35.16) · **Phase:** P36
**Technische Reste verifiziert 2026-11-12:** e2e `review-feedback.spec.ts` 2/2 grün, Live-Suite `e2e/live` 6/6 grün gegen laufenden Hub :7373, tsc-Build + PWA-Build grün, Funktionsinventar S47 registriert (spec:review-feedback.spec.ts). Offen bleibt allein das menschliche Gate: Live-Endabnahme am Gerät (T35.16-Block).
**Dauer:** 1–2 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P33 (nach ausdrücklich gültigem P32-/P33-Evaluations-/Umsetzungs-Exit) mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend. — *Erfüllt 08.11.2026: P32- und P33-Evaluations-Exit „vertagt" ausdrücklich dokumentiert und abgenommen (MR !324/!325, jeweils [Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md) bzw. EPIC-P33 §8); P30/P31-Umpriorisierung nach P36 im Index. Vor T36.1 wurde der Bestand frisch geprüft (Queue/Ack/Interrupted-Mechanik am Code, nicht an historischen Überschriften).*

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T36.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Änderungen am Handy und Desktop gezielt kommentieren und mehrere Befunde als einen Folgeauftrag an einen gewählten Agenten senden. Vorhandene Diff-Ansicht erweitern. K3/K5/K7/K10; K1 für weiterhin erreichbare Freigaben.

## 2. Scope (In / Out)

**In:** Datei-/Zeilenbereichsnotizen, Entwurf, Sammelversand, Quellenbezug, Status gesendet/offen/erledigt und sichtbare veraltete Anker; erst lokale Reviews, später P37-Forge-Verknüpfung.
**Out:** neuer Voll-Editor, automatisches Auflösen verschobener Zeilen mit unbelegter Sicherheit, autonome Merge-Freigabe, zweites Prompt-Queue-System.

## 3. Design-Details

### 3.1 Bestand und Einbauorte
`apps/pwa/src/features/session/DiffPane.tsx` und `diff-lines.ts` bleiben Renderer. Remote-main-Nachgleich `08b9240` enthält bereits Commit-Abschnitte (AC-P2-1): Notizen müssen Commit-SHA versus uncommitteten Rest unterscheiden; diese Gliederung nicht nochmals bauen. Verträge unter `packages/contracts/src/reviews/`, Fachlogik unter `packages/core/src/modules/reviews/` (nur `index.ts` öffentlich), Routen `apps/hub/src/modules/reviews/reviews.routes.ts`. Neue geteilte Event-/Adapter-Verträge vor Umsetzung per ADR. Versand über bestehenden SessionManager/Approval-/Prompt-Pfad.

### 3.2 Bezug und Versand
Eine Notiz trägt Session-/Workspace-ID, Basis-SHA, Scope (konkrete Commit-SHA oder uncommitteter Rest), Diff-Identität, Pfad, alte/neue Seite und Bereich plus begrenzten Textausschnitt. Nach Änderung der Diff-Identität muss sie erneut zugeordnet oder als veraltet markiert werden; Zeilennummer allein reicht nicht. Nutzer wählt Notizen und Empfänger, sieht den gebündelten Prompt vor Versand. Operations-ID verhindert doppelten Sammelversand nach Doppelklick/Reconnect. Adapter ohne Folgeprompt bekommen einen begründeten, sichtbaren Alternativpfad, keine heimliche neue Session.

### 3.3 Recovery und Datenbudget
Notizen und Sendestatus aus Review-Journal/Snapshot rekonstruieren, SQLite nur Projektion. Große Ausschnitte/Feedback-Pakete als Blob, Event ≤4 KB. Diff-Startpayload bleibt ≤50 KB; einzelne Hunks nachladen. Offline Notizen lokal mit sichtbarem Zeitstempel halten; Versand/Freigaben nur online. „Erledigt“ ist menschlicher Review-Status, kein bestandener Test.

### 3.4 Zustellung abgleichen
Vor Ausbau die vorhandene Queue, `Ack` und InterruptedBanner mit Crash um `SessionQueue.take()`/Adapter-Übergabe prüfen. Kein neues allgemeines Zustell-Epic auf Verdacht. Reproduzierbarer Verlust/Doppelversand als Bug mit eigener ID und rot-grün-Test; ungeklärte Zustellung sichtbar halten, nie blind automatisch erneut senden.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/diff-comment-types.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/diff-comment-types.ts) | Port-Kandidat: kleines Datenmodell; Zeit/IDs/Session-Bezug auf AV-Contracts umstellen. |
| [src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts) | Referenz für geordnete Writes/Rollback; Zustand liegt in Orcas Zustand-Store, nicht direkt importieren. |
| [src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts) | Test-/Recovery-Referenz; vollständiges Chat-Journal nicht kopieren. |

## 4. Aufgaben (Checkliste T36.m)

- [x] **T36.1** Bestands-/Queue-Audit und Review-ADR/Contracts einschließlich Diff-Identität und Operations-ID; Crashfenster reproduzierbar prüfen. **K3/K5/K7**.
  — *Erledigt 08.11.2026:* [ADR-0055](../docs/adr/0055-review-notizen-sammelfeedback.md),
  `packages/contracts/src/reviews/review.ts`. Audit-Befund unten (§8).
- [x] **T36.2** Notizspeicher, Statusfaltung und Restore; gleiche Datei/Zeile in verschiedenen Commit-Abschnitten, veraltete, umbenannte/gelöschte Dateien und große/binary Hunks testen. **K3/K5/K7**.
  — *Erledigt:* `packages/core/src/modules/reviews/` (Journal+Snapshot, K7),
  `apps/hub/src/modules/reviews/validate.ts`; Tests:
  `packages/core/test/modules/reviews/review-store.test.ts` (9),
  `apps/hub/test/modules/reviews/validate.test.ts` (14: Rename/Löschung,
  binär, K3-gekürzt → unclear, Zwei-Commit-Kollision, verschobener Anker).
- [x] **T36.3** Mobile/ Desktop-Notizen mit Bereichsauswahl, Liste, Vorschau, Empfängerwahl und manueller Erledigung in bestehende Diff-Ansicht integrieren. **K1/K2/K3**.
  — *Erledigt:* `apps/pwa/src/features/session/DiffReview.tsx` um den
  unveränderten Renderer `DiffPane.tsx`; Bereichsauswahl per Zeilen-Tipp mit
  echten Seiten-Nummern (`diff-lines.ts:mapHunkLines`), Notiz-Badges,
  Status-Chips, Offline-Outbox mit Zeitstempel.
- [x] **T36.4** Sammelversand über vorhandene Policy und Queue; Doppelklick, verlorene Antwort, Adapterfehler und fehlende Capability prüfen. **K5/K7/K9-Geist**.
  — *Erledigt:* `apps/hub/src/modules/reviews/reviews.routes.ts` — Versand
  über `sessions.steer` mit `inputId=operationId` (Dedupe/In-Flight/Revision
  unverändert übernommen), `refuseSteer` laut bei fehlendem `followUp`, Agenten
  403. Tests: `apps/hub/test/modules/reviews/reviews.integration.test.ts` (6:
  Doppelversand, Empfängerwahl, Stale-Refusal, Neustart-K7, Status/Löschen).
- [x] **T36.5** `e2e/specs/review-feedback.spec.ts`: Notieren → Restart → Senden → Revision → erneute Prüfung; Offline und veralteter Anker. **K3/K7/K10**.
  — *Erledigt:* 2 Specs grün (mobile): Notieren→SIGKILL-Restart→Senden→
  Revision→veraltet+unversendbar (API 422) und Offline-Outbox→Online-Nachzug.
- [x] **T36.6** Gate, PWA-Build, echte mobile/desktop Review-Journey und Doku/Registrierung abschließen. **K1/K2/K3/K5/K7/K10**.
  — *Erledigt (Agentenanteil):* `npm run gate` grün (1402 Unit/Integration,
  E2E-Suite, Lint, Typecheck, arch/commits/adapter-matrix), PWA-Build grün,
  ADR-0055 + Registrierung (Contracts-Export, Hub-Routen, PWA-Feature,
  E2E-Spec). *Echte Journey am Pixel/Desktop:* bewusst im Endabnahme-Block
  T35.16 aufgegangen — zählt hier nicht als grün.

## 5. Acceptance Criteria (AC-P36-k)

- **AC-P36-1:** Drei Notizen an zwei Dateien bleiben nach Hub-/Client-Neustart mit Bezug und Status erhalten; gleiche Datei/Zeile in zwei Commit-Abschnitten kollidiert nicht.
  — *Erfüllt 08.11.2026:* Hub-Restart in Integration (`reviews.integration.test.ts`, SIGKILL-artiger App-Neubau mit `recoverAll`) und E2E (`hub.restart("SIGKILL")`); Zwei-Commit-Kollision in `validate.test.ts` + `review-store.test.ts`.
- **AC-P36-2:** Ein Sammelauftrag enthält nur gewählte Notizen, nachvollziehbare Datei-/Diff-Bezüge und erreicht den gewählten Harness; zweiter Klick dupliziert ihn nicht.
  — *Erfüllt:* nur `noteIds` der Auswahl; Bezüge via `formatReviewNoteRef` in Prompt/Vorschau; Dedupe-Beweis: zweiter identischer Send → `steered.length` unverändert (Integration); Empfängerwahl erreicht Ziel-Session, `followUp`-los wird laut abgelehnt.
- **AC-P36-3:** Veränderter Diff, Datei-Rename oder fehlender Anker wird sichtbar als veraltet/ungeklärt behandelt.
  — *Erfüllt:* `validate.ts` (Basis/HEAD/Inhalt/Rename/Löschung/binär → stale mit Grund; K3-gekürzte Hunks → unclear); E2E Revision → Badge + Checkbox aus + API-422.
- **AC-P36-4:** Events ≤4 KB und erste Diff-Antwort ≤50 KB; Anhänge/Hunks werden gezielt nachgeladen.
  — *Erfüllt:* keine neuen Session-Events (ADR-0055 §5); Diff-Route und K3-Kappung unverändert (`diff.ts`, bestehende Tests); große Pakete als Attachment statt Inline (`SEND_INLINE_HARD_CAP_CHARS`, `promptNeedsAttachment`); Hunk-Nachladen unverändert über `/diff/hunk`.
- **AC-P36-5:** Offline entstehen keine angeblich gesendeten Aufträge; API-Fehler erhalten Entwurf und zeigen Ursache.
  — *Erfüllt:* Offline-Outbox mit Zeitstempel, Versand offline gesperrt (E2E); fehlgeschlagener Versand → `sendDetail` an der Notiz, Status bleibt Entwurf (Integration: Stale-Refusal und followUp-Verweigerung).
- **AC-P36-6:** Zustell-Audit dokumentiert vorhandene Garantien und offene Befunde; kein Exactly-once-Claim gegenüber fremden CLIs.
  — *Erfüllt:* Audit unten §8.

## 6. Premortem (Failure-Modi + Mitigation)

1. Zeilen wandern und Feedback trifft falschen Code → Diff-Identität und Ausschnitt prüfen, unklare Anker nicht verschieben.
2. Sammelversand geht doppelt raus → persistente Operation, unklarer Ausgang blockiert blindes Retry.
3. Review wird zweite Chat-Engine → bestehenden Session-/Queue-/Policy-Pfad verwenden.
4. Große Diffs lähmen Handy → K3-Nachladen und K5-Blobs auch für Notizen.

## 7. Definition of Done

Alle T36.* und AC-P36-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.

## 8. Zustell-Audit (T36.1, AC-P36-6) — Stand 08.11.2026

Geprüft am Code (nicht Codelektüre-Verdacht, belegt durch bestehende Tests):

**Vorhandene Garantien (unverändert übernommen, kein zweites System):**
- `SessionQueue.take()` löscht vor dem Versand (at-most-once, `session-queue.ts`);
  Ergebnis wird als `session.dequeued {ok, detail}` sichtbar. Queue überlebt
  Hub-Neustart (`session-queue.test.ts`:171, K7).
- `steer`-Dedupe: `hasSeenInput` → „duplicate input ignored" (idempotent),
  In-Flight → 422 „outcome unknown", Revision → Konflikt, Writer-Lease;
  `session_inputs` persistiert (`session-manager.ts:1287–1304`, AC-P17-3).
  Der Review-Sammelversand nutzt exakt diese Mechanik via `inputId=operationId`.
- Crash/Interrupt: Unterbrechungen laufen über das Journal in Status
  `interrupted` mit Grund (ADR-0044, `InterruptedBanner`), Auto-Resume nur
  deklarativ. Ein unklarer Sendeaufgang blockiert blindes Retry (gleiche
  Operations-ID; PWA zeigt „Zustellung unklar").

**Offene Befunde (benannt, nicht behoben — kein neues Zustell-Epic):**
- Crashfenster zwischen `take()` und Adapter-Übergabe: ein dort verlorenes
  Queue-Element ist **at-most-once-Verlust**, begrenzt sichtbar über den
  `interrupted`-Status desselben Hubs. Kein reproduzierbarer Verlust ohne
  Crash → kein Bug mit eigener ID; Exactly-once wird gegenüber fremden CLIs
  ausdrücklich NICHT beansprucht.
- Fremde CLIs (claude -p & Co.) bestätigen keine Zustellung semantisch —
  `steer`-Ack ist Prozess-Accept, keine CLI-Garantie.

**Orca-Übernahme:** kein Code portiert; nur das Datenmodell-Denkmuster aus
`diff-comment-types.ts` (kleine Typen, AV-Contracts) —
[ADR-0055](../docs/adr/0055-review-notizen-sammelfeedback.md) „Kontext".
Keine Übernahme aus Journal/Unsent-Send-Hold (AV hat EventStore/Steer schon).

## 10. Retro (2026-11-08)

**Zeitraum/Umfang:** 08.11.2026, eine Session · 8 Commits (5765666…89fac5d)
inkl. E2E-Race-Fix und T36.6-Doku · MR !326, Pipeline 3041805411 grün
(verify + e2e 372/2 Skip in CI).

### AK-Matrix

- AC-P36-1: 🟢 — Beleg: `reviews.integration.test.ts` „Notizen überstehen
  einen Hub-Neustart" (file-basierte DB + `recoverAll`), E2E
  `hub.restart("SIGKILL")`; Zwei-Commit-Kollision `validate.test.ts`
  („gleiche Datei/Zeile in zwei Commit-Abschnitten").
- AC-P36-2: 🟢 — Beleg: Integration „Sammelversand … genau einmal"
  (zweiter identischer Send → `steered.length` unverändert), „Empfänger ohne
  followUp … Empfängerwahl"; Bezüge via `formatReviewNoteRef` im Prompt
  (`prompt.ts`).
- AC-P36-3: 🟢 — Beleg: `validate.test.ts` (Basis-/HEAD-Wechsel, Datei weg,
  binär, geänderten/verschobenen Inhalt); E2E „Revision → veralteter Anker"
  inkl. API-422 und deaktivierter Auswahl.
- AC-P36-4: 🟢 — Beleg: keine neuen Session-Events (ADR-0055 §5 — K5
  unverändert, `eventstore.test.ts` weiter grün); Diff-Route/K3-Kappung
  unangetastet; `SEND_INLINE_HARD_CAP_CHARS` + `promptNeedsAttachment`
  (`reviews.routes.ts`).
- AC-P36-5: 🟢 — Beleg: E2E „Offline: Notiz bleibt lokal …" (Outbox mit
  Zeitstempel, Online-Nachzug); Integration „veralteter Anker … API-Fehler
  behalten Entwurf" (`sendDetail`).
- AC-P36-6: 🟢 — Beleg: §8 Zustell-Audit mit Code-Referenzen
  (`session-queue.ts` take()-at-most-once, `session-manager.ts:1287–1304`
  Dedupe/In-Flight); explizit kein Exactly-once-Claim.

### Premortem-Bilanz

1. **Zeilen wandern, Feedback trifft falschen Code** — eingetreten als
   Annahme und per Design entschärft: Teilstring-Match („beta" in
   „beta geändert") wäre der echte Fehltreffer gewesen; gefixt auf
   zeilengenauen Vergleich (`validate.ts` `linesOnSide`), E2E beweist die
   Veraltet-Markierung.
2. **Sammelversand doppelt** — nicht eingetreten: Dedupe über Steer-inputId
   belegt (Integration, s. o.).
3. **Review wird zweite Chat-Engine** — nicht eingetreten: kein eigener
   Versandpfad, `sessions.steer` inkl. Policy; Queue unberührt
   (`reviews.routes.ts` ruft nur `steer`).
4. **Große Diffs lähmen Handy** — nicht eingetreten: Diff-Payload-/K3-Pfad
   unverändert; Notiz-Ausschnitte auf 400 Zeichen begrenzt
  (`REVIEW_EXCERPT_MAX_CHARS`).

### Erkenntnisse

1. Der 5-s-Diff-Cache der Ankerprüfung macht Neubewertungen verzögert
   sichtbar — E2E braucht pollende Reloads; Nutzer bemerkt davon nichts,
   Tests müssen es wissen (`review-feedback.spec.ts` Reload-Schleife).
2. `goto` mit neuem Hash lädt die PWA nicht neu — eingefrorene Ansicht
   täuschte einen Validierungsbug vor (Beleg: Debug-Lauf mit
   `pwaReviewsFetches` konstant).
3. Branch-Disziplin: `git checkout -b` ohne Basis lief vom falschen Zweig
   — !323 enthielt ungewollt P36-Code; behoben durch neuen Branch-Namen
   statt History-Rewrite (!324). Implizite Faustregel: Basis immer nennen.
4. Runner-Queue (Concurrency 1) dominiert die Taktrate: redundante
   Branch-Pipelines zu canceln spart je ~35 min; BUG-0092-Fensterregel
   (keine schweren lokalen Läufe neben CI) hat zweimal das Timing bestimmt.

### Action Items

- AI-P36-1: BUG-0106 (tool-pane-Esc-CI-Flake) beobachten, bei Reproduktion
  Rot-Grün-Fix — zurück als: bugs/bug-0106-tool-pane-esc-flake.md (open).
- AI-P36-2: Mobile-Anker-Auswahl im echten Gerät-Handling prüfen
  (Langzeilen, TalkBack) — zurück als: Endabnahme-Block T35.16
  (EPIC-P35 §8).
- AI-P36-3: P37 kann an `ReviewScope`/`ReviewNote` andocken; bei
  Diff-Typ-Vereinheitlichung in Contracts ADR anpassen — zurück als:
  EPIC-P37-Planung bzw. neues ADR.

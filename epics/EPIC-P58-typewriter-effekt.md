# EPIC-P58 — Typewriter-Effekt: Chat und Thinking werden getippt

**Status:** abgeschlossen 2026-11-14 · **Phase:** P58 · **Dauer:** ~1 Agenten-Woche (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene (Quer-Epic, Präzedenz P50–P53; Vorgänger-Phase P57 abgeschlossen 13.11.2026). Baut auf P1.6/P43-Bewegungssprache und P8/P18-Rendering auf, ändert deren Verträge nicht.

Quelle: Nutzerauftrag vom 14.11.2026; Recherche mit Bestand:
[2026-11-14](../docs/2026-11-14_recherche_verfeinerungen_typewriter_metriken.md).

## 1. Ziel

Chat-Output sowie der Thinking-/Reasoning-Verlauf werden in der PWA
sichtbar wie von einem Menschen getippt, wenn Inhalt live eintrifft. In den
Einstellungen an-/ausschaltbar. Kein Datenverlust, keine veränderten
Verträge: reine clientseitige Darstellung. Messlatten K2 (kein Frame-Lag
bei 30 Events/s, Einschaltverhalten gemessen), K5 (keine neuen/besseren
Payloads — alles bleibt wie es ist), K10 (Offline-Anzeige ehrlich), K7
(keine neue State-Quelle: Typewriter-Zustand ist flüchtig).

## 2. Scope (In / Out)

**In:** Clientseitige Tipp-Animation für neu eintreffende Chat-Antworten und
Thinking-/Reasoning-Texte; Settings-Schalter (persistiert, geräte-lokal);
Fallbacks (Reduce Motion, Tempo-Grenze, History); neuer Spec
`e2e/specs/typewriter.spec.ts`; Funktionsinventar-Eintrag.
**Out:** Vertrags-/EventStore-Änderungen (kein ADR nötig, weil nichts geteilt
wird); Tool-/System-Zeilen bleiben wie sie sind (nur Agententext und
Reasoning werden getippt); Server-seitiges Stream-Timing; LLM-TTFS — die
Wartezeit auf das erste Zeichen ändert sich nicht, nur die Anzeige des
Zuflusses.

## 3. Design-Details

### 3.1 Bestand und Einbauort

Live-Darstellung heute: `features/session/ChatTurns.tsx`, `EventRow.tsx`
(Thinking-Zeilen mit Collapse), `SessionTail.tsx`; Bewegungssprache zentral
über `shared/motion.ts` `motionAllowed()` (`data-ctx-motion`,
`36-motion.css`, `prefers-reduced-motion`); Settings-Schalter-Muster in
`features/settings/AppearanceSettings.tsx`; geräte-lokaler Persistenz-Stand
wie die übrigen Appearance-Settings (versionierter lokaler Speicher, P43.5-
Regel: kein kanonischer Session-State).

### 3.2 Verhalten

Getippt wird nur **neuer Live-Zuwachs** (WS/Event-Zustrom im offenen Chat).
History/Backfill nach Reload oder beim Wechsel der Session rendert sofort —
kein Replay, kein Nachholen (Sonst würde die Oberfläche Vollständigkeit
spielen, die sie nie hatte; K10-Geist). Trifft schneller Nachschub ein als
die Tipp-Geschwindigkeit hergibt, holt die Animation auf (mehr Zeichen pro
Schritt), ab einer Tempo-Grenze im K2-Bereich schaltet sie auf sofort um
(drop-on-slow zuerst, dann komplett ohne Animation). `prefers-reduced-motion`
und der zentrale Bewegungs-Schalter gewinnen immer: aus = sofort, ohne
Layout-Shift. Der neue Schalter steuert **nur** den Typewriter; Reduce
Motion und der Haupt-Schalter setzen ihn immer außer Kraft.

### 3.3 Schalter

Settings → Appearance: „Typewriter-Effekt“ (Standard: an; Reduce Motion und
der Haupt-Bewegungsschalter setzen diesen Standard außer Kraft). Persistenz
geräte-lokal nach dem Muster der bestehenden Appearance-Settings.

## 4. Aufgaben (Checkliste T58.m)

- [x] **T58.1** Design-Beschluss §3.2/§3.3 hier im Epic festzurren (Dieses Dokument ist der Maßstab; kein ADR nötig — kein Contract betroffen).
- [x] **T58.2** Tipp-Animation für Chat-Output und Thinking/Reasoning im bestehenden Renderer; Queue pro Zug, Aufhol- und Sofort-Fallback. **K2/K5.**
- [x] **T58.3** Settings-Schalter in Appearance (persistiert, geräte-lokal); Zusammenspiel mit `motionAllowed()`/Reduce Motion. **K7/K10.**
- [x] **T58.4** K2-Messlauf bei 30 Events/s mit Animation (Rahmenzeit wie im bestehenden K2-Gate); Fallback greift sichtbar. **K2.** — gemessen 2026-11-14 mit aktiviertem Typwriter: 18 138 gefilterte Ereignisse, Median 12 ms, p95 19 ms, Max 28 ms, 0 über Budget → PASS.
- [x] **T58.5** `e2e/specs/typewriter.spec.ts` (an/aus, Persistenz über Reload, Reduce-Motion-Pfad, History rendert sofort).
- [x] **T58.6** Funktionsinventar-Eintrag; `npm run gate` + PWA-Build.

## 5. Acceptance Criteria (AC-P58-k)

- **AC-P58-1 ✅:** Neuer Live-Zuwachs in Chat und Thinking/Reasoning wird
  getippt; der Schalter in den Einstellungen schaltet an und aus und die
  Wahl überlebt einen Reload.
- **AC-P58-2 ✅:** History/Backfill rendert sofort; es wird nichts nachgetippt,
  was vor dem Öffnen schon da war.
- **AC-P58-3 ✅:** Bei 30 Events/s kein Frame-Lag unter 200 ms (K2 gemessen);
  darüber greift das dokumentierte Sofort-Verhalten.
- **AC-P58-4 ✅:** Reduce Motion oder Haupt-Bewegungsschalter aus ⇒ keine
  Animation, Inhalt unverändert, kein Layout-Shift.
- **AC-P58-5 ✅:** Keine Contract-Änderung; neuer Spec grün; Funktionsinventar
  aktualisiert.

## 6. Premortem (Failure-Modi + Mitigation)

1. Animation frisst das K2-Budget bei hohem Event-Tempo → dokumentierte
   Tempo-Grenze mit Sofort-Fallback; T58.4 misst es, bevor mergefähig ist.
2. Typewriter suggeriert Vollständigkeit, die nach Reload anders aussieht
   (History sofort vs. Live getippt) → nur neuer Zuwachs wird getippt,
   History immer sofort; im Settings-Text benannt.
3. Zweiter Motion-Schalter widerspricht `prefers-reduced-motion`/dem
   Haupt-Schalter → Reduce Motion und Haupt-Schalter gewinnen immer;
   `motionAllowed()` bleibt das einzige Gate.
4. Auf kleinen Geräten ruckelt das Tippen langer Antworten → Länge
   begrenzen (ab bestimmten Beträgen schneller rendern), Rahmzeiten in
   T58.4 messen; Fallback ist Zustand, nicht Fehler.

## 7. Definition of Done

Alle T58.* und AC-P58-* mit Evidenz. `npm run gate` grün, PWA-Build grün,
Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen (nie als
Pass zählen). Neue UI-Funktion mit Spec in `e2e/specs/` und
Funktionsinventar-Eintrag; Schalter erreichtbar und dokumentiert. K5/K7
unverändert nachweisbar; kein TODO ohne Epic-Bezug.

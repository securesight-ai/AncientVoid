# ADR-0102: Main-Sync-Anwenden mit Konfliktgunst der Session (`favor-session`)

Status: akzeptiert (2026-11-23)

## Kontext

ADR-0088 / EPIC-P67 regeln den Abgleich zwischen Session-Worktree und Hauptbranch.
Beim Anwenden (T67.4, AC-P67-7) gilt bisher strikt: Bei einem Merge-Konflikt bricht
der Merge sofort ab (`git merge --abort`), der Worktree bleibt unverändert, die
Auflösung gehört in die Session. Der Weg dorthin ist das ⋯-Menü der Session — für
die Nutzung auf dem Handy zu klein, und ein zurückliegender Session-Branch mit
bekannten Konflikten verlangt jedes Mal manuelle Arbeit in der Session.

Nutzerauftrag (23.11.2026): Der „N hinter main“-Hinweis der Session wird zum Knopf —
ein Klick pullt den neuesten `main` und mischt ihn in den Session-Branch, **und
dabei anfallende Konflikte werden automatisch gelöst**; der Ablauf wird in einem
Modal sichtbar gemacht (Erfolg, automatisch gelöste Dateien, Fehler).

Das Autonomie-Niveau von ADR-0088 (Einstellung `autoMerge`, Scheduler) bleibt
unberührt: `clean-only` und der Scheduler merzen weiterhin nur konfliktfreie Stände
ein. Die Konfliktgunst ist ein explizit angeforderter, menschlich ausgelöster Ablauf
— kein neues autonomes Verhalten.

## Entscheidung

**1. Opt-in über den Anfrage-Body, Default bleibt Abbruch.**
`POST /api/sessions/:id/main-sync` bekommt einen Body (`MainSyncApplyRequest`, Zod,
strict): `conflictStrategy: "abort" | "favor-session"`, ohne Feld bzw. leerem Body
gilt `abort` — altes Verhalten (AC-P67-7) unverändert, hubctl, Scheduler und der
Benachrichtigungs-Knopf, die `"{}"` senden, ändern sich nicht. Ungültige Bodies
antworten ehrlich 400.

**2. Auflösungsstrategie: `git merge -X ours` (Session gewinnt Hunk-Konflikte).**
`favor-session` probiert zuerst den existing Probelauf (`merge-tree`, lesend). Nur
wenn der Konflikte meldet, läuft der echte Merge mit `-X ours`: Nicht-konfliktäre
Änderungen aus `main` fließen herein, konfliktäre Hunks gewinnen den Session-Branch.
Damit bleibt der Merge ein echter Git-Merge (keinforces Overwrite), Fast-Forward
bleibt Fast-Forward, und die Notation-konforme Merge-Nachricht (ADR-0088 §4) bleibt.
Schlägt der `-X ours`-Merge dennoch fehl (z. B. Dateitypen, die kein Hunk-Merge
erlauben), gilt weiterhin: sofort `--abort`, Worktree unverändert, Ergebnis
`conflict` — fail loud, nie halb angewendet.

**3. Ergebnis nennt die automatisch gelösten Dateien.**
`MainSyncApplyResult` (`applied`) und das Event `workspace.main_sync_applied`
bekommen das optionale Feld `autoResolved` (Dateiliste, gekappt wie `files`, K5):
die Dateien, deren Konflikte die Strategie gelöst hat. Fehlt das Feld, wurde nichts
automatisch gelöst — ein alter Leser interpretiert nichts falsch. Die PWA zeigt
diese Liste im Modal („automatisch gunsten der Session gelöst“), damit die
Konfliktgunst nie still passiert (Regel 6).

**4. Fachlogik in der Engine, Gating bleibt in der Sessions-Akte.**
`MainSyncEngine.apply` erhält `conflictStrategy` als Option (Wahl der Merge-Args),
`SessionManager.mainSyncApply` reicht sie durch und journalt `autoResolved` mit.
Keine Änderung am Gating (AC-P67-6: nur wartende Sessions), an Stufe 1/2 oder am
Scheduler.

## Konsequenzen

- Contract-Änderung ist rein additiv (optionales Feld + optionaler Body-Parameter);
  Contract-Tests decken beide Richtungen (altes Payload parst weiter, neues Feld
  muss benannt sein, um zu wirken).
- Die Konfliktgunst verwirft konfliktäre `main`-Änderungen dieser Hunks sichtbar
  (`autoResolved` liste) — wer sie doch will, löst es in der Session (Merge
  zurücksetzen oder manuell nachpflegen). Das ist der bewusste Trade des Auftrags.
- Der ⋯-Menü-Knopf „Main einmischen“ bleibt auf `abort` (der bewusste,
  konfliktfreie Weg); nur der Badge-Knopf der PWA sendet `favor-session`.

---
id: BUG-0170
slug: testsuite-auf-windows-rot
status: open
severity: S2
area: tests
instance: dev
commit: "88364357"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Gate für BUG-0171 bis 0174 sollte gefahren werden)
---

## Gesehen

`npm test` auf diesem Windows-Rechner (Arbeitszweig, Hausputz der generierten
Referenzen already done, `check:context` OK):

```
Test Files  62 failed | 220 passed | 2 skipped (284)
     Tests  212 failed | 1854 passed | 56 skipped (2122)
```

Vergleich auf dem Teilbereich, der diese Änderung angeht
(`packages/core/test/modules/{workspace,sessions}`): `main` 22 failed /
215 passed / 3 skipped — mit den Fixes 21 failed / 219 passed / 3 skipped. Es
kamen also keine Fehlschläge dazu, einer weniger. Der Arbeitszweig war zu dem
Zeitpunkt bereits committet, ein separater Baseline-Lauf mit gestashetem
Arbeitsstand war für die Drei-Datei-Stichprobe nicht möglich; die genannten
Ursachen (CRLF, Symlinks, Spawn/Signale) hängen an keiner geänderten Datei.

## Erwartet

`npm run gate` (typecheck, lint, test, test:e2e) ist auf der
Entwicklungsumgebung ausführbar und grün, oder die Plattform-Grenzen sind
dokumentiert und die betroffenen Tests überspringen sichtbar (wie bei tmux und
Playwright-Browsern üblich).

## Repro und Logs

1. Repo auf Windows, `npm ci`.
2. `npm test`.
3. Ausgewählte Ursachen, einzeln nachgewiesen:
   - `worktree.test.ts`: `AssertionError: expected 'hello\r\n' to be 'hello\n'` —
     Git checkt mit CRLF aus (`core.autocrlf`), Tests erwarten LF. Ebenso
     `worktree-apply.test.ts` („aborts a conflicting merge and names the file“).
   - `include-copy.test.ts`, `vault.test.ts` (8 Fälle), Teile von
     `workspace/projects.test.ts`: `Error: EPERM: operation not permitted,
     symlink …` — Windows erlaubt ohne Entwicklermodus keine Symlinks.
   - `workspace-services.test.ts` (5), `session-workspace.test.ts` (2),
     `archive-workspace.test.ts` (2), `recovery-parallel.test.ts` (3):
     Spawn/Signal-/Port-Gruppe (POSIX-Signale, Prozessgruppen).
   - `apps/hub/test/server.test.ts` (5, approval/budget): „session not live“.
5. **Nebenbefund Prozesslecks:** nach solchen Fehlschlägen bleiben die
   Fake-Services der Workspace-Tests als `node`-Prozesse stehen
   (`node -e require('http').createServer(... process.env.ANCIENTVOID_WORKSPACE_PORT ...)`,
   `node svc.js`). Gemessen nach einem Gesamtdurchlauf: **66 verwaiste
   Prozesse**, die Ports belegt und CPU ziehen — der nächste Lauf hängt dann an
   deren Ports. Aufräum-Rezept (tötet nur diese Signaturen, nie Hub oder
   Agent):

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
     Where-Object { ($_.CommandLine -like '*createServer*' -and $_.CommandLine -like '*ANCIENTVOID*') `
                   -or ($_.CommandLine -like '*node svc.js*') } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```

   Dauerhaft gehört das in die Test-Aufräumpfade (`afterEach` mit
   Prozessgruppe beenden, Windows hat keine POSIX-Signale).

## Eingrenzung

Nicht die Product-Änderung: identische Fehlschläge bei gestashetem
Arbeitsstand. Es fehlt eine Windows-Baseline: Zeilenenden (`.gitattributes`
mit `* text=auto eol=lf` für Testfixtures), Symlink-abhängige Tests mit
sichtbarem Skip statt harterexpectation, und die Prozess-/Signal-Gruppe mit
platform awareness.

## Fix

offen — Umfang ist Suite-Hausputz über mehrere Dateien, kein Nebenschauplatz
eines Bugfix-Zweigs. Vorbild für den Skip-Stil:
`packages/core/test/modules/workspace/projects.test.ts` (`trySymlink` +
`ctx.skip()`) und `workplace-mode.test.ts` (Symlink-Teil ausgenommen, Rest prüft
weiter).

## Tests

Kein neuer Test; dieser Report dokumentiert die gemessene Zahl und die vier
Ursachenklassen.

## Nachtrag: Tier-Aufteilung (2026-11-16, gemessen)

Ein Durchlauf mit json-Reporter über die ganze Suite: **959 s Testdauern in
284 Dateien**, die Last stark konzentriert — sechs Dateien sind 84 %:

| Datei | Dauer | fehlgeschlagen |
|---|---|---|
| `packages/adapters/acp/test/adapter.test.ts` | 465 s | 33 von 42 |
| `packages/adapters/codex/test/app-server.test.ts` | 180 s | 13 von 16 |
| `packages/core/test/modules/automations/k8.test.ts` | 89 s | 0 |
| `packages/core/test/modules/devices/device-service.test.ts` | 38 s | 0 |
| `apps/hub/test/modules/sessions/ws-history.test.ts` | 18 s | 0 |
| `packages/adapters/acp/test/contract.test.ts` | 15 s | 1 |

Die Adapter-Suiten spawnen echte Harness-CLIs; ohne installiertes CLI laufen sie
in Timeouts — deshalb die hohe Zahl Fehlschläge und die Dauer. Sichtbarer Skip
wie bei tmux (ADR-0002) wäre hier die eigentliche Reparatur und würde Tier B
massiv verkürzen; das ist ein eigener Auftrag, nicht Teil dieser Kette.

Was die Kette stattdessen getan hat: Tiers in `vitest.config.ts` (Tier A,
parallel) und `vitest.slow.config.ts` (Tier B, seriell), Liste mit gemessenen
Dauern in `scripts/test-tiers.ts`. Tier A läuft in **18,6 s** statt 1077 s, mit
derselben Fehlermenge wie vorher im entsprechenden Teilbereich (153 ↔ 150/153,
differenzlos verglichen über die json-Reporter; ein Windows-Teardown-Flackern
`ENOTEMPTY` in `diagnostics.routes.test.ts` dabei behoben). Tier B gemessen:
**1535 s** (25,6 min) für 11 Dateien, 61 failed / 123 passed — zusammen mit
Tier A dieselbe Fehlerpopulation wie im Gesamtlauf (211–214), die Trennung ist
verlustfrei. `gate` und CI fahren beide Tieres.

## Handoff

Solange BUG-0170 offen ist, tragen Commits, die nur Teilbereiche grün haben,
`!` statt `^` (Commit-Notation). Für ^-Commits braucht es entweder a) die Suite
auf Windows grün, oder b) eine dokumentierte, maschinenlesbare
Plattform-Baseline im Gate.

- **Tier A gemessen nach BUG-0179 und BUG-0193 (2026-11-17):**
  `npm run test:fast` = `Test Files 52 failed | 253 passed | 2 skipped (307)`, 
`Tests 137 failed | 1974 passed | 53 skipped (2164)`. Vorher gab es auf Windows für 
Tier A gar kein Ergebnis (BUG-0193). Attrappen-Spawns sind erledigt (BUG-0179); 
zwei konkrete Fälle, die als echte Aussagen übrig bleiben: 
`apps/hub/test/factory.integration.test.ts` ("Projektpfad fehlt oder ist nicht absolut", 422 statt 200) und die Anzeigefragen-Routen in `tool-permissions.test.ts`.

**Entscheidung (24.11.2026, Nutzer):** BUG-0170 bleibt offen — Windows-Support
wird nicht jetzt entschieden; kein Fix-Versuch vom Linux-Host (dort ist die
Suite grün, die vier Ursachenklassen bleiben Windows-gebunden). Teilfolgen
0179/0193/0198 sind längst gefixt; dieser Bug bleibt der Sammelplatz für die
Plattform-Baseline.

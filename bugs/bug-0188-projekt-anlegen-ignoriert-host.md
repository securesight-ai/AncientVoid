---
id: BUG-0188
slug: projekt-anlegen-ignoriert-host
status: done
severity: S2
area: pwa
instance: dev
commit: "f5fbed08"
forge: "https://github.com/securesight-ai/AncientVoid/issues/62"
epic: "EPIC-P6"
created: 2026-11-17
reporter: "Nutzer"
---

# BUG-0188 — Projekt-Anlegen in der Neuanlage ignoriert den gewählten Host

## Gesehen

Wählt man in „Neue Session“ einen anderen Host der Flotte und legt über
„neues Projekt (Name) → + Anlegen“ ein Projekt an, wird es auf dem
**heimischen** Hub angelegt (oder scheitert an dessen projectRoots) — nicht
auf dem gewählten Host. Die Projektliste springt danach zusätzlich auf die
lokalen Projekte, und das Pfad-Feld bekommt den lokalen Pfad, den der
gewählte Host beim Start mit 422 zurückweist.

## Erwartet

Das Projekt wird über die host-gebundene API (`/api/hosts/<id>/api/projects`)
auf dem **gewählten** Host angelegt (git init in dessen projectRoots), die
Liste lädt von dort nach und der Pfad des neuen Projekts wird übernommen.

## Repro

Voraussetzung: Zwei gekoppelte Hubs (Fleet, EPIC-P6), beide mit
konfigurierten projectRoots; PWA geöffnet.

1. „Neue Session“ öffnen.
2. Als Host den Peer wählen (Projektliste zeigt dessen Repos).
3. Bei „neues Projekt (Name)“ einen Namen eintragen, „+ Anlegen“ klicken.

**Ergebnis nach Schritt 3:** Pfad-Feld zeigt `<lokales-projectRoots>/<Name>`
 statt des Peer-Pfads; der Ordner liegt mit `.git` auf dem heimischen Host;
 `GET /api/projects` des Peers führt das Projekt nicht.

**Häufigkeit:** immer

E2E-Repro (gesehen, Lauf vom 2026-11-17, Playwright mobile gegen zwei echte
TestHubs):

```text
Error: expect(received).toContain(expected) // indexOf
Expected substring: "/tmp/ancientvoid-e2e-VdTHp1/projects"   ← Peer
Received string:    "/tmp/ancientvoid-e2e-8086HL/projects/fern-projekt" ← heimischer Hub
```

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E: zwei TestHubs, `workstation` + `home-server`) |
| Commit | `f5fbed08` |
| Node-Version | 22 (E2E-Runner) |
| Adapter | – (betrifft Neuanlage, nicht Adapter) |
| Repro-Weg | PWA (E2E `e2e/specs/fleet.spec.ts`) |

## Logs

Kein Server-Log beteiligt — der heimische Hub führt das POST korrekt aus;
der Defekt sitzt allein im PWA-Call. E2E-Beweis siehe Repro.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/fleet.spec.ts` → „BUG-0188: neues Projekt wird auf dem gewählten Host angelegt" | neu, rot (Pfad zeigte auf Heimat-Hub) |
| Integration | `apps/hub/test/modules/fleet/fleet-routing.test.ts` → „Fleet-Projektanlage (BUG-0188)" | neu, rot (502 durch die Policy-Lücke) |
| Contract | `packages/contracts/test/approvals/policy.test.ts` → `projects.create` | neu |
| Unit | `apps/pwa/test/features/new-session/project-create.test.ts` (`createProjectOnHost`) | neu |

Ohne Fix rot: die E2E und die Fleet-Routing-Integration oben.

## Eingrenzung

Zwei Stellen, beide nötig für das Symptom:

1. **PWA** `apps/pwa/src/features/new-session/CreateSession.tsx` —
   `createNewProject` rief `hubApi.createProject()` (Z. 122) statt der
   host-gebundenen `api` auf; Nachladen der Liste ebenso `hubApi.projects()`
   (Z. 125) und `setProject(res.project.path)` (Z. 127) schrieb den lokalen
   Pfad ins Formular.
2. **Policy** `apps/hub/src/platform/policy.ts` — `operationOf()` mappte
   `POST /api/projects` auf keine Operation; nicht gemappte Writes gelten
   fail-closed deny, auch für `fleet:<heim>`-Tokens. Der Peer verweigerte das
   korrekt geroutete POST also mit
   `403 {"error":"Nicht erlaubt für fleet:workstation: POST /api/projects"}`
   (manuell reproduziert, s. Repro), und der Proxy meldete daraus 502
   „unauthorized". Behoben mit der neuen Operation `projects.create`
   (`packages/contracts/src/approvals/policy.ts`, Mensch + Fleet allow,
   Agenten/Brücke/Companion/Display deny — Muster `skills.write`; ADR-0017
   führt „Projekte" in der Positivliste der host-gebundenen Aktionen).

Das Backend konnte sonst längst: `/api/projects` steht in `FLEET_ROUTABLE`
(`packages/contracts/src/fleet/fleet.ts:40`), der Proxy leitet POST durch
(`apps/hub/src/modules/fleet/fleet-proxy.ts:133`), Fleet-Tokens dürfen den
Pfad erreichen (`apps/hub/src/platform/auth.ts:52`).

Dazu vom Nutzer gewünscht (gleicher PR, eigener Commit): der Host-DDL steht
in der Neuanlage jetzt **zuerst** — Pfad und wählbares Repo hängen vom Host
ab. Vorher stand er unter Pfad (E2E: Label-Index 2 statt 0).


## Fix

Behoben: PR #71 (`0ef89869`). Doku-Abschluss 2026-11-21 (Status-Nachzug).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` läuft

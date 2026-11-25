# ADR-0123 — Begriffe: Swarm für Agenten, Team für Menschen mit ihren Agenten

**Status:** angenommen (Nutzerentscheid 24.11.2026); Umsetzung mit T83.1 · **Ersetzt:** ADR-0077 §1
und §2 (Benennung) · **Bezug:** ADR-0001, ADR-0065, ADR-0077, EPIC-P83

## Entscheidung

- **Swarm** = mehrere Agenten *eines* Nutzers, die einen Auftrag gemeinsam erledigen (bisher
  „Agenten-Team“).
- **Team** = mehrere Menschen mit ihren Instanzen und Agenten (EPIC-P83).

| Bisher | Neu |
|---|---|
| `Team*`-Typen, `TEAM_ERRORS` | `Swarm*`, `SWARM_ERRORS` |
| Module `team/` in contracts, core, hub, pwa | `swarm/` |
| `/api/teams`, `team.manage`, `team.read` | `/api/swarms`, `swarm.manage`, `swarm.read` |
| `data/team/teams.jsonl` | `data/swarm/swarms.jsonl` |
| `#/teams?team=`, Dock „Teams“ | `#/swarms?swarm=`, Dock „Swarms“; „Teams“ wird die neue Seite |
| Automations-Ziel `kind: "team"`, `teamId` | `kind: "swarm"`, `swarmId` |
| Fence `team`, Actor `"team"` | Fence `swarm`; Actor = Auftraggeber |
| `34-teams.css`, `team.spec.ts`, `team_stat_facts` | `34-swarms.css`, `swarm.spec.ts`; Tabelle bleibt, nur Zugriff benannt |

## Regeln für die Umstellung

1. Zwei getrennte PRs: erst Umbenennung ohne neues Verhalten, danach erst die neue Bedeutung.
2. Migration wie ADR-0077 §3: einmalig, Altdateien bleiben, Altdaten-Fixture, Zähler im Bericht.
3. Persistiertes `kind: "run"` und `"team"` heißt **immer** Swarm; die neue Bedeutung nutzt `"team"`
   dort nie. Plan-Fences `team` und `orchestration` bleiben lesbar.
4. Neue Teamdaten liegen unter `data/teams/`, nie unter `data/team/`.
5. Alte Links `#/teams?team=` und `#/runs?run=` führen dauerhaft zu Swarms; neue Teamlinks nutzen
   `#/teams?id=`. `/api/teams` gibt es bis zur neuen Bedeutung nicht (404, kein stiller Alias).
6. `hubctl` nimmt `team` und `run` beim Automations-Ziel als Alias für `swarm`.
7. Der nie umgesetzte Adapter `swarm` (ADR-0001) ist eine Adapter-ID, kein Modul. Er bekommt in der
   Oberfläche keinen Eintrag „Swarm“; kommt er je, heißt er `securesight-swarm`.

## Folgen

Contract-Break mit toleranter Lesung. Inventur der Verwender per grep-Protokoll ist erster Schritt von
T83.1; Ausgangspunkt ist der Anhang von ADR-0077.

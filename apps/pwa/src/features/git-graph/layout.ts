import type { GitGraphCommit } from "@ancientvoid/contracts";

/** Eine Zeile im Graph: Commit + Lane + Verbindungspunkte für Eltern. */
export interface GitGraphRow {
  commit: GitGraphCommit;
  lane: number;
  /** Lanes, die in dieser Zeile weiterlaufen (ohne den Commit-Knoten). */
  active: number[];
  /** Eltern-Verbindungen: von dieser Lane zur Parent-Lane (nach unten). */
  edges: { fromLane: number; toLane: number; colorLane: number }[];
  /** true, wenn ≥2 Eltern (Merge-Punkt). */
  merge: boolean;
}

/**
 * Klassisches Git-Graph-Lane-Layout (neueste zuerst).
 * BUG-0190: First-Parent behält die Lane des Kindes; keine doppelte
 * Lane-Zuweisung für denselben Parent; freigewordene Spuren werden wiederverwendet.
 */
export function layoutGitGraph(commits: readonly GitGraphCommit[]): { rows: GitGraphRow[]; laneCount: number } {
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  const laneOf = new Map<string, number>();
  const rows: GitGraphRow[] = [];
  let nextLane = 0;
  let active: (string | null)[] = [];

  const usedLanes = (): Set<number> => {
    const used = new Set<number>();
    for (let i = 0; i < active.length; i++) if (active[i]) used.add(i);
    return used;
  };

  const freeLane = (used: Set<number>): number => {
    for (let i = 0; i < nextLane; i++) if (!used.has(i)) return i;
    return nextLane++;
  };

  for (const commit of commits) {
    let lane = laneOf.get(commit.sha);
    if (lane === undefined) {
      lane = freeLane(usedLanes());
      laneOf.set(commit.sha, lane);
    }
    while (active.length <= lane) active.push(null);
    active[lane] = commit.sha;

    const edges: GitGraphRow["edges"] = [];
    const parents = commit.parents;

    parents.forEach((p, pi) => {
      let pLane = laneOf.get(p);
      if (pLane === undefined) {
        if (pi === 0) {
          pLane = lane;
        } else {
          const used = usedLanes();
          used.add(lane);
          pLane = freeLane(used);
          while (active.length <= pLane) active.push(null);
        }
        laneOf.set(p, pLane);
      }
      edges.push({ fromLane: lane, toLane: pLane, colorLane: pLane });
    });

    // Commit verlässt alle Spuren; First-Parent übernimmt nur, wenn noch frei
    // (BUG-0190: ein späterer Side-Tip stiehlt dem Main-Tip nicht die Lane).
    for (let i = 0; i < active.length; i++) {
      if (active[i] === commit.sha) active[i] = null;
    }
    if (parents.length > 0) {
      const first = parents[0]!;
      const claimed = laneOf.get(first);
      if (claimed === undefined || claimed === lane) {
        laneOf.set(first, lane);
        active[lane] = first;
      } else {
        active[claimed] = first;
      }
      for (let pi = 1; pi < parents.length; pi++) {
        const p = parents[pi]!;
        const pLane = laneOf.get(p);
        if (pLane !== undefined) active[pLane] = p;
      }
    }

    const commitIdx = index.get(commit.sha)!;
    const activeLanes = active
      .map((s, i) => (s && index.has(s) && index.get(s)! > commitIdx ? i : -1))
      .filter((i) => i >= 0);

    rows.push({
      commit,
      lane,
      active: activeLanes,
      edges,
      merge: parents.length > 1,
    });
  }

  const laneCount = Math.max(1, ...rows.map((r) => Math.max(r.lane, ...r.active, ...r.edges.map((e) => Math.max(e.fromLane, e.toLane))) + 1));
  return { rows, laneCount };
}

export const GIT_LANE_COLORS = [
  "var(--accent)",
  "#9ece6a",
  "#e0af68",
  "#bb9af7",
  "#7dcfff",
  "#f7768e",
  "#73daca",
  "#c0caf5",
];

const AV_WT = /^ancientvoid\/([0-9a-f-]{8,})$/i;

/**
 * BUG-0190: Worktree-Branches `ancientvoid/<uuid>` lesbar kürzen;
 * voller Name bleibt im title/Hover.
 */
export function formatGitRefLabel(name: string): { label: string; title: string } {
  const m = AV_WT.exec(name);
  if (!m) return { label: name, title: name };
  const id = m[1]!;
  const short = id.length > 8 ? id.slice(0, 8) : id;
  return { label: `Session ${short}…`, title: name };
}

/** Ein Chip am Commit: lokaler Branch (ggf. mit Remote-Gegenstück) oder reiner Remote-Ref. */
export interface GitRefChip {
  label: string;
  title: string;
  /** `origin/<name>` zeigt auf denselben Commit — im Chip als „⇄ origin“ gekennzeichnet. */
  withRemote: boolean;
  remoteOnly: boolean;
  /** Worktree-Branch einer Agenten-Session. */
  session: boolean;
}

const REMOTE_PREFIX = /^(origin|upstream)\//;

/**
 * Refs eines Commits zu Chips verdichten, wie VS-Code-Git-Graph: `main` und
 * `origin/main` auf demselben Commit werden EIN Chip (lokal = Remote), sonst
 * wirkt jeder Branch doppelt und der Verlauf unübersichtlich.
 */
export function groupGitRefs(refs: readonly string[]): GitRefChip[] {
  const locals = refs.filter((r) => !REMOTE_PREFIX.test(r));
  const remotes = refs.filter((r) => REMOTE_PREFIX.test(r));
  const chips: GitRefChip[] = [];
  const matched = new Set<string>();
  for (const name of locals) {
    const remote = remotes.find((r) => r.replace(REMOTE_PREFIX, "") === name);
    if (remote) matched.add(remote);
    const { label, title } = formatGitRefLabel(name);
    chips.push({ label, title: remote ? `${title} (= ${remote})` : title, withRemote: Boolean(remote), remoteOnly: false, session: AV_WT.test(name) });
  }
  for (const name of remotes) {
    if (matched.has(name)) continue;
    chips.push({ label: name, title: name, withRemote: false, remoteOnly: true, session: AV_WT.test(name.replace(REMOTE_PREFIX, "")) });
  }
  return chips;
}

/** Woher ein Merge-Commit kommt: die zweiten (und weiteren) Eltern. */
export interface GitMergeSource {
  shortSha: string;
  /** Bester Name: lokaler Branch > Remote > nichts (dann zählt der Kurz-Hash). */
  name: string | null;
  /** Eltern-Commit liegt außerhalb des geladenen Verlaufs. */
  outside: boolean;
}

export function mergeSources(commit: GitGraphCommit, bySha: ReadonlyMap<string, GitGraphCommit>): GitMergeSource[] {
  return commit.parents.slice(1).map((sha) => {
    const parent = bySha.get(sha);
    const chips = parent ? groupGitRefs(parent.refs) : [];
    const best = chips.find((c) => !c.remoteOnly) ?? chips[0];
    return { shortSha: parent?.shortSha ?? sha.slice(0, 7), name: best ? best.label : null, outside: !parent };
  });
}

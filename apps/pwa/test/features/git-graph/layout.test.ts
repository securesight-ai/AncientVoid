import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "@ancientvoid/contracts";
import { formatGitRefLabel, groupGitRefs, layoutGitGraph, mergeSources } from "../../../src/features/git-graph/layout.ts";

function c(partial: Partial<GitGraphCommit> & Pick<GitGraphCommit, "sha" | "parents" | "subject">): GitGraphCommit {
  return {
    shortSha: partial.sha.slice(0, 7),
    author: "a",
    date: "2026-01-01T00:00:00Z",
    refs: [],
    files: [],
    ...partial,
  };
}

describe("layoutGitGraph", () => {
  it("weist Lanes zu und markiert Merges", () => {
    const commits = [
      c({ sha: "m1", parents: ["a1", "b1"], subject: "merge" }),
      c({ sha: "b1", parents: ["a0"], subject: "side" }),
      c({ sha: "a1", parents: ["a0"], subject: "main tip" }),
      c({ sha: "a0", parents: [], subject: "root" }),
    ];
    const { rows, laneCount } = layoutGitGraph(commits);
    expect(rows).toHaveLength(4);
    expect(laneCount).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.merge).toBe(true);
    expect(rows[0]!.edges.length).toBe(2);
    expect(rows[3]!.merge).toBe(false);
  });

  it("BUG-0190: First-Parent bleibt auf der Kind-Lane; Side-Branch verbindet sauber", () => {
    const commits = [
      c({ sha: "tip", parents: ["main1"], subject: "on main" }),
      c({ sha: "side", parents: ["main1"], subject: "side tip" }),
      c({ sha: "main1", parents: ["root"], subject: "shared" }),
      c({ sha: "root", parents: [], subject: "root" }),
    ];
    const { rows } = layoutGitGraph(commits);
    const tip = rows[0]!;
    const side = rows[1]!;
    const shared = rows[2]!;
    expect(tip.lane).not.toBe(side.lane);
    // First parent of tip continues on tip's lane
    expect(tip.edges[0]!.toLane).toBe(tip.lane);
    // Shared commit sits on tip's (first-parent) lane, not a third orphan lane
    expect(shared.lane).toBe(tip.lane);
    // Side edge reaches the shared commit's lane by the time shared is drawn
    expect(side.edges[0]!.toLane).toBe(shared.lane);
  });
});

describe("formatGitRefLabel (BUG-0190)", () => {
  it("kürzt ancientvoid/<uuid>, lässt normale Refs unverändert", () => {
    const id = "293fec7c-1037-4b72-9354-900d6e455a69";
    const { label, title } = formatGitRefLabel(`ancientvoid/${id}`);
    expect(label).toMatch(/^Session 293fec7c/);
    expect(title).toBe(`ancientvoid/${id}`);
    expect(formatGitRefLabel("main")).toEqual({ label: "main", title: "main" });
    expect(formatGitRefLabel("origin/feat/x")).toEqual({ label: "origin/feat/x", title: "origin/feat/x" });
  });
});

describe("groupGitRefs", () => {
  it("fasst main und origin/main auf demselben Commit zu einem Chip zusammen", () => {
    const chips = groupGitRefs(["main", "origin/main", "origin/feature"]);
    expect(chips.map((x) => x.label)).toEqual(["main", "origin/feature"]);
    expect(chips[0]).toMatchObject({ withRemote: true, remoteOnly: false });
    expect(chips[1]).toMatchObject({ remoteOnly: true });
  });

  it("kennzeichnet Worktree-Branches", () => {
    const [chip] = groupGitRefs(["ancientvoid/26e91d83-125a-441c-b9d6-add5b0447d52"]);
    expect(chip).toMatchObject({ session: true, label: "Session 26e91d83…" });
  });
});

describe("mergeSources", () => {
  const commits = [
    c({ sha: "m1", parents: ["a1", "b1"], subject: "merge" }),
    c({ sha: "b1", parents: ["a0"], subject: "side", refs: ["origin/feat", "feat"] }),
    c({ sha: "a1", parents: ["a0"], subject: "main" }),
  ];
  const bySha = new Map(commits.map((x) => [x.sha, x]));

  it("nennt den eingeführten Branch statt nur des Hashs", () => {
    expect(mergeSources(commits[0]!, bySha)).toEqual([{ shortSha: "b1", name: "feat", outside: false }]);
  });

  it("meldet Eltern außerhalb des geladenen Verlaufs", () => {
    const m = c({ sha: "m2", parents: ["a1", "zzzzzzzzzz"], subject: "merge" });
    expect(mergeSources(m, bySha)).toEqual([{ shortSha: "zzzzzzz", name: null, outside: true }]);
  });

  it("liefert für Nicht-Merges nichts", () => {
    expect(mergeSources(commits[2]!, bySha)).toEqual([]);
  });
});

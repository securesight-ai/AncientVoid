import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProjectSkills } from "../../../src/modules/skills/skills.ts";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/test/modules/skills/skills.test.ts -> repo root is five levels up.
const repoRoot = join(here, "..", "..", "..", "..", "..");

describe("scanProjectSkills — real repo inventory (T1.5-10, AC-P1.5-10)", () => {
  it("finds exactly this repo's real 19 skills and 3 agents, no exceptions included", async () => {
    const items = await scanProjectSkills(repoRoot);
    const skills = items.filter((i) => i.kind === "skill").map((i) => i.name).sort();
    const agents = items.filter((i) => i.kind === "agent").map((i) => i.name).sort();

    expect(skills).toEqual(
      [
        "architecture-best-practices",
        "bug-report",
        "bugfix",
        "concept-phase",
        "context-audit",
        "epic-creation",
        "factory",
        "gates",
        "head-n",
        "git-workflow",
        "hub-neustart-live",
        "layout-beweis",
        "messlauf",
        "ponytail-review",
        "pr-review",
        "retro",
        "sort",
        "setup-wizard",
        "write-tests",
      ].sort(),
    );
    expect(agents).toEqual(["epic-planner", "hub-dev", "pwa-dev"].sort());

    // The real, known exceptions must never appear.
    expect(skills).not.toContain("_shared");
    expect(skills).not.toContain("README");
    expect(skills).not.toContain("skill-template");
  });

  it("every item has a non-empty description from real frontmatter", async () => {
    const items = await scanProjectSkills(repoRoot);
    for (const item of items) {
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it("folds bug-report's real multi-line >- description instead of literal '>-'", async () => {
    // Regression for a real bug found via a Playwright screenshot of the
    // skill overlay: bug-report/SKILL.md is the one real file in this repo
    // using a YAML folded block scalar (`description: >-`); the old
    // line-based parser captured the literal ">-" instead of the text.
    const items = await scanProjectSkills(repoRoot);
    const bugReport = items.find((i) => i.kind === "skill" && i.name === "bug-report");
    expect(bugReport?.description).not.toBe(">-");
    expect(bugReport?.description).toBe(
      "Legt einen beobachteten Defekt als bugs/bug-NNNN-slug.md an — mit Repro " +
        "(PWA oder hubctl), Logs und Testluecke. Aktiv bei „Bug anlegen\", „Fehler " +
        "dokumentieren\", „Issue erstellen\", Dev-Funden ohne Fix, oder wenn bugfix " +
        "keine Datei in bugs/ vorfindet. Nicht zum Patchen (das ist bugfix).",
    );
  });
});

describe("scanProjectSkills — synthetic edge cases", () => {
  async function freshDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-skills-"));
    return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("a project without .claude/ at all yields an empty list, not an error", async () => {
    const { dir, cleanup } = await freshDir();
    try {
      expect(await scanProjectSkills(dir)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("ignores a skills subdirectory without a SKILL.md (e.g. _shared/)", async () => {
    const { dir, cleanup } = await freshDir();
    try {
      const skillsDir = join(dir, ".claude", "skills");
      await mkdir(join(skillsDir, "_shared"), { recursive: true });
      await mkdir(join(skillsDir, "real-skill"), { recursive: true });
      await writeFile(
        join(skillsDir, "real-skill", "SKILL.md"),
        "---\nname: real-skill\ndescription: does a thing\n---\n\nbody",
      );
      const items = await scanProjectSkills(dir);
      expect(items).toEqual([{ kind: "skill", name: "real-skill", description: "does a thing" }]);
    } finally {
      await cleanup();
    }
  });

  it("ignores loose files directly under skills/ (README.md, skill-template.md)", async () => {
    const { dir, cleanup } = await freshDir();
    try {
      const skillsDir = join(dir, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, "README.md"), "not a skill");
      await writeFile(join(skillsDir, "skill-template.md"), "not a skill either");
      const items = await scanProjectSkills(dir);
      expect(items.filter((i) => i.kind === "skill")).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("folds a synthetic multi-line description: >- block into one joined line", async () => {
    const { dir, cleanup } = await freshDir();
    try {
      const skillsDir = join(dir, ".claude", "skills");
      await mkdir(join(skillsDir, "folded"), { recursive: true });
      await writeFile(
        join(skillsDir, "folded", "SKILL.md"),
        "---\nname: folded\ndescription: >-\n  first line\n  second line\n---\n\nbody",
      );
      const items = await scanProjectSkills(dir);
      expect(items).toEqual([{ kind: "skill", name: "folded", description: "first line second line" }]);
    } finally {
      await cleanup();
    }
  });

  it("ignores an agent .md whose name doesn't matter, but skips non-.md files", async () => {
    const { dir, cleanup } = await freshDir();
    try {
      const agentsDir = join(dir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(join(agentsDir, "real-agent.md"), "---\nname: real-agent\ndescription: does agent things\n---\n");
      await writeFile(join(agentsDir, "notes.txt"), "not an agent");
      const items = await scanProjectSkills(dir);
      expect(items).toEqual([{ kind: "agent", name: "real-agent", description: "does agent things" }]);
    } finally {
      await cleanup();
    }
  });
});

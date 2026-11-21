import { describe, it, expect } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { extractRuns, classifyResult, evaluateRuns, normalizeCommand, signatureParts, mineSequences } from "./skill-runs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "skill-runs");

describe("skill-runs extract (T72.6)", () => {
  it("liefert fuer jede Adapter-Fixture den erwarteten Datensatz", () => {
    const runs = extractRuns(fixtureRoot);
    const expected = JSON.parse(readFixture("expected.json"));
    expect(runs).toEqual(expected);
  });

  it("ist deterministisch: zweimal hintereinander byte-gleich", () => {
    expect(JSON.stringify(extractRuns(fixtureRoot))).toBe(JSON.stringify(extractRuns(fixtureRoot)));
  });

  it("BUG-0247/0248: maki/opencode-Fixtures tragen command (shellWithoutCommand = 0)", () => {
    const runs = extractRuns(fixtureRoot);
    const maki = runs.find((r) => r.adapter === "maki");
    const opencode = runs.find((r) => r.adapter === "opencode");
    expect(maki.unparsed.shellWithoutCommand).toBe(0);
    expect(opencode.unparsed.shellWithoutCommand).toBe(0);
    expect(maki.commands.map((c) => c.cmd)).toEqual(["npm test", "npm run lint"]);
    expect(opencode.commands.map((c) => c.cmd)).toEqual(["npm run lint", "echo hi"]);
  });

  it("resolviert K5-Blobs und zaehlt fehlende Blobs sichtbar (blobMissing)", () => {
    const runs = extractRuns(fixtureRoot);
    const claude = runs.find((r) => r.adapter === "claude");
    expect(claude.commands.map((c) => c.cmd)).toContain("npm run test:fast"); // kam aus dem Blob
    const tmp = tmpFixtureCopy();
    rmSync(join(tmp, "sessions", "a0000000-0000-4000-8000-000000000001", "blobs", "aaa111"));
    const run = extractRuns(tmp).find((r) => r.adapter === "claude");
    expect(run.unparsed.blobMissing).toBe(1);
    expect(run.commands.map((c) => c.cmd)).not.toContain("npm run test:fast");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("joinet turn_metrics ueber hub.db (read-only)", () => {
    const tmp = tmpFixtureCopy();
    const db = new DatabaseSync(join(tmp, "hub.db"));
    db.exec("CREATE TABLE turn_metrics (session_id TEXT, tokens INTEGER, tokens_source TEXT, cost_usd REAL)");
    db.prepare("INSERT INTO turn_metrics VALUES (?, ?, ?, ?)").run("a0000000-0000-4000-8000-000000000005", 1200, "native", 0.04);
    db.prepare("INSERT INTO turn_metrics VALUES (?, ?, ?, ?)").run("a0000000-0000-4000-8000-000000000005", 800, "native", 0.01);
    db.close();
    const pi = extractRuns(tmp).find((r) => r.adapter === "pi");
    expect(pi.cost).toEqual({ usd: 0.05, tokens: 2000, source: "native", turns: 2 });
    rmSync(tmp, { recursive: true, force: true });
  });

  it("filtert nach --since und --project", () => {
    expect(extractRuns(fixtureRoot, { since: "2026-11-19T00:00:00.000Z" })).toEqual([]);
    expect(extractRuns(fixtureRoot, { since: "2026-11-17T00:00:00.000Z" })).toHaveLength(5);
    expect(extractRuns(fixtureRoot, { project: "anderesprojekt" })).toEqual([]);
  });

  it("ueberspringt stream_event-Zeilen (claude-Fixture: genau 2 Befehle)", () => {
    const claude = extractRuns(fixtureRoot).find((r) => r.adapter === "claude");
    expect(claude.commands).toHaveLength(2);
    expect(claude.skills).toEqual({ chain: ["git-workflow"], invoked: ["git-workflow"] });
  });
});

describe("classifyResult — Exit-Formate und Fehlerklassen (nur erste Zeile, nur die Zahl)", () => {
  it.each([
    ["exit code 2", 2],
    ["exit code: 3", 3],
    ["exited with code 1", 1],
    ["Process exited with code 1", 1],
    ["Exit code 130", 130],
  ])("Erstes Format: %s → exit %i", (line, n) => {
    expect(classifyResult(line, true)).toEqual({ error: "exit-nonzero", exit: n });
  });

  it("exit 0 auf erster Zeile ist ok", () => {
    expect(classifyResult("exit code 0", false)).toEqual({ error: null, exit: 0 });
  });

  it("Zahl erst ab Zeile 2 zaehlt nicht (isError bleibt Klasse ohne exit)", () => {
    expect(classifyResult("failure\nexit code 7", true)).toEqual({ error: "error", exit: null });
  });

  it("Präfix-Klassen: permission-denied, blocked, approval-timeout", () => {
    expect(classifyResult("Permission denied by user", true).error).toBe("permission-denied");
    expect(classifyResult("Blocked: sleep 30 in automation", true).error).toBe("blocked");
    expect(classifyResult("Keine Freigabe innerhalb 60s", true).error).toBe("approval-timeout");
  });

  it("isError ohne Muster → error ohne exit", () => {
    expect(classifyResult("irgendwas schiefgelaufen", true)).toEqual({ error: "error", exit: null });
  });
});

function readFixture(name) {
  return readFileSync(join(fixtureRoot, name), "utf8");
}
function tmpFixtureCopy() {
  const tmp = mkdtempSync(join(tmpdir(), "skill-runs-"));
  cpSync(fixtureRoot, tmp, { recursive: true });
  return tmp;
}

describe("evaluateRuns — Regelkatalog (T72.7)", () => {
  const catalog = JSON.parse(readFileSync(join(here, "..", ".claude", "skills", "_shared", "skill-checks.json"), "utf8"));
  const expectation = JSON.parse(readFileSync(join(here, "skill-regression", "expected.json"), "utf8"));

  for (const [ruleId, exp] of Object.entries(expectation)) {
    for (const [side, want] of Object.entries(exp)) {
      it(`${ruleId}: ${side} → ${want}`, () => {
        const run = JSON.parse(readFileSync(join(here, "skill-regression", "cases", `${ruleId}.${side}.json`), "utf8"));
        const hits = evaluateRuns([run], catalog).filter((h) => h.ruleId === ruleId);
        if (want === "hit") expect(hits.filter((h) => !h.guard)).toHaveLength(1);
        else if (want === "nohit") expect(hits).toHaveLength(0);
        else if (want === "nohit-guarded") expect(hits.every((h) => h.guard)).toBe(true);
      });
    }
  }

  it("scope invoked: Regel trifft nur bei zugeordnetem Skill", () => {
    const run = JSON.parse(readFileSync(join(here, "skill-regression", "cases", "bugfix-red-then-green.positive.json"), "utf8"));
    run.skills = { chain: [], invoked: [] };
    expect(evaluateRuns([run], catalog).filter((h) => h.ruleId === "bugfix-red-then-green")).toHaveLength(0);
  });

  it("Start-Katalog: max 8 Regeln, jede mit Positiv- und Negativ-Fixture", () => {
    const rules = Object.entries(catalog).filter(([k]) => k !== "$config").flatMap(([, v]) => v);
    expect(rules.length).toBeLessThanOrEqual(8);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(existsSync(join(here, "skill-regression", "cases", `${r.id}.positive.json`))).toBe(true);
      expect(existsSync(join(here, "skill-regression", "cases", `${r.id}.negative.json`))).toBe(true);
    }
  });
});

describe("Signatur-Normalisierung und Mining (T72.8)", () => {
  // Paare aus echten Befehlen (anonymisiert): links/rechts NACH Normalisierung gleich.
  const equalPairs = [
    ["cat docs/adr/0100-x.md", "cat docs/adr/0123-y.md"],
    ["git log --oneline | head -20", "git log --oneline | head -5"],
    ["npm run test:fast packages/core", "npm run test:fast packages/adapters"],
    ['git commit -m "fix a"', 'git commit -m "fix b"'],
    ["wc -l 120", "wc -l 45"],
    ["grep -rn 'todo' packages/core", "grep -rn 'fixme' packages/core"],
    ["sed -n '1,20p' AGENTS.md", "sed -n '1,5p' AGENTS.md"],
    ["node scripts/check-context.mjs", "node scripts/check-media.mjs"],
    ["/data/sessions/04b490d2-ab46-4e07-b350-4319652accf8/events.jsonl", "/data/sessions/babe0000-0000-4000-8000-000000000000/events.jsonl"],
    ["git push origin feat/a-1", "git push origin feat/b-2"],
    ["npm test | grep -c 'FAIL'", "npm test | grep -c 'ERROR'"],
    ['echo "a" && npm run lint', 'echo "b" && npm run lint'],
    ["head -n 50 README.md", "head -n 10 README.md"],
    ["kill 1234", "kill 5678"],
  ];
  const unequalPairs = [
    ["npm run lint", "npm run typecheck"],
    ["git commit -m x", "git push origin x"],
    ["npm test | grep foo", "npm test | wc -l"],
    ["git merge feature main", "git merge feature dev"],
    ["npm test", "npm test | grep foo"],
    ['echo "a" && npm run lint', 'echo "a" && npm run typecheck'],
    ["git push origin main", "git push origin topic"],
    ["npm run lint", "npm run lint --fix"],
  ];

  for (const [a, b] of equalPairs) it(`gleich: ${a} ≡ ${b}`, () => expect(normalizeCommand(a)).toBe(normalizeCommand(b)));
  for (const [a, b] of unequalPairs) it(`ungleich: ${a} ≢ ${b}`, () => expect(normalizeCommand(a)).not.toBe(normalizeCommand(b)));

  it("zerlegt Pipes/&& in Einzelschritte, Fehlerklasse an jeder Signatur", () => {
    expect(signatureParts("npm run lint && git add -A | head -3", "exit-nonzero")).toEqual([
      "npm run lint#exit-nonzero",
      "git add -A#exit-nonzero",
      "head -<n>#exit-nonzero",
    ]);
    expect(signatureParts("npm run lint", null)).toEqual(["npm run lint#ok"]);
  });

  it("Mining: Kandidat ab >= 3 Vorkommen in >= 2 Sessions, Lesebefehle raus, sortiert nach Hits x Ø-Kosten", () => {
    const run = (sessionId, cmds, usd) => ({
      sessionId, adapter: "pi", project: "/anon/av", skills: { chain: [], invoked: [] }, prompts: [],
      commands: cmds.map(([cmd, error], i) => ({ seq: i + 1, cmd, error, exit: error ? 1 : null })),
      cost: { usd, tokens: 100, source: "native", turns: 1 },
      unparsed: { shellWithoutCommand: 0, blobMissing: 0, unknownShape: 0 },
    });
    const runs = [
      run("s1", [["npm run lint", null], ["cat README.md", null], ["npm run typecheck", null], ["git add -A", null], ["git commit -m x", null]], 1),
      run("s2", [["npm run lint", null], ["npm run typecheck", null], ["git add -A", null]], 2),
      run("s3", [["cat AGENTS.md", null], ["npm run lint", null], ["npm run typecheck", null]], 1),
    ];
    const candidates = mineSequences(runs);
    expect(candidates.length).toBeGreaterThan(0);
    const gram = candidates[0].gram;
    expect(gram).toContain("npm run lint");
    expect(gram).not.toContain("<path>"); // Lesebefehl cat zähle nicht als Folgenelement
    const top = candidates.find((c) => c.hits >= 3 && c.sessions.length >= 2);
    expect(top).toBeTruthy();
    expect(top.sessions).toEqual(["s1", "s2", "s3"]);
    const scores = candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(top.suggestion).toMatch(/^scripts\/[\w-]+\.mjs$/);
  });
});

#!/usr/bin/env node
/**
 * T3.11 (EPIC-P3): "Ehrlichkeitsklausel automatisieren" (aSPARK-Lektion) —
 * verifies README.md's Adapter-Status-Matrix against each adapter's REAL
 * `capabilities()` return, for the bundled adapter factories and supported mode variants (a
 * pure, side-effect-free call — no CLI/network access needed to construct
 * the object and read its capabilities).
 *
 * Deliberately a checker, not a silent auto-rewriter: `capabilities()`
 * covers Reasoning/Tools/Cost/Steer/Kontingent, but the Status ("proven"/
 * "unproven"/"geplant") and Phase columns are editorial judgments backed
 * by real test/messlauf evidence (this repo's own "Status wird erst nach
 * bestandenen Contract-Tests auf 'proven' gesetzt" clause) — a script
 * can't responsibly assert those without re-running and cross-referencing
 * the whole evidence trail, so it leaves them to a human and only catches
 * the mechanical drift: a README claiming a capability the real code no
 * longer has (or now has but the README doesn't credit).
 *
 * Direct endpoints share a factory. ACP feature rows are checked per
 * preset. Swarm and Zai have no standalone adapter implementation.
 *
 *   npm run check:adapter-matrix
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const CHECKED = [
  { id: "dummy", modulePath: "../packages/adapters/dummy/src/index.ts" },
  { id: "claude", modulePath: "../packages/adapters/claude/src/index.ts" },
  { id: "codex", modulePath: "../packages/adapters/codex/src/index.ts" },
  { id: "opencode", modulePath: "../packages/adapters/opencode/src/index.ts" },
  { id: "aider", modulePath: "../packages/adapters/aider/src/index.ts" },
  { id: "hermes", modulePath: "../packages/adapters/hermes/src/index.ts" },
  { id: "copilot", modulePath: "../packages/adapters/copilot/src/index.ts" },
  { id: "pi", modulePath: "../packages/adapters/pi/src/index.ts" },
  { id: "cursor", modulePath: "../packages/adapters/cursor/src/index.ts" },
  { id: "cursor-clip", modulePath: "../packages/adapters/cursor-clip/src/index.ts" },
  { id: "claude-clip", modulePath: "../packages/adapters/claude-clip/src/index.ts" },
  ...["local-llm", "deepseek"].map(id => ({
    id, modulePath: "../examples/adapters/openai-compat/adapter.ts", config: { baseUrl: "http://127.0.0.1/v1" }, featureId: "OpenAI-kompatibler Direktadapter",
  })),
];
/** ADR-0018: one adapter module, several harnesses — checked per config. */
const ACP_MODULE = "../packages/adapters/acp/src/index.ts";
const CHECKED_CONFIGS = [
  { id: "codex · exec", modulePath: "../packages/adapters/codex/src/index.ts", config: { mode: "exec" } },
  ...["copilot", "opencode", "dsh", "maki", "omp"].map(preset => ({ id: `acp · ${preset}`, modulePath: ACP_MODULE, config: { preset } })),
  { id: "acp · maki mit Brücke", modulePath: ACP_MODULE, config: { preset: "maki", bridgeCommands: true } },
  { id: "acp · eigener Befehl", modulePath: ACP_MODULE, config: { command: ["agent"] } },
];

const SYMBOL_TO_BOOL = { "✓": true, "—": false };

function parseMatrixRow(line) {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 7) return null;
  const id = cells[0].replace(/[`~*]/g, "").trim();
  return {
    id,
    reasoning: cells[2],
    tools: cells[3],
    cost: cells[4],
    steer: cells[5],
    usage: cells[6],
  };
}

const readme = await readFile(join(repoRoot, "README.md"), "utf8");
const lines = readme.split("\n");
const rows = new Map();
for (const line of lines) {
  if (!line.startsWith("|") || line.startsWith("|---")) continue;
  const row = parseMatrixRow(line);
  if (row) rows.set(row.id, row);
}

let mismatches = 0;
for (const { id, modulePath, config } of CHECKED) {
  const row = rows.get(id);
  if (!row) {
    console.error(`FAIL: no README matrix row found for adapter "${id}"`);
    mismatches++;
    continue;
  }
  const { createAdapter } = await import(modulePath);
  const caps = createAdapter(config).capabilities();
  const checks = [
    ["reasoning", caps.reasoning, row.reasoning],
    ["tools", caps.tools, row.tools],
    ["cost", caps.cost, row.cost],
    ["steer", caps.steer, row.steer],
    ["usage", caps.usage, row.usage],
  ];
  for (const [field, real, cell] of checks) {
    const symbol = cell.replaceAll("*", "") === "no" ? "—" : cell;
    if (!(symbol in SYMBOL_TO_BOOL)) continue; // "~" or "?" — an honest partial/unknown, not a mismatch to flag
    const claimed = SYMBOL_TO_BOOL[symbol];
    if (claimed !== real) {
      console.error(
        `FAIL: ${id}.capabilities().${field} = ${real}, but README matrix says "${symbol}" (claims ${claimed})`,
      );
      mismatches++;
    }
  }
}

// ADR-0018: docs/harness-matrix.md — the per-function matrix, same rule.
const FEATURE_COLUMNS = ["followUp", "interrupt", "toolGate", "questions", "modelChoice", "agents", "images", "files", "contextFork", "modelSwitch", "permissionModes", "skills"];
const matrix = await readFile(join(repoRoot, "docs", "harness-matrix.md"), "utf8");
const block = matrix.split("<!-- harness-matrix:start -->")[1]?.split("<!-- harness-matrix:end -->")[0] ?? "";
const featureRows = new Map();
for (const line of block.split("\n")) {
  if (!line.startsWith("|") || line.startsWith("|---") || line.includes("Folgeprompt")) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  featureRows.set(cells[0], cells.slice(2));
}
for (const { id, modulePath, config, featureId = id } of [...CHECKED, ...CHECKED_CONFIGS]) {
  const cells = featureRows.get(featureId);
  if (!cells) {
    console.error(`FAIL: no docs/harness-matrix.md row for adapter "${id}"`);
    mismatches++;
    continue;
  }
  const { createAdapter } = await import(modulePath);
  const caps = createAdapter(config).capabilities();
  const f = caps.features;
  FEATURE_COLUMNS.forEach((key, i) => {
    const text = key === "toolGate" || key === "permissionModes";
    const real = key === "toolGate" ? f.toolGate : key === "modelChoice" ? f.modelChoice === "start" : key === "permissionModes" ? (f.permissionModes.length ? f.permissionModes.join(", ") : "—") : f[key];
    const claimed = text ? cells[i] : SYMBOL_TO_BOOL[cells[i]];
    if (claimed !== real) {
      console.error(`FAIL: ${id}.features.${key} = ${real}, but docs/harness-matrix.md says "${cells[i]}"`);
      mismatches++;
    }
  });
  const commands = (caps.commands ?? []).map(({ name, scope }) => `${name}:${scope}`).sort().join(", ") || "—";
  const listed = cells[FEATURE_COLUMNS.length]?.replaceAll("`", "").split(", ").sort().join(", ");
  if (listed !== commands) {
    console.error(`FAIL: ${id}.commands = "${commands}", but docs/harness-matrix.md says "${listed}"`);
    mismatches++;
  }
}

console.log(`checked ${CHECKED.length} README entries and ${CHECKED.length + CHECKED_CONFIGS.length} adapter configurations for features and command scopes`);

if (mismatches > 0) {
  console.error(`\nFAIL: ${mismatches} matrix-vs-capabilities() mismatch(es).`);
  process.exit(1);
}
console.log("\nPASS: README and harness matrix match the checked capabilities().");

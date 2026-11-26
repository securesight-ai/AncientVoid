import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkoutTask, installAcceptance } from "./corpus.mjs";
import { checkAcceptance, installDependencies } from "./acceptance.mjs";
import { sha256 } from "./protocol.mjs";

const run = promisify(execFile);
const skillTargets = [".claude/skills", ".agents/skills", ".pi/skills", ".opencode/skills"];
const ruleFiles = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", ".github/copilot-instructions.md"];

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function skillDigest(directory, subpath = "") {
  const files = [];
  for (const entry of (await readdir(join(directory, subpath), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(subpath, entry.name);
    if (entry.isDirectory()) files.push(...await skillDigest(directory, path));
    else if (entry.isFile()) files.push([path, sha256(await readFile(join(directory, path)))]);
    else throw new Error(`Unexpected skill asset: ${path}`);
  }
  return files;
}

// Jede Arbeitskopie ist ein eigenes, sauberes Git-Repo: Sonst gilt dem Hub ein umgebendes Repo als Projekt
// (parallele Läufe kollidieren, der Agent sieht fremden Verlauf).
export async function snapshotWorkspace(directory) {
  const git = (...args) => run("git", ["-c", "user.name=bench", "-c", "user.email=bench@invalid", "-c", "commit.gpgsign=false", ...args], { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "--allow-empty", "-m", "start");
}

export async function prepareWorkspace(root, directory, task, skills) {
  await checkoutTask(root, directory, task.start);
  const skillStaging = `${directory}-skill-staging`;
  const source = join(directory, ".claude/skills");
  if (skills) await cp(source, skillStaging, { recursive: true });
  try {
    await Promise.all([...skillTargets, "bugs", "PROGRESS.md", task.test].map((item) => rm(join(directory, item), { recursive: true, force: true })));
    if (skills) {
      await cp(skillStaging, source, { recursive: true });
      await cp(skillStaging, join(directory, ".agents/skills"), { recursive: true });
    }
    const rules = await Promise.all(ruleFiles.map(async (path) => [path, (await readOptional(join(directory, path)))?.toString("utf8") ?? null]));
    await installDependencies(directory);
    await snapshotWorkspace(directory);
    return { rulesHash: sha256(JSON.stringify(rules)), skillHash: skills ? sha256(JSON.stringify(await skillDigest(source))) : null };
  } finally {
    await rm(skillStaging, { recursive: true, force: true });
  }
}

async function gate(directory, command) {
  try {
    await run("npm", ["run", command], { cwd: directory, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    return true;
  } catch (error) {
    if (error.code === 1 && !error.killed) return false;
    throw error;
  }
}

export async function judgeWorkspace(root, directory, candidate, task) {
  await checkoutTask(root, directory, task.start);
  await installAcceptance(root, directory, task);
  await installDependencies(directory);
  const baseline = await checkAcceptance(directory, task);
  if (task.negative ? baseline.failed : !baseline.failed) {
    throw new Error(`${task.id}: acceptance ${task.negative ? "unexpectedly fails" : "unexpectedly passes"} at start`);
  }
  let changed = false;
  const candidateRoot = await realpath(candidate);
  for (const path of task.editable) {
    const from = join(candidateRoot, path);
    const to = join(directory, path);
    const info = await lstat(from).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!info) {
      changed = true;
      await rm(to, { force: true });
      continue;
    }
    const canonical = await realpath(from);
    const relativePath = relative(candidateRoot, canonical);
    if (!info.isFile() || relativePath !== path || isAbsolute(relativePath)) throw new Error(`Unexpected candidate file: ${path}`);
    if (task.negative && !(await readFile(canonical)).equals(await readFile(to))) changed = true;
    await mkdir(dirname(to), { recursive: true });
    await copyFile(canonical, to, constants.COPYFILE_FICLONE);
  }
  const result = await checkAcceptance(directory, task, { allowSuiteFailure: true });
  const [lint, typecheck] = await Promise.all([gate(directory, "lint"), gate(directory, "typecheck")]);
  // Negativkontrolle: grün nur, wenn nichts geändert wurde (Lebenszeichen erzwingt die Token-Erfassung).
  return { baseline: baseline.failed, acceptance: !changed && result.passed === baseline.passed + baseline.failed && result.failed === 0, lint, typecheck };
}

export async function carryPlan(planning, build) {
  const path = join(planning, "PLAN.md");
  const info = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!info) return false;
  if (!info.isFile() || info.size > 32_768) throw new Error("Expected a regular PLAN.md of at most 32 KiB");
  await writeFile(join(build, "PLAN.md"), await readFile(path), { flag: "wx" });
  await snapshotWorkspace(build);
  return true;
}

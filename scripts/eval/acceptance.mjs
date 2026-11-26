import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function installDependencies(directory, offline = false) {
  await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", ...(offline ? ["--offline"] : ["--prefer-offline"])],
    { cwd: directory, timeout: 180_000 });
}

export async function checkAcceptance(directory, task, { allowSuiteFailure = false } = {}) {
  const report = join(directory, `.p84-acceptance-${randomUUID()}.json`);
  let exit = 0;
  try {
    try {
      await run("node", ["node_modules/vitest/vitest.mjs", "run", task.test, "-t", task.selector, "--reporter=json", "--outputFile", report],
        { cwd: directory, timeout: 90_000, env: { ...process.env, VITEST_SET: "all", VITEST_WORKERS: "1" } });
    } catch (error) {
      if (error.code !== 1) throw error;
      exit = error.code;
    }
    const result = JSON.parse(await readFile(report, "utf8"));
    const passed = result.numPassedTests;
    const failed = result.numFailedTests;
    if (allowSuiteFailure && passed === 0 && failed === 0 && result.numFailedTestSuites > 0) return { passed: 0, failed: 1 };
    if (!Number.isInteger(passed) || !Number.isInteger(failed) || passed + failed === 0 || (exit === 0) !== (failed === 0)) {
      throw new Error(`${task.id}: acceptance has no valid test verdict`);
    }
    return { passed, failed };
  } finally {
    await unlink(report).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

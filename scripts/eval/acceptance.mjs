import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Fehlgeschlagene Fälle (oder die nicht ladbare Testdatei) aus dem Vitest-JSON, gekürzt und ohne Arbeitspfad. */
export function failuresOf(report, directory) {
  const short = (text) => text.replaceAll(directory, "<workspace>").slice(0, 800);
  return (report.testResults ?? []).flatMap((suite) => {
    const cases = (suite.assertionResults ?? []).filter((entry) => entry.status === "failed")
      .map((entry) => ({ name: entry.fullName, message: short(entry.failureMessages?.[0] ?? "") }));
    return cases.length || suite.status !== "failed" ? cases : [{ name: "<testdatei>", message: short(suite.message ?? "") }];
  });
}

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
    const failures = failuresOf(result, directory);
    if (allowSuiteFailure && passed === 0 && failed === 0 && result.numFailedTestSuites > 0) return { passed: 0, failed: 1, failures };
    if (!Number.isInteger(passed) || !Number.isInteger(failed) || passed + failed === 0 || (exit === 0) !== (failed === 0)) {
      throw new Error(`${task.id}: acceptance has no valid test verdict`);
    }
    return { passed, failed, failures };
  } finally {
    await unlink(report).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { checkoutTask, installAcceptance, readCorpus } from "./corpus.mjs";
import { checkAcceptance, installDependencies } from "./acceptance.mjs";

const root = resolve(import.meta.dirname, "../..");
const { tasks, hash } = readCorpus();
const selected = new Set(process.argv.slice(2).filter((arg) => arg !== "--offline"));
const offline = process.argv.includes("--offline");
for (const id of selected) {
  if (!tasks.some((task) => task.id === id)) throw new Error(`Unknown task: ${id}`);
}
console.log(`P84 corpus ${hash}`);
for (const task of tasks.filter(({ id }) => selected.size === 0 || selected.has(id))) {
  const temporary = mkdtempSync(join(tmpdir(), "p84-verify-"));
  try {
    const directory = join(temporary, "repo");
    await checkoutTask(root, directory, task.start);
    await installAcceptance(root, directory, task);
    await installDependencies(directory, offline);
    const red = await checkAcceptance(directory, task);
    if (red.failed === 0) throw new Error(`${task.id}: baseline already passes`);
    const greenDir = join(temporary, "reference");
    await checkoutTask(root, greenDir, task.reference);
    await installDependencies(greenDir, offline);
    const green = await checkAcceptance(greenDir, task);
    if (green.failed > 0 || green.passed !== red.passed + red.failed) throw new Error(`${task.id}: reference does not pass the same checks`);
    console.log(`${task.id}: ${red.failed} failing at start → ${green.passed} passing at reference`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

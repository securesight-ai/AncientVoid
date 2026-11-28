import { URL } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const repoPath = z.string().regex(/^(?:[\w.-]+\/)*[\w.-]+$/)
  .refine((path) => !path.split("/").some((part) => part.startsWith(".")));
const taskSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  createdOn: z.iso.date(),
  start: revision,
  reference: revision,
  test: repoPath,
  selector: z.string().min(1),
  prompt: z.string().min(1),
  editable: z.array(repoPath).min(1),
  split: z.boolean(),
  contaminationRisk: z.boolean(),
  // Negativkontrolle: Kriterium gilt schon am Start (start === reference); jede Änderung ist ein Fehler.
  negative: z.boolean().default(false),
}).refine((task) => !task.negative || (task.start === task.reference && !task.split),
  "A negative control starts at its reference and stays out of the split subset");

export function readCorpus(file) {
  const bytes = readFileSync(file ?? new URL("corpus.json", import.meta.url));
  const expected = digest.parse(readFileSync(file ? `${file}.sha256` : new URL("corpus.sha256", import.meta.url), "utf8").trim());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expected) throw new Error("P84 corpus hash mismatch");
  const { tasks } = z.strictObject({ version: z.literal(1), tasks: z.array(taskSchema).min(file ? 1 : 12).max(20) }).parse(JSON.parse(bytes));
  if (new Set(tasks.map(({ id }) => id)).size !== tasks.length) throw new Error("Duplicate P84 task ID");
  for (const task of tasks) new RegExp(task.selector);
  return { hash, tasks };
}

export async function checkoutTask(root, directory, revision) {
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, ".p84-source.tar");
  await run("git", ["archive", "--output", archive, revision], { cwd: root });
  try {
    await run("tar", ["-xf", archive, "-C", directory]);
  } finally {
    unlinkSync(archive);
  }
}

export async function installAcceptance(root, directory, task) {
  const path = join(directory, task.test);
  const { stdout: fixture } = await run("git", ["show", `${task.reference}:${task.test}`], { cwd: root, encoding: "buffer" });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fixture);
}

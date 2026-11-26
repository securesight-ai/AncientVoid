import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareWorkspace, carryPlan, judgeWorkspace } from "./workspace.mjs";
import { preflight, runPhase } from "./hub.mjs";
import { jobKey, runJobs } from "./protocol.mjs";

export async function runSeries(api, root, scratch, series, plan) {
  await preflight(api, plan.config);
  const destination = join(scratch, series);
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const receipts = join(destination, "sessions.jsonl");
  writeFileSync(receipts, "", { flag: "wx", mode: 0o600 });
  await runJobs(plan.jobs, plan.config.parallelCloudRuns, async (job) => {
    const { arm, task, repetition } = job;
    const key = jobKey(job);
    const directory = mkdtempSync(join(destination, `${task.id}-`));
    const build = join(directory, "build");
    const planning = join(directory, "plan");
    const toolScope = `Arbeite nur in diesem Workspace. Zulässige Quelldateien für die Abnahme: ${task.editable.join(", ")}.`;
    try {
      const rules = await prepareWorkspace(root, build, task, arm.skills);
      const phases = [];
      let handover = "";
      if (arm.plan) {
        const plannedRules = await prepareWorkspace(root, planning, task, arm.skills);
        if (plannedRules.rulesHash !== rules.rulesHash) throw new Error("Plan and build received different rules");
        phases.push(await runPhase(api, "plan", arm.plan, planning,
          `${task.prompt}\n\n${toolScope}\nErarbeite einen Plan und schreibe ihn in PLAN.md. Belasse die Quelldateien unverändert.`, plan.config.timeoutMs));
        if (await carryPlan(planning, build)) handover = "\nPLAN.md enthält einen Vorschlag aus einem getrennten Planungszug. Prüfe ihn anhand der Aufgabe.";
      }
      phases.push(await runPhase(api, "build", arm.build, build,
        `${task.prompt}\n\n${toolScope}\nImplementiere und prüfe die Änderung.${handover}`, plan.config.timeoutMs));
      const verdict = await judgeWorkspace(root, join(directory, "judge"), build, task);
      const input = {
        series, arm: arm.id, task: task.id, repetition,
        corpusHash: plan.corpus.hash, protocolHash: plan.protocolHash,
        rulesHash: rules.rulesHash, skills: arm.skills, skillHash: rules.skillHash,
        ...verdict, phases,
      };
      const buildId = phases.at(-1).sessionId;
      await api(`/api/sessions/${buildId}/evaluation`, input);
      appendFileSync(receipts, JSON.stringify({ key, sessionId: buildId }) + "\n", { flush: true });
      console.log(`${key} → ${buildId}`);
      // Keep source files and session journal for audit. Dependency trees can be recreated.
      const { rm } = await import("node:fs/promises");
      await Promise.all([build, planning, join(directory, "judge")].map((workspace) =>
        rm(join(workspace, "node_modules"), { recursive: true, force: true })));
    } catch (error) {
      throw new Error(`P84 ${series}/${key} at ${directory}: ${error.message}`, { cause: error });
    }
  });
  return receipts;
}

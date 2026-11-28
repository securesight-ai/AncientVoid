import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { applyVariant, prepareWorkspace, carryPlan, judgeWorkspace, readVariant } from "./workspace.mjs";
import { awaitHealthy, preflight, probeHealth, runPhase } from "./hub.mjs";
import { BudgetGuard, isInfrastructureFailure, jobKey, resumeJobs, runJobs, sha256 } from "./protocol.mjs";

const jsonLines = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

export async function runSeries(api, root, scratch, series, plan, { resume = false, skipProviders = [], energyApi = api } = {}) {
  const variant = plan.config.repoVariant;
  const variants = variant ? {
    reference: await readVariant(root, variant.reference, variant.path),
    candidate: await readVariant(root, variant.candidate, variant.path),
  } : null;
  const signature = (entry) => sha256(Buffer.concat([Buffer.from(String(entry.mode) + "\n"), entry.contents]));
  if (variants && signature(variants.reference) === signature(variants.candidate)) {
    throw new Error("Reference and candidate contain the same configuration");
  }
  await preflight(api, plan.config, undefined, energyApi);
  const destination = join(scratch, series);
  mkdirSync(destination, { recursive: resume, mode: 0o700 });
  const [receipts, invalid, aborted] = ["sessions", "invalid", "aborted"].map((name) => join(destination, `${name}.jsonl`));
  // Beim Fortsetzen müssen die Protokolldateien da sein (fail loud); sonst werden sie neu angelegt.
  if (!resume) for (const path of [receipts, invalid, aborted]) writeFileSync(path, "", { flag: "wx", mode: 0o600 });
  const budget = new BudgetGuard(plan.config.providerBudgetUsd);
  const rows = resume ? await Promise.all(jsonLines(receipts).map(async ({ key, sessionId }) =>
    ({ key, row: await api(`/api/sessions/${sessionId}/evaluation`) }))) : [];
  const jobs = resumeJobs(plan, { rows, aborted: resume ? jsonLines(aborted).map((entry) => entry.key) : [], skipProviders, budget });
  console.log(`P84 ${series}: ${jobs.length} of ${plan.jobs.length} runs open${skipProviders.length ? `, deferred providers: ${skipProviders.join(", ")}` : ""}`);
  let infraStreak = 0;
  const attemptJob = async (job) => {
    const { arm } = job;
    const key = jobKey(job);
    for (let attempt = 1; ; attempt++) {
      budget.assertOpen(job);
      try {
        for (const side of [arm.plan, arm.build]) if (side?.healthUrl) await awaitHealthy(side.healthUrl);
        await runAttempt(job, attempt);
        infraStreak = 0;
        return;
      } catch (error) {
        // Ein Timeout zählt nur dann als Infrastruktur, wenn die Engine danach nicht antwortet.
        const hung = /timed out/.test(error.message) && await Promise.any([arm.plan, arm.build].filter((side) => side?.healthUrl)
          .map((side) => probeHealth(side.healthUrl).then(() => { throw new Error("alive"); }, () => true))).catch(() => false);
        // Timeout bei lebender Engine oder offene Rückfrage: Abbruch des Agenten. Er wird in aborted.jsonl sichtbar
        // (nie still gedroppt), die Serie läuft weiter und gilt als partiell; der Report nennt die Abbrüche.
        const cause = /waiting_approval before/.test(error.message) ? "approval" : /timed out/.test(error.message) && !hung ? "timeout" : null;
        if (cause) {
          appendFileSync(aborted, JSON.stringify({ key, attempt, at: new Date().toISOString(), cause, message: error.message }) + "\n", { flush: true });
          return;
        }
        if (!isInfrastructureFailure(error) && !hung) throw error;
        // Eine tote Engine ist keine Aufgabenschwäche: Versuch protokollieren, nie als gescheitert zählen.
        appendFileSync(invalid, JSON.stringify({ key, attempt, at: new Date().toISOString(), cause: "infrastructure", message: error.message }) + "\n", { flush: true });
        if (++infraStreak >= 3) throw new Error(`P84 ${series}: three consecutive infrastructure failures, measurement stopped (${error.message})`, { cause: error });
        if (attempt > plan.config.maxInfraRetries) throw error;
      }
    }
  };
  await runJobs(jobs, plan.config.parallelCloudRuns, attemptJob);
  async function runAttempt(job, attempt) {
    const { arm, task, repetition } = job;
    const key = jobKey(job);
    const directory = mkdtempSync(join(destination, `${task.id}-`));
    const build = join(directory, "build");
    const planning = join(directory, "plan");
    const toolScope = `Arbeite nur in diesem Workspace. Zulässige Quelldateien für die Abnahme: ${task.editable.join(", ")}.`;
    try {
      const rules = await prepareWorkspace(root, build, task, arm.skills);
      if (variant && variants) await applyVariant(build, variant.path, variants[arm.id]);
      const phases = [];
      let handover = "";
      if (arm.plan) {
        const plannedRules = await prepareWorkspace(root, planning, task, arm.skills);
        if (plannedRules.rulesHash !== rules.rulesHash) throw new Error("Plan and build received different rules");
        phases.push(await runPhase(api, "plan", arm.plan, planning,
          `${task.prompt}\n\n${toolScope}\nErarbeite einen Plan und schreibe ihn in PLAN.md. Belasse die Quelldateien unverändert.`, plan.config.timeoutMs, energyApi));
        if (await carryPlan(planning, build)) handover = "\nPLAN.md enthält einen Vorschlag aus einem getrennten Planungszug. Prüfe ihn anhand der Aufgabe.";
      }
      const comparison = plan.config.repoScan;
      let prompt = task.prompt;
      let comparisonRecord;
      if (comparison) {
        const scan = arm.id === "candidate";
        const rewrite = await api("/api/prompt-enhance", { adapter: arm.build.adapter, project: build, text: prompt, scan }, 200, 360_000);
        if (rewrite.engine?.kind !== comparison.engineKind || rewrite.engine.id !== comparison.engineId ||
            rewrite.engine.model !== comparison.model || rewrite.scan?.enabled !== scan || typeof rewrite.enhanced !== "string") {
          throw new Error("The rewrite used a different engine, model or scan mode from the frozen protocol");
        }
        prompt = `Ursprünglicher Auftrag:\n${prompt}\n\nVorschlag für die Umsetzung (bei Abweichungen gilt der Auftrag):\n${rewrite.enhanced}`;
        comparisonRecord = {
          repo: comparison.repo, kind: "context", source: "repoFacts", applied: true,
          reference: sha256(`repoFacts:off:${plan.protocolHash}`), candidate: sha256(`repoFacts:on:${plan.protocolHash}`),
          minimumEffect: comparison.minimumEffect,
          expected: { repetitions: plan.config.repetitions, tasks: plan.config.tasks ?? plan.corpus.tasks.map(({ id }) => id) },
          enhancer: { wallMs: rewrite.latencyMs, contextChars: rewrite.scan.chars,
            ...(rewrite.costUsd === undefined ? {} : { costUsd: rewrite.costUsd }) },
        };
      }
      phases.push(await runPhase(api, "build", arm.build, build,
        `${prompt}\n\n${toolScope}\nImplementiere und prüfe die Änderung.${handover}`, plan.config.timeoutMs, energyApi));
      const { verdict, why } = await judgeWorkspace(root, join(directory, "judge"), build, task);
      const buildId = phases.at(-1).sessionId;
      if (variant && variants) {
        const observed = await observedEvent(api, buildId, variant.observation[arm.id]);
        comparisonRecord = {
          repo: variant.repo, kind: variant.kind, source: variant.path, applied: observed,
          reference: signature(variants.reference), candidate: signature(variants.candidate),
          minimumEffect: variant.minimumEffect,
          expected: { repetitions: plan.config.repetitions, tasks: plan.config.tasks ?? plan.corpus.tasks.map(({ id }) => id) },
          ...((variant.kind === "hook" || variant.kind === "guardrail" || variant.kind === "rule") && { policyPassed: verdict.acceptance }),
        };
      }
      const input = {
        series, arm: arm.id, task: task.id, repetition, attempt,
        corpusHash: plan.corpus.hash, protocolHash: plan.protocolHash,
        rulesHash: rules.rulesHash, skills: arm.skills, skillHash: rules.skillHash,
        ...verdict, phases, ...(comparisonRecord && { comparison: comparisonRecord }),
      };
      budget.record(job, await api(`/api/sessions/${buildId}/evaluation`, input));
      appendFileSync(receipts, JSON.stringify({ key, sessionId: buildId }) + "\n", { flush: true });
      appendFileSync(join(destination, "verdicts.jsonl"), JSON.stringify({ key, sessionId: buildId, ...why }) + "\n", { flush: true });
      console.log(`${key} → ${buildId}`);
      // Keep source files and session journal for audit. Dependency trees can be recreated.
      const { rm } = await import("node:fs/promises");
      await Promise.all([build, planning, join(directory, "judge")].map((workspace) =>
        rm(join(workspace, "node_modules"), { recursive: true, force: true })));
    } catch (error) {
      throw new Error(`P84 ${series}/${key} at ${directory}: ${error.message}`, { cause: error });
    }
  }
  return receipts;
}

async function observedEvent(api, sessionId, kind) {
  let after = 0;
  for (;;) {
    const page = await api(`/api/sessions/${sessionId}/events?afterSeq=${after}&limit=500`);
    if (page.some((event) => event.type !== "user" && event.type !== "assistant" && event.payload?.kind === kind)) return true;
    if (page.length < 500) return false;
    after = page.at(-1).seq;
  }
}

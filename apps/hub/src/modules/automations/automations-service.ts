import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import {
  AutomationService, BUILTIN_ACTIONS, detectedActions, isProjectPathAllowed,
  type AutomationLauncher, type AutomationPrechecker, type PrecheckResult, type SessionManager,
} from "@ancientvoid/core";
import { actionArgv, SwarmStart, AUTOMATION_LIMITS, type ActionDefinition, type AutomationOutcome } from "@ancientvoid/contracts";
import type { AutomationSkipReason } from "@ancientvoid/contracts";
import type { HubSwarm } from "../swarm/index.ts";

export interface HubAutomationDeps {
  dataDir: string; hostId: string; sessions: SessionManager; projectRoots: string[];
  swarm?: HubSwarm;
  actions?: ActionDefinition[];
  log?: (line: string) => void;
}

export function mapLaunchFailure(message: string): AutomationSkipReason {
  if (/bereits eine andere AncientVoid-Session|lease/i.test(message)) return "lease";
  if (/budget|quota|usage|kontingent/i.test(message)) return "quota";
  if (/policy|erlaubt|permission|denied|403|401|login|anmeld|auth/i.test(message)) return "auth";
  return "host_down";
}

export function createHubAutomationService(deps: HubAutomationDeps): AutomationService {
  const signal = new AbortController();
  // ADR-0080: Skript-Dispatches haben keine Referenz — das Ergebnis wird gespiegelt, bis der Abgleich es holt.
  // Nach einem Neustart ist der Spiegel leer: ein dispatchter Skript-Claim gilt als unknown (K7), nie geraten.
  const scriptOutcomes = new Map<string, AutomationOutcome>();
  const rememberScriptOutcome = (claimKey: string, outcome: AutomationOutcome): void => {
    scriptOutcomes.set(claimKey, outcome);
    while (scriptOutcomes.size > 256) {
      const oldest = scriptOutcomes.keys().next().value;
      if (oldest === undefined) break;
      scriptOutcomes.delete(oldest);
    }
  };
  const launcher: AutomationLauncher = {
    async template(id) {
      await deps.swarm?.ready;
      const source = deps.swarm?.store.get(id);
      if (!source || source.tasks.length === 0) return null;
      return SwarmStart.parse({ title: source.title, goal: source.goal, project: source.project, frame: source.frame,
        plan: { tasks: source.tasks.map(t => ({ id: t.id, title: t.title, prompt: t.prompt, adapter: t.adapter, model: t.model, dependsOn: t.dependsOn })) } });
    },
    async launch(definition, text, claimKey, kind) {
      try {
        if (definition.target.kind === "swarm") {
          if (!deps.swarm || !text) return { ok: false, reason: "host_down" };
          await deps.swarm.ready;
          const spec = SwarmStart.parse(JSON.parse(text));
          if (deps.projectRoots.length && !(await isProjectPathAllowed(spec.project, deps.projectRoots))) return { ok: false, reason: "auth", detail: "Projekt außerhalb der freigegebenen Wurzeln" };
          if (spec.frame.adapters.some(a => a.startsWith("loop:"))) return { ok: false, reason: "auth" };
          const swarm = await deps.swarm.coordinator.start(spec, `automation:${claimKey}`);
          return { ok: true, swarmId: swarm.id };
        }
        if (definition.target.kind === "script") {
          const target = definition.target;
          if (deps.projectRoots.length && !(await isProjectPathAllowed(target.project, deps.projectRoots))) return { ok: false, reason: "auth", detail: "Projekt außerhalb der freigegebenen Wurzeln" };
          const action = await resolveAutomationAction(deps.actions, target.project, target.actionId);
          if (!action) return { ok: false, reason: "precheck", detail: `Unbekannte Aktion ${target.actionId}` };
          const code = await runArgv(actionArgv(action, {}), target.project, Math.min(action.timeoutMs, 600_000), signal.signal);
          if (code === "spawn_error") return { ok: false, reason: "precheck", detail: `Skript-Aktion ${target.actionId} ließ sich nicht starten` };
          rememberScriptOutcome(claimKey, code === "timeout" ? "timeout" : code === 0 ? "succeeded" : "failed");
          return { ok: true };
        }
        const target = definition.target;
        if (deps.projectRoots.length && !(await isProjectPathAllowed(target.project, deps.projectRoots))) return { ok: false, reason: "auth", detail: "Projekt außerhalb der freigegebenen Wurzeln" };
        const record = await deps.sessions.create({ adapter: target.harness, project: target.project, prompt: text,
          ...(target.model ? { model: target.model } : {}), workspaceMode: target.workdir }, `automation:${claimKey}`);
        return { ok: true, sessionId: record.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.log?.(`dispatch failure ${claimKey} (${kind}): ${message}`);
        const reason = mapLaunchFailure(message);
        return { ok: false, reason, uncertain: reason === "host_down" && !/braucht ein Git-Projekt|nicht lesbar|ENOENT|unknown adapter/i.test(message), detail: message.slice(0, 500) };
      }
    },
    async inspect(claim) {
      const mirrored = scriptOutcomes.get(claim.claimKey);
      if (mirrored !== undefined) {
        scriptOutcomes.delete(claim.claimKey);
        return { state: "settled", outcome: mirrored };
      }
      if (claim.swarmId) {
        await deps.swarm?.ready;
        const swarm = deps.swarm?.store.get(claim.swarmId);
        if (!swarm) return { state: "unknown", detail: "Referenzierter Swarm nicht verfügbar" };
        if (swarm.status === "done") return { state: "settled", outcome: "succeeded" };
        if (swarm.status === "failed") return { state: "settled", outcome: "failed" };
        if (swarm.status === "cancelled") return { state: "settled", outcome: "cancelled" };
        return { state: "running" };
      }
      // ADR-0080: ein Skript-Claim ohne Spiegel hat keine Referenz — nach einem Neustart bleibt das Ergebnis unbekannt (K7).
      if (!claim.sessionId) return { state: "unknown", detail: "Skript-Ergebnis nach Neustart unbekannt" };
      const session = deps.sessions.get(claim.sessionId);
      if (!session) return { state: "unknown", detail: "Referenzierte Session nicht verfügbar" };
      const tail = await deps.sessions.tail(session.id, Math.max(0, session.lastSeq - 256), 256);
      const end = tail.findLast(e => e.type === "system" && e.payload.kind === "session.turn_end");
      if (end) {
        const reason = end.payload.reason;
        if (reason === "timeout") return { state: "settled", outcome: "timeout" };
        if (reason === "cancelled" || reason === "stopped") return { state: "settled", outcome: "cancelled" };
        return { state: "settled", outcome: reason === "error" || reason === "interrupted" || (typeof end.payload.code === "number" && end.payload.code !== 0) ? "failed" : "succeeded" };
      }
      if (session.status === "error" || session.status === "interrupted") return { state: "settled", outcome: "failed" };
      if (session.status === "stopped") return { state: "settled", outcome: "cancelled" };
      return { state: "running" };
    },
  };
  let activePrechecks = 0;
  const prechecker: AutomationPrechecker = {
    stop() { signal.abort(); },
    async run(actionId, definition, deadlineMs, templateText): Promise<PrecheckResult> {
      const project = definition.target.kind === "swarm"
        ? templateText ? SwarmStart.parse(JSON.parse(templateText)).project : null
        : definition.target.project;
      if (!project) return "precheck";
      if (deps.projectRoots.length > 0 && !(await isProjectPathAllowed(project, deps.projectRoots))) return "auth";
      const actions = [...(deps.actions ?? []), ...BUILTIN_ACTIONS, ...(await detectedActions(project))];
      const action = actions.find(a => a.id === actionId);
      if (!action) return "precheck";
      if (activePrechecks >= AUTOMATION_LIMITS.prechecks) return "quota";
      activePrechecks++;
      let code: number | "timeout" | "spawn_error";
      try { code = await runArgv(actionArgv(action, {}), project, Math.min(deadlineMs, action.timeoutMs), signal.signal); }
      finally { activePrechecks--; }
      if (code === "timeout") return "precheck_timeout";
      if (code === "spawn_error") return "precheck";
      return code === 0 ? "ok" : "precheck_exit";
    },
  };
  return new AutomationService({ root: pathResolve(deps.dataDir, "automations"), hostId: deps.hostId, launcher, prechecker, ...(deps.log ? { log: deps.log } : {}) });
}

/** ADR-0080: löst eine registrierte Aktion auf (konfiguriert, builtin, erkannt) — dieselbe Reihenfolge wie beim Prechecker. */
export async function resolveAutomationAction(actions: ActionDefinition[] | undefined, project: string, actionId: string): Promise<ActionDefinition | undefined> {
  return [...(actions ?? []), ...BUILTIN_ACTIONS, ...(await detectedActions(project))].find(a => a.id === actionId);
}

function runArgv(argv: string[], cwd: string, deadline: number, signal: AbortSignal): Promise<number | "timeout" | "spawn_error"> {
  return new Promise(resolve => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, detached: true, stdio: "ignore", signal });
    let done = false;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const finish = (code: number | "timeout" | "spawn_error") => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener("abort", kill); resolve(code);
    };
    const timer = setTimeout(() => { kill(); finish("timeout"); }, deadline);
    signal.addEventListener("abort", kill, { once: true });
    child.once("error", () => finish("spawn_error"));
    child.once("close", code => finish(code ?? -1));
  });
}

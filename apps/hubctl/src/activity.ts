import { spawn, type ChildProcess } from "node:child_process";
import { ACTIVITY_HEARTBEAT_MS, ActivityReport, type Ack } from "@ancientvoid/contracts";
import { api } from "./api.ts";
import { t } from "./i18n/index.ts";

/** External work uses the same journal and heartbeat as provider activity. */
export async function activityCommand(args: string[]): Promise<void> {
  const [sessionId, id, action, ...command] = args;
  if (!sessionId || !id || !action) throw new Error("activity <sessionId> <id> running|completed|failed|run [command ...]");
  const report = async (state: "running" | "completed" | "failed") => {
    const body = ActivityReport.parse({ id, kind: "job", state, label: id.slice(0, 160) });
    const ack = await api<Ack>(`/api/sessions/${encodeURIComponent(sessionId)}/activity`, { method: "POST", body: JSON.stringify(body) });
    if (!ack.ok) throw new Error(ack.detail ?? t("activity_not_accepted"));
  };
  if (action !== "run") {
    if (action !== "running" && action !== "completed" && action !== "failed") throw new Error(t("unknown_activity_state"));
    await report(action);
    return;
  }
  const argv = command[0] === "--" ? command.slice(1) : command;
  if (!argv[0]) throw new Error(t("activity_run_needs_cmd"));
  await report("running");
  let heartbeatFailure: unknown;
  let reporting: Promise<void> | null = null;
  let child: ChildProcess | undefined;
  let force: NodeJS.Timeout | undefined;
  const terminate = () => {
    if (!child?.kill("SIGTERM")) return;
    force = setTimeout(() => child?.kill("SIGKILL"), 2000);
    force.unref();
  };
  process.on("SIGTERM", terminate);
  process.on("SIGINT", terminate);
  const timer = setInterval(() => {
    if (reporting) return;
    reporting = report("running").catch(async (err: unknown) => {
      heartbeatFailure = err;
      console.error(t("heartbeat_failed"), err instanceof Error ? err.message : String(err));
      const state = await api<{ status: string }>(`/api/sessions/${encodeURIComponent(sessionId)}`).catch(() => null);
      if (state && ["stopped", "stopping", "parked"].includes(state.status)) terminate();
    }).finally(() => { reporting = null; });
  }, ACTIVITY_HEARTBEAT_MS);
  let code = 1;
  const jobEnv = { ...process.env };
  delete jobEnv.ANCIENTVOID_TOKEN;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child = spawn(argv[0]!, argv.slice(1), { stdio: "inherit", env: jobEnv });
      child.once("error", reject);
      child.once("exit", exitCode => resolve(exitCode ?? 1));
    });
  } finally {
    clearInterval(timer);
    if (force) clearTimeout(force);
    await reporting;
    process.off("SIGTERM", terminate);
    process.off("SIGINT", terminate);
    await report(code === 0 ? "completed" : "failed");
  }
  if (code !== 0) process.exitCode = code;
  if (heartbeatFailure) throw new Error(t("job_heartbeat_failed"));
}

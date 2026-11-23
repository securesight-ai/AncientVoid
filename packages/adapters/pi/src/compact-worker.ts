// One managed turn around Pi's persistent RPC mode.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { spawnArgv } from "@ancientvoid/contracts";

const [, , command, sessionFile, ...args] = process.argv;
if (!command || !sessionFile) throw new Error("pi: compact worker requires a session file");

const launch = spawnArgv(command, ["--mode", "rpc", ...args, "--session", sessionFile]);
if (launch.shell) throw new Error("pi: use the executable path for RPC compaction");
const child = spawn(launch.file, launch.args, { stdio: ["pipe", "pipe", "inherit"] });
const write = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");
const emit = (message: object) => process.stdout.write(JSON.stringify(message) + "\n");
let finished = false;
let stderrReason = "Pi RPC wurde ohne Compaction-Ergebnis beendet";

function finish(error?: string) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  emit(error
    ? { type: "compact_worker_error", errorMessage: error.slice(0, 500) }
    : { type: "compaction_end", reason: "manual" });
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000).unref();
}

const timeout = setTimeout(() => finish("Zeitlimit für Pi-Compaction erreicht. Ergebnis unbekannt."), 5 * 60_000);
process.once("SIGTERM", () => finish("Pi-Compaction abgebrochen"));
child.once("error", (err) => finish(err.message));
child.stdin.once("error", (err) => { stderrReason = err.message; });
child.once("close", () => finish(stderrReason));
child.stdout.setEncoding("utf8");

let buffer = "";
let requested = false;
child.stdout.on("data", (chunk: string) => {
  if (finished) return;
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0 && !finished) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    let response: { type?: string; id?: string; command?: string; success?: boolean; error?: string; data?: { sessionFile?: string } };
    try {
      response = JSON.parse(line);
    } catch {
      finish("Ungültiges JSON von Pi RPC");
      return;
    }
    if (response?.type !== "response") continue;
    if (response.id === "verify-session" && response.command === "get_state" && !requested) {
      try {
        if (!response.success || !response.data?.sessionFile || realpathSync(response.data.sessionFile) !== realpathSync(sessionFile)) {
          throw new Error("Pi RPC meldet eine andere Session-Datei");
        }
      } catch (err) {
        finish(err instanceof Error ? err.message : String(err));
        return;
      }
      requested = true;
      emit({ type: "compaction_start", reason: "manual" });
      write({ id: "compact", type: "compact" });
    } else if (requested && response.id === "compact" && response.command === "compact") {
      finish(response.success === true ? undefined : typeof response.error === "string" ? response.error : "Pi hat Compaction abgelehnt");
    }
  }
});
write({ id: "verify-session", type: "get_state" });

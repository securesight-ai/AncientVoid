import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";

function run(command: string, args: readonly string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { timeout, maxBuffer: 1_048_576, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const detail = (stderr || stdout || err.message).trim().split("\n").at(-1) ?? err.message;
      reject(Object.assign(new Error(err.killed ? `${command}: keine Antwort in ${timeout / 1000} s` : detail.slice(0, 200)), { code: err.code }));
    });
    child.stdin?.end();
  });
}

export async function nvidiaSmi(args: readonly string[]): Promise<string | null> {
  try {
    return await run("nvidia-smi", args, 4_000);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return null;
    throw err;
  }
}

export async function statfsBytes(path: string) {
  const s = await statfs(path);
  return { totalBytes: s.blocks * s.bsize, freeBytes: s.bfree * s.bsize, availableBytes: s.bavail * s.bsize };
}

/** Ohne Kommando: was läuft, legt allein `command=` auf dem Zielhost fest (ADR-0117 §7). */
export function sshProbe(target: string, identityFile: string | undefined): Promise<string> {
  return run("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", ...(identityFile ? ["-i", identityFile, "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none"] : []), "--", target], 15_000);
}

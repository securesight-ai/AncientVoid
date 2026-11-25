import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MainSyncSettings } from "@ancientvoid/contracts";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P67 / ADR-0088: geteilte Git-Operationen des Main-Sync — von
 * WorktreeManager (Stufe 1, Basiswahl) und MainSyncEngine (Stufe 2,
 * Messung/Probelauf/Anwenden) benutzt, damit beide denselben Hauptbranch
 * und denselben harten Fetch sehen.
 */

/** Hauptbranch: Einstellungs-Override, sonst `origin/HEAD`, sonst `main` (EPIC-P67 §3.2). */
export async function resolveMainBranch(projectPath: string, settings: Pick<MainSyncSettings, "defaultBranch">): Promise<string> {
  if (settings.defaultBranch.trim() !== "") return settings.defaultBranch.trim();
  const { stdout } = await execFileAsync("git", ["-C", projectPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => ({ stdout: "" }));
  const resolved = stdout.trim();
  // symbolic-ref liefert "origin/main" — der Branchname ist alles nach dem ersten Slash.
  return resolved === "" || !resolved.includes("/") ? "main" : resolved.slice(resolved.indexOf("/") + 1);
}

/** Aktueller Branch des Projektordners, null bei detached HEAD. */
export async function currentGitBranch(projectPath: string): Promise<string | null> {
  const { stdout } = await execFileAsync("git", ["-C", projectPath, "symbolic-ref", "--short", "HEAD"]).catch(() => ({ stdout: "" }));
  return stdout.trim() || null;
}

/** Ein Fetch, hart begrenzt — nie interaktiv, nie ohne Zeitlimit (Premortem 1). Explizite Refspec: der Tracking-Ref bewegt sich auch bei Force-Push. */
export async function fetchMainBranch(projectPath: string, branch: string, timeoutSec: number): Promise<void> {
  await execFileAsync(
    "git",
    ["-C", projectPath, "fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    {
      timeout: timeoutSec * 1000,
      killSignal: "SIGKILL",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
}

/**
 * `origin`-Fern des Projekts, null wenn gar kein Fern konfiguriert ist
 * (BUG-0260). „Kein Fern“ ist eine benannte Lage, kein Fehler: Main-Sync ist
 * dann nicht moeglich, und das darf weder Fetch-Versuche noch Fehler-Events
 * erzeugen. Stufe 1 (`worktree.ts`) behandelt es so — Check und Scheduler
 * mussten nachziehen.
 */
export async function originRemoteUrl(projectPath: string): Promise<string | null> {
  const { stdout } = await execFileAsync("git", ["-C", projectPath, "remote", "get-url", "origin"]).catch(() => ({ stdout: "" }));
  return stdout.trim() || null;
}

/** Fetch-Fehler klassifizieren — bekannte Gründe statt `unknown`-Brei (dokumentiert in ADR-0088). */
export function classifyFetchError(err: unknown): { reason: "timeout" | "auth" | "offline" | "unknown"; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  if ((err as { killed?: boolean } | null)?.killed) return { reason: "timeout", detail: capDetail(message) };
  if (/Authentication failed|could not read [Uu]sername|Permission denied|403/i.test(message)) return { reason: "auth", detail: capDetail(message) };
  if (/Could not resolve|Network is unreachable|Connection (reset|refused|timed out)|timed out|unreachable/i.test(message)) {
    return { reason: "offline", detail: capDetail(message) };
  }
  return { reason: "unknown", detail: capDetail(message) };
}

/** K5-Nachschub: Detailtexte kappen (Contract erlaubt max. 500 Zeichen). */
function capDetail(text: string): string {
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestHub } from "./hub.ts";

/**
 * Manifest-Projekt unter den Hub-Projektwurzeln (EPIC-P29): git-initialisiert
 * mit `ancientvoid.workspace.json` im Basis-Commit. Geteilt zwischen den Specs,
 * die eine Workspace-Session brauchen (Runtime-Fluss, Herauslösen der
 * Umgebung-Ansicht). `extraFiles` landen vor dem Commit im Projekt — in
 * `.gitignore` gelistete bleiben ungetrackt (Include-Fall).
 */

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

export function manifestProject(hub: TestHub, name: string, manifest: object, extraFiles: Record<string, string> = {}): string {
  const dir = join(hub.projectsDir, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(extraFiles)) writeFileSync(join(dir, file), content);
  writeFileSync(join(dir, "ancientvoid.workspace.json"), JSON.stringify(manifest));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "add", "-A");
  git(dir, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "commit", "-q", "-m", "init");
  return dir;
}

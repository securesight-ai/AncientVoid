import type { RewriteEngine, SkippedEngine } from "../../shared/api.ts";

/** EPIC-P68: "lokal (qwen3-coder)" or "über claude" — which stage wrote it. */
export function engineLabel(engine: RewriteEngine | undefined): string {
  if (!engine) return "";
  if (engine.kind === "local") return engine.model ? `lokal (${engine.model})` : "lokal";
  return `über ${engine.id}${engine.model ? ` (${engine.model})` : ""}`;
}

/** Why earlier stages were passed over — shown, never swallowed (Regel 6).
 * "Lokales Modell: nicht konfiguriert" alone is the normal state of a hub
 * without one and not worth a line. */
export function skippedNote(skipped: readonly SkippedEngine[] | undefined): string {
  const shown = (skipped ?? []).filter((s) => !(s.engine === "Lokales Modell" && s.reason === "nicht konfiguriert"));
  return shown.map((s) => `${s.engine}: ${s.reason}`).join(" · ");
}

/** Client copy of the hub's artifact name rule (skills.ts ARTIFACT_NAME). */
export const ARTIFACT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Starting point when the person wants a new file despite an existing one. */
export function newArtifactDraft(kind: "skill" | "agent" | "workflow", name: string, description: string, prompt: string): string {
  const title = kind === "skill" ? "Skill" : kind === "agent" ? "Agent" : "Workflow";
  const quoted = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `---\nname: ${name}\ndescription: "${quoted}"\n---\n\n# ${title}: ${name}\n\n${prompt.trim()}\n`;
}

/** Keeps the frontmatter name in step with an edited file name. */
export function renameDraft(draft: string, name: string): string {
  return draft.replace(/^(---\r?\n(?:[\s\S]*?\r?\n)?)name:[^\n]*/, `$1name: ${name}`);
}

import { z } from "zod";

/** Prompt enhancement and skill maintenance API (ADR-0089). */
export interface PromptRecommendation {
  /** EPIC-P68: `update` = exists already, adapt instead of a new file. */
  mode: "match" | "update" | "create";
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
  reason: string;
  draft: string | null;
  /** `base` = catalog skill next to the project; read-only here. */
  layer?: "base";
}

/** EPIC-P68: one skill/agent/workflow file with the hash an update must present. */
export interface SkillArtifact {
  kind: PromptRecommendation["kind"];
  name: string;
  path: string;
  content: string;
  hash: string;
  layer?: "base";
}

/** EPIC-P68 (ADR-0089): which stage rewrote the text, and what was skipped why. */
export interface RewriteEngine {
  kind: "local" | "adapter";
  id: string;
  model?: string;
}
export interface SkippedEngine {
  engine: string;
  reason: string;
}

export const PromptEnhancerSettings = z.strictObject({
  engine: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("auto") }),
    z.strictObject({ kind: z.literal("adapter"), id: z.string().trim().min(1).max(120), model: z.string().trim().min(1).max(200).optional() }),
  ]),
  scan: z.boolean(),
  knowledgeSource: z.uuid().nullable().optional(),
});
export type PromptEnhancerSettings = z.infer<typeof PromptEnhancerSettings>;
export interface PromptEnhancerPreferences {
  settings: PromptEnhancerSettings;
  engines: { id: string; modelChoice: boolean }[];
  knowledgeSources: { id: string; label: string }[];
}

export const promptEnhancerSettingsPath = "/api/settings/prompt-enhancer";


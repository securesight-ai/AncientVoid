import type { PromptRecommendation, SkillOrAgent } from "@ancientvoid/core";
import { localOneShot, type LocalRewriteModel, type RewriteTask } from "./enhance.ts";

/**
 * EPIC-P68 (ADR-0089 §4): the local model may decide the skill
 * recommendation — only the local one, never a paid adapter, and only from
 * the catalog. An invented name, a busy model or a garbled answer → null,
 * and the deterministic heuristic decides alone.
 */
export interface SkillVerdict {
  action: "none" | "use" | "update" | "create";
  name?: string;
  reason?: string;
}

const JUDGE_INSTRUCTION = `You decide whether a coding-agent prompt should use, adapt or create a skill/agent/workflow of this project. Answer with ONE JSON object only: {"action": "none"|"use"|"update"|"create", "name": "<catalog name>", "reason": "<max 12 words, German>"}.
- use: an entry in the catalog clearly fits the task as it is.
- update: an entry covers the topic but needs adjusting for this task — prefer this over create.
- create: only when the prompt explicitly asks for a new skill/agent/workflow and nothing in the catalog covers the topic.
- none: a one-off task; no entry fits. This is the usual answer.
"name" must be copied exactly from the catalog (empty for none/create). Never invent names.`;

function catalogLines(items: readonly SkillOrAgent[]): string {
  return items
    .slice(0, 80)
    .map((item) => `- ${item.kind} ${item.name}${item.layer === "base" ? " (base)" : ""}: ${item.description.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");
}

function parseVerdict(text: string, items: readonly SkillOrAgent[]): SkillVerdict | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let raw: { action?: unknown; name?: unknown; reason?: unknown };
  try {
    raw = JSON.parse(json) as typeof raw;
  } catch {
    return null;
  }
  const action = raw.action;
  if (action !== "none" && action !== "use" && action !== "update" && action !== "create") return null;
  const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 160) : undefined;
  if (action === "use" || action === "update") {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!items.some((item) => item.name === name)) return null;
    return { action, name, ...(reason ? { reason } : {}) };
  }
  return { action, ...(reason ? { reason } : {}) };
}

export async function judgeRecommendation(local: LocalRewriteModel, text: string, items: readonly SkillOrAgent[]): Promise<SkillVerdict | null> {
  if (items.length === 0) return null;
  const task: RewriteTask = {
    instruction: JUDGE_INSTRUCTION,
    context: `Catalog:\n${catalogLines(items)}`,
    user: text.slice(0, 6000),
  };
  try {
    return parseVerdict(await localOneShot({ ...local, timeoutMs: local.timeoutMs ?? 20_000 }, task), items);
  } catch {
    return null;
  }
}

/**
 * Merges the verdict with the heuristic. The model may narrow (`none`) or
 * point at a catalog entry; it may not make up a new file — `create` only
 * stands when the heuristic also found an explicit request.
 */
export function applyVerdict(
  verdict: SkillVerdict | null,
  heuristic: PromptRecommendation | null,
  items: readonly SkillOrAgent[],
): PromptRecommendation | null {
  if (!verdict) return heuristic;
  if (verdict.action === "none") return null;
  if (verdict.action === "create") return heuristic;
  const item = items.find((entry) => entry.name === verdict.name)!;
  const base = item.layer === "base";
  return {
    mode: verdict.action === "update" && !base ? "update" : "match",
    kind: item.kind,
    name: item.name,
    description: item.description,
    reason: `Lokales Modell: ${verdict.reason ?? (verdict.action === "update" ? "passt, braucht Anpassung" : "passt")}`,
    draft: null,
    ...(base ? { layer: "base" as const } : {}),
  };
}

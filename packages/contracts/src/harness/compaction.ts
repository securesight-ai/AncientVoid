import { z } from "zod";

export const compactionSettingsPath = "/api/settings/compaction";
export const compactionSettingsKey = "context.compaction";
export const CompactionSettings = z.object({ enabled: z.boolean() }).strict();
export type CompactionSettings = z.infer<typeof CompactionSettings>;

export function isCompactionCommand(text: string): boolean {
  return /^\/compact(?:\s|$)/.test(text.trimStart());
}

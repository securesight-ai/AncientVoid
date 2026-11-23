import { isCompactionCommand } from "@ancientvoid/contracts";
import { t } from "../../shared/i18n/index.ts";

/**
 * ADR-0042 (EPIC-P25 T25.4): pure logic for the composer's slash layer.
 * Suggestions only ever come from the adapter's declared `commands`
 * (scope-filtered) — an undeclared slash is never silently "executed",
 * it gets a visible notice instead (fail loud).
 */

export interface SlashCommand {
  name: string;
  description: string;
  scope: "start" | "steer" | "both";
}

/** The commands that apply here: Neu-Session = start, Antwort = steer. */
export function commandsForScope(commands: readonly SlashCommand[] | undefined, scope: "start" | "steer"): readonly SlashCommand[] {
  return (commands ?? []).filter((c) => c.scope === "both" || c.scope === scope);
}

/** While the first word is being typed ("/comp"), the matching commands. */
export function slashSuggestions(value: string, commands: readonly SlashCommand[]): readonly SlashCommand[] {
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  const typed = value.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(typed)).slice(0, 6);
}

/**
 * Notice once the first word is complete (whitespace follows) and it is
 * not a declared command — null while suggestions could still apply.
 */
export function slashNotice(value: string, commands: readonly SlashCommand[]): string | null {
  if (isCompactionCommand(value) && !commands.some((c) => c.name === "/compact")) {
    return t("composer.compaction_unavailable");
  }
  const first = /^(\S+)(\s[\s\S]*)?$/.exec(value);
  if (!first || !first[1].startsWith("/")) return null;
  if (!first[2]) return null; // still typing the first word — suggestions own this state
  if (commands.some((c) => c.name === first[1])) return null;
  return commands.length === 0
    ? "Dieser Adapter meldet keine /Commands — der Text geht als normaler Prompt."
    : `${first[1]} ist nicht als Command gemeldet — der Text geht als normaler Prompt.`;
}

/** Accepting a suggestion keeps anything already typed after the word. */
export function applySuggestion(value: string, command: SlashCommand): string {
  const rest = /^(\S+)\s*([\s\S]*)$/.exec(value);
  return `${command.name} ${rest?.[2] ?? ""}`.trimEnd() + " ";
}

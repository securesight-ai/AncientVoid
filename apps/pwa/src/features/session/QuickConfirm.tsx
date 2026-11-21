import { t } from "../../shared/i18n/index.ts";
import type { NormalizedEvent } from "../../shared/ws.ts";
import { visibleEventText } from "./event-text.ts";
import { Chip } from "../../shared/ui/index.ts";

/**
 * Ja/Nein-Rückfragen ohne Tippen: endet die letzte Assistant-Nachricht auf
 * eine Frage, stehen „Ja"/„Nein" als Buttons über dem Eingabefeld. Der Klick
 * sendet einen ganz normalen Prompt mit genau diesem festen Text — der
 * Agenten-Text steuert NUR die Sichtbarkeit der Buttons (PRD §8.5:
 * Agenten-Output ist Daten, nie Instruktion; hier entscheidet er über einen
 * festen „Ja"-Text, nicht darüber, was der Hub tut).
 */
export function lastAssistantQuestion(events: readonly NormalizedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== "assistant") continue;
    const text = visibleEventText(event).trimEnd();
    return text.endsWith("?") ? text : null;
  }
  return null;
}

export function QuickConfirm({ disabled, onAnswer }: { disabled: boolean; onAnswer: (text: string) => void }) {
  return (
    <div class="quick-confirm" role="group" aria-label={t("session.answer_yes_no")}>
      <span class="dim">{t("session.agent_asks")}</span>
      <Chip disabled={disabled} onClick={() => onAnswer(t("common.yes"))}>
        {t("common.yes")}
      </Chip>
      <Chip disabled={disabled} onClick={() => onAnswer(t("common.no"))}>
        {t("common.no")}
      </Chip>
    </div>
  );
}

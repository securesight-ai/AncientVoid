import { t } from "../../shared/i18n/index.ts";
import { contextLevel, contextText } from "./run-stats.ts";

/**
 * EPIC-P20 T20.5: the context window as a bar. The filled part shimmers
 * (CSS only, compositor-friendly); warn from 80 %, red from 95 % (same
 * thresholds as the text line). Without two real numbers it says so —
 * a striped, still bar, never an invented percentage (ADR-0032).
 */
export function ContextBar({ fill, windowTokens }: { fill: number | null; windowTokens: number | null }) {
  const known = fill !== null && windowTokens !== null && windowTokens > 0;
  const pct = known ? Math.min(100, Math.max(0, (fill / windowTokens) * 100)) : 0;
  const level = contextLevel(fill, windowTokens) ?? "ok";
  const text = contextText(fill, windowTokens);
  return (
    <div
      class={`ctx-bar ${known ? level : "unknown"}`}
      role="meter"
      aria-label={t("session.context_window")}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(known ? { "aria-valuenow": Math.round(pct) } : {})}
      aria-valuetext={text}
      title={text}
    >
      <div class="ctx-fill" style={`width: ${pct}%`} />
    </div>
  );
}

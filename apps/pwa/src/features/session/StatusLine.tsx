import { fmtNumber } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { useCounted } from "../../shared/useCounted.ts";
import { ContextBar } from "./ContextBar.tsx";
import type { QuotaSummary } from "./run-progress.ts";
import type { SessionTokenTotals } from "../../shared/api.ts";
import { tokenParts } from "./run-stats.ts";

const fmt = { format: (n: number) => fmtNumber(n) };

/**
 * EPIC-P43 T43.4: die Statuszeile ersetzt das Metrikband — nur Gemessenes (Kleinkram-Regel 1:
 * Unbekanntes schweigt hier und steht im Bericht). Tokens zählen auf ihren neuen Wert zu; der
 * Kontext steht als Balken mit den Schwellen 80/95 %, sobald Füllung und Fenster gemeldet sind.
 *
 * BUG-0184 / ADR-0084: die zwei Token-Zahlen stehen beschriftet nebeneinander — „erzeugt“, was
 * das Modell geschrieben hat, und „verarbeitet“, was seine Aufrufe bekommen haben. Ein nacktes
 * „Σ Tokens“ war die Quadratur des Kontexts und ist verboten.
 */
export function StatusLine({
  totals,
  processedFallback,
  fill,
  windowTokens,
  maxOutputTokens,
  quota,
}: {
  /** Die Bilanz aus `GET /api/sessions/:id/tokens`, null solange sie lädt. */
  totals: SessionTokenTotals | null;
  /** `record.tokensEst` — damit „verarbeitet“ nicht fehlt, während die Bilanz lädt. */
  processedFallback: number | null;
  fill: number | null;
  windowTokens: number | null;
  maxOutputTokens: number | null;
  quota: QuotaSummary;
}) {
  const shown = totals ?? { generated: null, processed: processedFallback, contextFill: null, cacheRead: null, usageEvents: 0, estimated: false };
  // Gezaehlt animiert nur die aussagekraeftigste vorhandene Zahl: erst „erzeugt“,
  // sonst „verarbeitet“. Die andere bleibt exakt (ADR-0084: zwei Zahlen, keine Mixtur).
  const animateGenerated = shown.generated !== null;
  const counted = useCounted(animateGenerated ? (shown.generated ?? 0) : (shown.processed ?? 0));
  const parts = tokenParts({
    generated: shown.generated === null ? null : animateGenerated ? Math.round(counted) : shown.generated,
    processed: shown.processed === null ? null : animateGenerated ? shown.processed : Math.round(counted),
    estimated: shown.estimated,
  });
  const windowKnown = fill !== null && windowTokens !== null && windowTokens > 0;
  if (windowKnown) {
    const pct = Math.round((fill / windowTokens) * 100);
    parts.push(t("session.context_free", { "pct": pct, "free": fmt.format(Math.max(0, windowTokens - fill)), "window": fmt.format(windowTokens) }));
  } else if (fill !== null) parts.push(t("session.context_tokens_dyn", { "n": fmt.format(fill) }));
  else if (windowTokens !== null) parts.push(t("session.context_window_tokens", { "n": fmt.format(windowTokens) }));
  const quotaKnown = quota.level !== "none";
  if (parts.length === 0 && !quotaKnown && maxOutputTokens === null) return null;
  const text = parts.join(" · ");
  return (
    <div class="run-meta status-line num">
      {parts.length > 0 && (
        <span class={`run-tokens ${windowKnown && fill / windowTokens >= 0.95 ? "err" : windowKnown && fill / windowTokens >= 0.8 ? "warn" : ""}`} title={text}>
          {text}
        </span>
      )}
      {windowKnown && <ContextBar fill={fill} windowTokens={windowTokens} />}
      {maxOutputTokens !== null && <span>{t("session.output_limit")} {fmt.format(maxOutputTokens)} {t("common.tokens")}</span>}
      {quotaKnown && <span class={`run-quota ${quota.level}`}>{quota.text}</span>}
    </div>
  );
}

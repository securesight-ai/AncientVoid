import { z } from "zod";
import { MetricSource } from "../sessions/metrics.ts";

/**
 * EPIC-P21 T21.3: one finished turn as a measurement. Derived from the
 * event stream (K7) — the SQLite table is a cache that can be rebuilt from
 * JSONL. `durationMs` is wall-clock including waits for approvals.
 */
export const TurnMetric = z.object({
  sessionId: z.string().min(1),
  /** 1-based turn number within the session. */
  turn: z.number().int().positive(),
  adapter: z.string().min(1),
  model: z.string().nullable(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  /** Summed tokensEst of the turn; null = nothing reported (never 0). */
  tokens: z.number().nonnegative().nullable(),
  tokensSource: MetricSource.nullable(),
  costUsd: z.number().nonnegative().nullable(),
  events: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  outcome: z.enum(["ok", "error"]),
});
export type TurnMetric = z.infer<typeof TurnMetric>;

/** Fewer finished turns than this: no estimate (R9.7 — unknown instead of guessed). */
export const MIN_TURNS_FOR_ESTIMATE = 5;

/**
 * What the PWA shows for a running turn:
 * - `no-data` / `too-few`: no number, only the count;
 * - `ok`: median and P80 of comparable turns; `remainingMs` = median - elapsed (≥ 0),
 *   `overrun` once the turn is past the P80.
 */
export const RunEstimate = z.object({
  state: z.enum(["no-data", "too-few", "ok"]),
  /** Comparable finished turns the numbers come from. */
  n: z.number().int().nonnegative(),
  /** "session" = this session's own earlier turns, "model" = same adapter and model, "adapter" = same adapter only. */
  basis: z.enum(["session", "model", "adapter", "none"]),
  medianMs: z.number().nullable(),
  p80Ms: z.number().nullable(),
  /** Median tokens per second over comparable turns that reported tokens. */
  tokensPerSec: z.number().nullable(),
  /** BUG-0167: Median der eigenen, erfolgreichen Züge dieser Session —
   * unabhängig von MIN_TURNS_FOR_ESTIMATE (Client-Regel: ab 2). Nur mit
   * Session-ID gesetzt; der Client zeigt daraus „Zug hier meist“, auch wenn
   * sein Reload das Ereignisfenster gekappt hat. */
  sessionMedianMs: z.number().nullable().optional(),
  /** BUG-0167: Zahl der eigenen, erfolgreichen Züge dieser Session. */
  sessionTurns: z.number().int().nonnegative().optional(),
});
export type RunEstimate = z.infer<typeof RunEstimate>;

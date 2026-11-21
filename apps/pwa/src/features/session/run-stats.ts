import { fmtNumber, fmtTime, fmtDateTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { createContextUsageReader } from "@ancientvoid/contracts";
import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * ADR-0032: token numbers per turn and the context fill, both read from
 * the event stream — `tokensEst` summed per turn, the context fill is the
 * last `payload.usage.input` a turn saw (the request carries the whole
 * history, so its input IS how full the window was).
 */
export interface TurnStats {
  /** Seq of the turn's `session.turn_end`. */
  endSeq: number;
  /** Summed tokensEst of the turn — what the calls were *fed* (ADR-0084). */
  tokens: number;
  /** Summed output tokens the model *wrote* in the turn; null = never reported. */
  generated: number | null;
  /** Last reported context fill of the turn, in tokens. */
  contextTokens: number | null;
}

export interface SessionTokenStats {
  turns: TurnStats[];
  lastContextTokens: number | null;
}

export function turnTokenStats(events: readonly NormalizedEvent[]): SessionTokenStats {
  const turns: TurnStats[] = [];
  let tokens = 0;
  let generated: number | null = null;
  let context: number | null = null;
  let lastContext: number | null = null;
  const readContext = createContextUsageReader();
  for (const e of events) {
    if (typeof e.tokensEst === "number") tokens += e.tokensEst;
    const out = usageOutput(e);
    if (out !== null) generated = (generated ?? 0) + out;
    const input = readContext(e.payload);
    // Auch laufend: der Balken zeigt die letzte gemeldete Füllung, nicht
    // erst ab dem ersten beendeten Zug (sonst „unbekannt" mitten im Zug,
    // obwohl der Provider Zahlen geschickt hat).
    if (input !== null) {
      context = input;
      lastContext = input;
    }
    if (e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end") {
      turns.push({ endSeq: e.seq, tokens, generated, contextTokens: context });
      tokens = 0;
      generated = null;
    }
  }
  return { turns, lastContextTokens: lastContext };
}

/** Ausgabe-Tokens desselben Musters: claude/cursor `output_tokens`, codex
 * `outputTokens` plus Reasoning-Anteil (Denken ist erzeugter Text, ADR-0084). */
function usageOutput(e: NormalizedEvent): number | null {
  const usage = (e.payload as { usage?: unknown } | undefined)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const one = (...keys: string[]): number | null => {
    for (const k of keys) if (typeof u[k] === "number" && Number.isFinite(u[k] as number)) return u[k] as number;
    return null;
  };
  const plain = one("output", "outputTokens", "output_tokens");
  const reasoning = one("reasoningOutput", "reasoningOutputTokens", "reasoning_output_tokens");
  if (plain === null && reasoning === null) return null;
  return (plain ?? 0) + (reasoning ?? 0);
}

/** Turns that closed between two visible events — the row a filtered list
 * (Chat hides session.turn_end) still needs under the turn's last row. */
export function turnsClosedBetween(turns: readonly TurnStats[], prevSeq: number, nextSeq: number | null): TurnStats[] {
  return turns.filter((t) => t.endSeq > prevSeq && (nextSeq === null || t.endSeq < nextSeq));
}

/** Die Modell-Ansagen der Adapter, die eines dieser Events emitieren —
 * Cursor gehört dazu: adapter-cursor meldet `cursor.model` mit echter
 * Fenstergröße (contextWindowFor), derselbe Vertrag wie acp/pi/opencode. */
const MODEL_EVENT_KINDS = new Set(["acp.model", "acp.context", "opencode.model", "pi.model", "cursor.model"]);

function isModelMetadata(payload: Record<string, unknown>): boolean {
  return MODEL_EVENT_KINDS.has(String(payload.kind)) ||
    (payload.kind === "codex.token_usage" && typeof payload.contextWindowTokens === "number") ||
    (payload.kind === "claude.result" && typeof payload.model === "string");
}

/** Die session's current model is its LATEST announce — its window or none.
 * An older model's window is not this model's window, so it never shines
 * through. */
export function contextWindowFromEvents(events: readonly NormalizedEvent[]): number | null {
  const value = modelMetadataFromEvents(events)?.contextWindowTokens;
  return typeof value === "number" ? value : null;
}

export function outputLimitFromEvents(events: readonly NormalizedEvent[]): number | null {
  const value = modelMetadataFromEvents(events)?.maxOutputTokens;
  return typeof value === "number" ? value : null;
}

function modelMetadataFromEvents(events: readonly NormalizedEvent[]): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const { payload } = events[i]!;
    if (isModelMetadata(payload)) return payload;
  }
  return undefined;
}

/** Der zuletzt angekündigte Modellname (Kopfzeile der Session-Ansicht) —
 * dieselbe Event-Auswahl wie contextWindowFromEvents, damit Fenster und
 * Name nie aus zwei verschiedenen Ankündigungen stammen. */
export function latestModelName(events: readonly NormalizedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const payload = events[i]!.payload as { kind?: unknown; model?: unknown };
    if (isModelMetadata(payload) && typeof payload.model === "string" && payload.model) {
      return payload.model;
    }
  }
  return null;
}

const fmt = { format: (n: number) => fmtNumber(n) };

/** One honest sentence about the context window (ADR-0032): a percentage
 * and the free room only from two real numbers; a missing number is said,
 * not hidden (fail loud). */
export function contextText(fill: number | null, windowTokens: number | null): string {
  if (fill === null) return "Kontext unbekannt";
  if (windowTokens === null || windowTokens <= 0) return `Kontext ${fmt.format(fill)} Tokens · Fenstergröße unbekannt`;
  const pct = Math.round((fill / windowTokens) * 100);
  return `Kontext ${pct} % · frei ${fmt.format(Math.max(0, windowTokens - fill))} von ${fmt.format(windowTokens)}`;
}

/** The session's token sums, each named after what it means (ADR-0084): what the
 * model wrote vs. what its calls were fed. A missing number is absent, not 0. */
export function tokenParts(totals: { generated: number | null; processed: number | null; estimated: boolean }): string[] {
  const parts: string[] = [];
  if (totals.generated !== null) parts.push(`${fmt.format(totals.generated)} Tokens erzeugt`);
  if (totals.processed !== null) parts.push(`${compactTokens(totals.processed)} Tokens verarbeitet${totals.estimated ? " (Anteile geschätzt)" : ""}`);
  return parts;
}

/** Die Zug-Zeile unter einem abgeschlossenen Zug: beide Zahlen nennen sich selbst
 * (ADR-0084). Ohne gemeldete Ausgabe bleibt nur „verarbeitet“ stehen. */
export function turnStatsText(turnNo: number, turns: readonly TurnStats[]): string {
  const tokens = turns.reduce((s, t) => s + t.tokens, 0);
  const generated = turns.reduce<number | null>((s, t) => (t.generated === null ? s : (s ?? 0) + t.generated), null);
  const fill = turns[turns.length - 1]?.contextTokens ?? null;
  const nums = generated === null ? `${fmt.format(tokens)} verarbeitet` : `${fmt.format(generated)} Tokens erzeugt · ${compactTokens(tokens)} verarbeitet`;
  return `Zug ${turnNo}: ${nums}${fill !== null ? ` · Kontext ${fmt.format(fill)}` : ""}`;
}

/** Schmale Handyzeile: ab einer Million „272,6 Mio“ statt „272.613.546“. */
export function compactTokens(n: number): string {
  if (Math.abs(n) < 1_000_000) return fmt.format(n);
  return `${fmtNumber(n / 1_000_000, { maximumFractionDigits: 1 })} ${t("session.mio")}`;
}

/** Context level for styling — warn from 80 %, err from 95 %. */
export function contextLevel(fill: number | null, windowTokens: number | null): "warn" | "err" | null {
  if (fill === null || windowTokens === null || windowTokens <= 0) return null;
  const pct = fill / windowTokens;
  if (pct >= 0.95) return "err";
  if (pct >= 0.8) return "warn";
  return null;
}

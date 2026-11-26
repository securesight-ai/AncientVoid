import { EVAL_COMPLETE_EVENT, EvalResult, type EvalRunInput, type NormalizedEvent, type SessionRecord } from "@ancientvoid/contracts";
import type { EventStore } from "../../platform/eventstore.ts";
import { deriveTurnMetrics } from "./derive.ts";

export async function readEvaluation(store: EventStore, sessionId: string): Promise<EvalResult | null> {
  const event = (await store.replay(sessionId)).find((entry) => entry.type === "system" && entry.summary === EVAL_COMPLETE_EVENT);
  if (!event) return null;
  const payload = event.blobRef
    ? JSON.parse((await store.readBlob(sessionId, event.blobRef.replace(/^sha256:/, ""))).toString("utf8")) as Record<string, unknown>
    : event.payload;
  return EvalResult.parse(payload.result);
}

export function measureEvaluationPhase(
  phase: EvalRunInput["phases"][number],
  session: SessionRecord,
  events: readonly NormalizedEvent[],
): EvalResult["phases"][number] {
  const turns = deriveTurnMetrics(events, { sessionId: session.id, adapter: session.adapter, model: session.model });
  const first = turns[0];
  const last = turns.at(-1);
  if (!first || !last || !session.model) throw new Error("Evaluation requires a completed turn and an explicit model");
  const lastTurnEnd = events.findLastIndex((event) => event.type === "system" && event.payload.kind === "session.turn_end");
  const completed = events.slice(0, lastTurnEnd + 1);
  const usage = completed.filter((event) => event.payload.usage !== undefined || event.tokensEst !== undefined);
  let inputTokens = 0;
  let outputTokens = 0;
  for (const event of usage) {
    const split = event.payload.usage as { input?: unknown; output?: unknown } | undefined;
    const input = split?.input;
    const output = split?.output;
    if (event.tokensSource === "estimated" || typeof input !== "number" || typeof output !== "number" ||
        !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) {
      throw new Error("Evaluation requires native input and output usage for every metered event");
    }
    const cacheInput = event.payload.cacheInputTokens;
    if (cacheInput !== undefined && (typeof cacheInput !== "number" || !Number.isSafeInteger(cacheInput) || cacheInput < 0)) {
      throw new Error("Evaluation received invalid cache input usage");
    }
    inputTokens += input + (cacheInput ?? 0);
    outputTokens += output;
  }
  if (inputTokens + outputTokens === 0) throw new Error("Evaluation has no positive token usage");
  const billing = phase.billing;
  const costUsd = billing.kind === "cloud"
    ? (inputTokens * billing.inputUsdPerMillion + outputTokens * billing.outputUsdPerMillion) / 1_000_000
    : billing.kwh * billing.usdPerKwh;
  return {
    adapter: session.adapter,
    adapterVersion: session.adapterVersion,
    model: session.model,
    inputTokens,
    outputTokens,
    costUsd,
    turnErrors: turns.filter((turn) => turn.outcome === "error").length,
    toolErrors: completed.filter((event) => event.type === "tool_result" &&
      (event.payload.isError === true || event.payload.is_error === true)).length,
    turns: turns.length,
    startedAt: first.startedAt,
    endedAt: last.endedAt,
  };
}

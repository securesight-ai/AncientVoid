import { providerErrorEvent, type EmittedEvent } from "@ancientvoid/contracts";

/**
 * Maps one parsed line of `opencode run --format json` output to zero or
 * more EmittedEvents.
 *
 * Ground truth: two real `opencode run <prompt> --format json --auto`
 * captures (opencode 1.18.29, 2026-09-18, real zai-coding-plan/glm-5.3
 * calls) — see `test/fixtures/`. Unlike claude/codex, one opencode
 * `tool_use` line already carries the tool's completed (or errored) result
 * inline (`part.state.status`/`output`/`error`) — there is no separate
 * "tool result arrived later" line to wait for, so normalizeOpencodeLine()
 * emits both the `tool_use` and (when the call has already settled) its
 * paired `tool_result` from that one real event, using the same
 * `payload.id`/`payload.toolUseId` correlation the PWA's tool-anchor-jump
 * logic already expects generically (event-filter.ts's toolIdOf()).
 *
 * `step_finish` carries per-step (not cumulative) `tokens.total` and
 * `cost` — real, always-present fields (this provider genuinely reports
 * $0 per call on a subscription plan, not "unreported"), so both are
 * forwarded on every step_finish and summed by SessionManager exactly like
 * claude's per-turn costUsd (ADR-0003) and tokensEst (ADR-0006) already
 * are — no adapter-specific aggregation needed.
 */

interface ToolState {
  status?: string;
  input?: unknown;
  output?: string;
  error?: string;
}

interface Part {
  type?: string;
  tool?: string;
  callID?: string;
  state?: ToolState;
  text?: string;
}

interface OpencodeLine {
  type?: string;
  sessionID?: string;
  part?: Part;
}

function asString(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function normalizeOpencodeLine(raw: unknown): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [{ type: "system", summary: "opencode: non-object JSON line", payload: { raw: asString(raw) } }];
  }
  const line = raw as OpencodeLine;
  const part = line.part;

  switch (line.type) {
    case "step_start":
      return [{ type: "system", summary: "OpenCode denkt…", payload: { kind: "opencode.step_start" } }];

    case "reasoning": {
      const text = part?.text ?? "";
      if (!text) return [{ type: "system", summary: "opencode: reasoning line without text", payload: {} }];
      return [{ type: "thinking", summary: asString(text), payload: { text } }];
    }

    case "tool_use": {
      if (!part || part.type !== "tool" || !part.callID) {
        return [
          {
            type: "system",
            summary: "opencode: tool_use line missing expected fields",
            payload: { raw: asString(line, 300) },
          },
        ];
      }
      const events: EmittedEvent[] = [
        {
          type: "tool_use",
          summary: `opencode: ${part.tool ?? "tool"} ${asString(part.state?.input, 80)}`,
          payload: { id: part.callID, tool: part.tool, input: part.state?.input },
        },
      ];
      const status = part.state?.status;
      if (status === "completed" || status === "error") {
        const isError = status === "error";
        events.push({
          type: "tool_result",
          summary: isError ? `opencode: ${part.tool} error — ${asString(part.state?.error, 120)}` : asString(part.state?.output, 150),
          payload: {
            toolUseId: part.callID,
            isError,
            ...(isError ? { error: part.state?.error } : { output: part.state?.output }),
          },
        });
      }
      return events;
    }

    case "text": {
      if (!part?.text) {
        return [{ type: "system", summary: "opencode: text line without text", payload: {} }];
      }
      return [{ type: "assistant", summary: asString(part.text), payload: { text: part.text } }];
    }

    case "step_finish": {
      const p = part as Part & {
        tokens?: { total?: number; reasoning?: number; input?: number; output?: number; cache?: { read?: number; write?: number } };
        cost?: number;
        reason?: string;
      };
      // T7.7 (ADR-0023): opencode prints 0 for subscription plans and local
      // providers alike — that is "no price", never a confirmed $0.
      const costUsd = typeof p.cost === "number" && p.cost > 0 ? p.cost : undefined;
      const tokensEst = typeof p.tokens?.total === "number" ? p.tokens.total : undefined;
      const reasoning = typeof p.tokens?.reasoning === "number" ? p.tokens.reasoning : undefined;
      const cache = (p.tokens?.cache?.read ?? 0) + (p.tokens?.cache?.write ?? 0);
      const usage = typeof p.tokens?.input === "number" && typeof p.tokens.output === "number"
        ? { input: p.tokens.input + (p.tokens.cache?.read ?? 0) + (p.tokens.cache?.write ?? 0), output: p.tokens.output + (reasoning ?? 0) }
        : undefined;
      const summary =
        p.reason === "length"
          ? reasoning !== undefined
            ? `OpenCode hat am Längenlimit aufgehört. ${reasoning} Tokens gingen ins Denken, ohne sichtbare Antwort.`
            : "OpenCode hat am Längenlimit aufgehört, ohne sichtbare Antwort."
          : `opencode: step finish (${p.reason ?? "unknown"})`;
      return [
        {
          type: "system",
          summary,
          payload: { kind: "opencode.step_finish", reason: p.reason, ...(usage ? { usage } : {}), ...(usage && cache > 0 ? { cacheInputTokens: cache, cacheIncluded: true } : {}), ...(reasoning !== undefined ? { reasoning } : {}) },
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(tokensEst !== undefined ? { tokensEst } : {}),
        },
      ];
    }

    case "error": {
      // ADR-0015: {"type":"error","error":{"name","data":{"message","ref"}}}
      const err = (raw as { error?: { name?: unknown; message?: unknown; data?: { message?: unknown; ref?: unknown } } }).error;
      const message = [err?.data?.message, err?.message, err?.name].find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
      const ref = typeof err?.data?.ref === "string" ? err.data.ref : undefined;
      return [providerErrorEvent("opencode", message, ref)];
    }

    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized opencode event type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `opencode: unhandled event type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60) },
        },
      ];
  }
}

/**
 * Example: OpenAI-compatible endpoint adapter (own providers / local models).
 *
 * Works with any OpenAI-style /v1/chat/completions endpoint:
 * llama.cpp server, LM Studio, Ollama, vLLM, vLLM-served Qwen finetunes,
 * or cloud providers behind a compatible gateway.
 *
 * Wire it into hub.config.json:
 *
 *   {
 *     "id": "my-endpoint",
 *     "module": "./examples/adapters/openai-compat/adapter.ts",
 *     "config": {
 *       "baseUrl": "http://127.0.0.1:8080/v1",
 *       "model": "qwen2.5-coder:14b",
 *       "apiKeyEnv": "LLAMA_API_KEY"
 *     }
 *   }
 *
 * The ONLY thing an adapter is allowed to touch is @ancientvoid/contracts —
 * everything else the hub provides via AdapterContext.
 */
import { isCompactionCommand } from "@ancientvoid/contracts";
import { compactHistory, type HistoryMessage } from "./compaction.ts";
import { z } from "zod";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  SessionHandle,
  SessionSpec,
  SteerInput,
} from "@ancientvoid/contracts";

const EndpointConfig = z.object({
  baseUrl: z.string().url(),
  model: z.string().default("local-model"),
  apiKeyEnv: z.string().default("LOCAL_LLM_API_KEY"),
  temperature: z.number().min(0).max(2).default(0.2),
});
type EndpointConfig = z.infer<typeof EndpointConfig>;

interface EndpointHandle extends SessionHandle {
  meta: { history: HistoryMessage[]; busy: boolean; compactNext: boolean };
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = EndpointConfig.parse(config ?? {});
  const apiKey = process.env[cfg.apiKeyEnv] ?? "";
  const handles = new Map<string, EndpointHandle>();

  /** Fail loud, begrenzt (K5): ein Abbruch durch die Session ist kein Fehler, alles andere ein error-Event. */
  function reportFailure(err: unknown, ctx: AdapterContext): void {
    if (ctx.signal.aborted) {
      ctx.emit({ type: "system", summary: "completion aborted", payload: {} });
      return;
    }
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    ctx.emit({ type: "error", summary: `endpoint call failed: ${message}`, payload: { message } });
  }

  /** Stream one completion, mapping SSE chunks to normalized events. */
  async function runCompletion(handle: EndpointHandle, ctx: AdapterContext): Promise<void> {
    const { history, compactNext } = handle.meta;
    const compacted = ctx.automaticCompaction || compactNext ? compactHistory(history) : null;
    if (compacted && (compacted.repeats > 0 || compactNext)) {
      ctx.emit({
        type: "system",
        summary: `AncientVoid: ${compacted.repeats} Wiederholungen gekürzt (${compacted.savedBytes} Bytes)`,
        payload: { kind: "endpoint.compaction", repeats: compacted.repeats, savedBytes: compacted.savedBytes },
      });
    }
    ctx.emit({
      type: "system",
      summary: `querying ${cfg.baseUrl} (${cfg.model})`,
      payload: { baseUrl: cfg.baseUrl, model: cfg.model },
    });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: compacted?.messages ?? history,
        temperature: cfg.temperature,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      ctx.emit({
        type: "error",
        summary: `endpoint returned ${res.status}`,
        payload: { status: res.status },
      });
      return;
    }
    let assistant = "";
    let reasoning = "";
    let invalidLine = false;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      if (ctx.signal.aborted) return;
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let parsed: {
          choices?: { delta?: { content?: string; reasoning_content?: string } }[];
          error?: { message?: unknown } | string;
        };
        try {
          parsed = JSON.parse(data) as typeof parsed;
        } catch {
          // Die Zeile ist vollständig (am \n getrennt) — unlesbar heißt unbekanntes Format, nicht „unvollständig“.
          invalidLine = true;
          ctx.emit({
            type: "system",
            summary: "unlesbare Antwortzeile vom Endpoint",
            payload: { kind: "endpoint.invalid_sse_line", line: data.slice(0, 200) },
          });
          continue;
        }
        if (parsed.error !== undefined) {
          const message = String(typeof parsed.error === "string" ? parsed.error : (parsed.error.message ?? "unbekannter Fehler")).slice(0, 300);
          ctx.emit({ type: "error", summary: `endpoint meldet Fehler: ${message}`, payload: { message } });
          continue;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
        }
        if (delta?.content) {
          assistant += delta.content;
          ctx.emit({
            type: "assistant",
            summary: delta.content.slice(0, 120),
            payload: { delta: delta.content },
            tokensEst: Math.ceil(delta.content.length / 4),
          });
        }
      }
    }
    if (invalidLine && !assistant && !reasoning) {
      ctx.emit({ type: "error", summary: "Endpoint-Stream ohne verwertbare Antwort", payload: { kind: "endpoint.invalid_sse_stream" } });
      return;
    }
    // Reasoning lands fully in a blob; the stream stays small (K5 pattern).
    if (reasoning.length > 0) {
      const blob = await ctx.blob(reasoning);
      ctx.emit({
        type: "thinking",
        summary: `reasoning (${reasoning.length} chars → blob)`,
        payload: { bytes: blob.bytes },
        blobRef: `sha256:${blob.hash}`,
      });
    }
    if (assistant.length > 0) {
      handle.meta.compactNext = false;
      handle.meta.history.push({ role: "assistant", content: assistant });
    }
    ctx.emit({ type: "system", summary: "completion finished", payload: {} });
  }

  function submit(handle: EndpointHandle, text: string, ctx: AdapterContext): void {
    handle.meta.busy = true;
    handle.meta.history.push({ role: "user", content: text });
    ctx.turn?.("working");
    void runCompletion(handle, ctx).catch((err: unknown) => reportFailure(err, ctx)).finally(() => {
      handle.meta.busy = false;
      ctx.turn?.("idle");
    });
  }

  return {
    id: "my-endpoint",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return { reasoning: true, tools: false, cost: false, steer: true, usage: false, promptDelivery: "next-turn", promptlessStartIdle: true, commands: [{ name: "/compact", description: "Wiederholungen für die nächste Anfrage kürzen", scope: "steer" }], nativeDiscovery: "none", nativeResume: "none", features: { followUp: true, interrupt: false, toolGate: "none", questions: false, modelChoice: "none", skills: false, agents: false, images: false, files: false, contextFork: false, modelSwitch: false, permissionModes: [] } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      if (spec.prompt && isCompactionCommand(spec.prompt)) throw new Error("/compact erfordert eine gestartete Session");
      const handle: EndpointHandle = {
        sessionId: ctx.sessionId,
        meta: { history: [], busy: false, compactNext: false },
      };
      handles.set(handle.sessionId, handle);
      ctx.emit({ type: "system", summary: `session ready (${cfg.baseUrl})`, payload: { baseUrl: cfg.baseUrl } });
      if (spec.prompt) {
        submit(handle, spec.prompt, ctx);
      }
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const h = handles.get(handle.sessionId);
      if (!h) return { ok: false, detail: "unknown handle" };
      if (input.kind === "prompt") {
        if (h.meta.busy) return { ok: false, detail: "Endpoint-Anfrage läuft bereits" };
        if (isCompactionCommand(input.text)) {
          if (input.text.trim() !== "/compact" || input.attachments?.length) {
            return { ok: false, detail: "/compact nimmt keine Argumente oder Anhänge an" };
          }
          h.meta.compactNext = true;
          ctx.emit({ type: "system", summary: "AncientVoid: Compaction für die nächste Anfrage vorgemerkt", payload: { kind: "endpoint.compaction_scheduled" } });
          return { ok: true };
        }
        submit(h, input.text, ctx);
        return { ok: true };
      }
      if (input.kind === "stop") {
        return { ok: true };
      }
      return { ok: true };
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      if (!handles.has(handle.sessionId)) return { state: "down", detail: "session stopped" };
      return { state: "healthy", detail: cfg.baseUrl };
    },

    async stop(handle: SessionHandle): Promise<void> {
      handles.delete(handle.sessionId);
    },
  };
}

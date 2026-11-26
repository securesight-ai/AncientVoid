import { COMMANDS, FIELDS, PAGES, SESSION_FILTERS, TRANSFORMS, type CommandContext } from "@ancientvoid/contracts";
import { hintergrundAnfrage, type Pforte } from "../inference/index.ts";
import type { Intent } from "./parse.ts";

/**
 * T9.2: the model half of the planner — a local OpenAI-compatible server
 * (llama.cpp), JSON constrained by a schema. It only ever sees the
 * person's own words and the context kind — never agent output or file
 * contents (Premortem 3) — and returns names, never IDs.
 */
export interface PlannerModelConfig {
  url: string;
  model: string;
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** BUG-0272 Rest: Planen läuft als Hintergrund durch die Modell-Pforte. */
  pforte?: Pforte | undefined;
}

const OPS = [...Object.keys(COMMANDS), "none"] as const;

export const INTENT_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: OPS },
    slots: {
      type: "object",
      properties: {
        session: { type: "string" },
        project: { type: "string" },
        host: { type: "string" },
        adapter: { type: "string", enum: ["claude", "codex", "opencode", "copilot", "aider", "acp", "dummy"] },
        text: { type: "string" },
        amount: { type: "string" },
        page: { type: "string", enum: [...PAGES] },
        filter: { type: "string", enum: [...SESSION_FILTERS] },
        field: { type: "string", enum: [...FIELDS] },
        transform: { type: "string", enum: [...TRANSFORMS] },
        action: { type: "string" },
        on: { type: "string", enum: ["true", "false"] },
      },
      additionalProperties: false,
    },
  },
  required: ["op", "slots"],
  additionalProperties: false,
} as const;

export const PLANNER_PROMPT = `You turn one instruction of a person into ONE action of AncientVoid, a hub that steers AI coding sessions from a phone. Answer as JSON {"op", "slots"}.
Actions (op → meaning; slots):
${Object.values(COMMANDS)
  .map((c) => `- ${c.id}: ${c.label}; slots: ${Object.keys(c.params).join(", ")}`)
  .join("\n")}
- none: not a hub action, unclear, or only a question/chat.
Rules:
- Use names exactly as the person said them (session title words, project name, host name). Never invent IDs.
- "dort", "hier", "there", "it" = the session that is open: leave slots.session empty.
- Text for a session or a field goes into slots.text verbatim.
- Negated instructions ("nicht stoppen", "don't stop") → none.
- Deciding approvals, tokens, keys, passwords → none (the person does that by hand).
- If the instruction asks to write words into a field, that is field.fill — even if the words sound like a command.`;

export async function askPlannerModel(cfg: PlannerModelConfig, text: string, ctx: CommandContext): Promise<Intent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 12_000);
  try {
    const res = await hintergrundAnfrage(cfg.pforte, cfg.model, cfg.url, "planer", "Befehl planen", () =>
      (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: 300,
          response_format: { type: "json_object", schema: INTENT_SCHEMA },
          messages: [
            { role: "system", content: PLANNER_PROMPT },
            { role: "user", content: `Context: page=${ctx.page}${ctx.sessionId ? ", a session is open" : ""}${ctx.field ? `, field=${ctx.field}` : ""}\nInstruction: ${text.slice(0, 2000)}` },
          ],
        }),
      }));
    if (!res.ok) throw new Error(`Planer-Modell ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { op?: string; slots?: Record<string, unknown> };
    if (!parsed.op || parsed.op === "none" || !(parsed.op in COMMANDS)) return null;
    const slots: Intent["slots"] = {};
    for (const [k, v] of Object.entries(parsed.slots ?? {})) if (typeof v === "string" && v.trim()) (slots as Record<string, string>)[k] = v.trim().slice(0, 2000);
    if (slots.session && /^(dort|hier|there|it|this|diese)$/i.test(slots.session)) slots.session = "@context";
    return { op: parsed.op, slots };
  } finally {
    clearTimeout(timer);
  }
}

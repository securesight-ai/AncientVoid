import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { api } from "./api.ts";
import { t } from "./i18n/index.ts";

/**
 * EPIC-P41 T41.5 (ADR-0064): hubctl-Zugriff auf Automationen — Liste/Editor/
 * Run-now/Disable/Verlauf. Der CLI rechnet keine Ergebnisse aus; `dispatched`
 * ist ein Startauftrag, das Ergebnis zeigt der Verlauf der referenzierten
 * Ausführung.
 */

import type { AutomationHistoryEntry, AutomationInfo, AutomationDefinition } from "@ancientvoid/contracts";
export type { AutomationHistoryEntry, AutomationInfo } from "@ancientvoid/contracts";

/**
 * Baut die Definition für POST /api/automations: JSON darf minimal sein —
 * id/generation/enabled/createdAtUtc ergänzt der CLI. Bei einem Session-Ziel
 * wird der Prompt-Blob-Verweis aus dem Prompt-Text berechnet (K5: nur der
 * SHA in der Definition, der Text als Blob beim Hub).
 */
export function buildAutomationDefinition(jsonText: string, promptText: string | null): Record<string, unknown> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(t("def_json_invalid", { err: err instanceof Error ? err.message : String(err) }), { cause: err });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(t("def_json_object"));
  const target = raw.target as { kind?: string; promptBlobSha256?: string; project?: unknown; actionId?: unknown } | undefined;
  if (!target || (target.kind !== "session" && target.kind !== "swarm" && target.kind !== "team" && target.kind !== "run" && target.kind !== "script")) {
    throw new Error(t("def_json_target"));
  }
  // ADR-0077/ADR-0123 §6: CLI-Alias — alte kind "run" (bis P60) und "team" (bis P83) werden auf "swarm" normalisiert.
  if (target.kind === "run" || target.kind === "team") target.kind = "swarm";
  // ADR-0080: Skript-Ziele referenzieren eine registrierte argv-Aktion — project und actionId sind Pflicht.
  if (target.kind === "script" && (typeof target.project !== "string" || target.project.trim() === "" || typeof target.actionId !== "string" || target.actionId.trim() === "")) {
    throw new Error(t("script_target_needs"));
  }
  if (target.kind === "session" && !target.promptBlobSha256) {
    if (promptText === null) throw new Error(t("session_target_prompt"));
    target.promptBlobSha256 = createHash("sha256").update(promptText).digest("hex");
  }
  return {
    enabled: false, // Neuanfang-Zustand: die Aktivierung ist die separate menschliche Freigabe.
    generation: 1,
    ...raw,
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : randomUUID(),
    createdAtUtc: typeof raw.createdAtUtc === "string" && raw.createdAtUtc.length >= 20 ? raw.createdAtUtc : new Date().toISOString(),
    target,
  };
}

/** Zeile für `automations list` — Label, Zustand, Plan, nächster Termin, letztes Ergebnis. */
export function formatAutomationLine(info: AutomationInfo): string {
  const d = info.definition;
  const plan = d.schedule.kind === "cron" ? `${d.schedule.cron ?? "?"}` : `${d.schedule.preset ?? "?"}${d.schedule.localTime ? ` ${d.schedule.localTime}` : ""}`;
  const next = info.nextOccurrences[0]?.utc ?? "—";
  const last = info.lastOccurrence ? `${info.lastOccurrence.state}${info.lastOccurrence.reason ? `/${info.lastOccurrence.reason}` : ""}${info.lastOccurrence.outcome ? `/${info.lastOccurrence.outcome}` : ""}` : "—";
  return `${d.id.slice(0, 8)}  ${d.enabled ? t("on_pad") : t("off_word")}  ${d.label.padEnd(24).slice(0, 24)}  ${plan.padEnd(18).slice(0, 18)}  ${d.schedule.timezone.padEnd(14).slice(0, 14)}  next ${next}  last ${last}`;
}

/** Verlaufszeile; `unknown`/Missed tragen ihre Begründung, damit Unsicherheit im CLI nicht unsichtbar bleibt (AC-P41-3). */
export function formatHistoryLine(h: AutomationHistoryEntry): string {
  return `${h.at}  ${h.occurrenceUtc}  ${h.state}${h.reason ? `/${h.reason}` : ""}${h.outcome ? ` ${h.outcome}` : ""}${h.kind ? `  ${h.kind}` : ""}${h.sessionId ? `  session ${h.sessionId}` : ""}${h.swarmId ? `  swarm ${h.swarmId}` : ""}${h.missedThroughUtc ? `  ${t("verpasst_bis")} ${h.missedThroughUtc}` : ""}${h.detail ? `  — ${h.detail}` : ""}`;
}

export function buildAutomationUpdate(jsonText: string, previous: AutomationDefinition, promptText: string | null): Record<string, unknown> {
  const raw: unknown = JSON.parse(jsonText);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(t("update_json_object"));
  const patch = raw as Partial<AutomationDefinition>;
  const target = { ...previous.target, ...(patch.target ?? {}) };
  if (target.kind === "session" && promptText !== null) target.promptBlobSha256 = createHash("sha256").update(promptText).digest("hex");
  return { ...previous, ...patch, id: previous.id, generation: previous.generation, enabled: previous.enabled, createdAtUtc: previous.createdAtUtc,
    target, schedule: { ...previous.schedule, ...(patch.schedule ?? {}) }, grant: { ...previous.grant, ...(patch.grant ?? {}) } };
}

async function findAutomation(id: string): Promise<AutomationInfo> {
  const { automations } = await api<{ automations: AutomationInfo[] }>("/api/automations");
  const exact = automations.find(a => a.definition.id === id);
  if (exact) return exact;
  const matches = automations.filter(a => a.definition.id === id || a.definition.id.startsWith(id));
  if (matches.length !== 1) throw new Error(matches.length ? t("id_prefix_ambiguous") : t("unknown_automation", { id }));
  return matches[0]!;
}

export async function runAutomationsCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const readStdinJson = (): string => readFileSync(0, "utf8");
  switch (sub) {
    case "list": {
      const { automations } = await api<{ automations: AutomationInfo[] }>("/api/automations");
      if (automations.length === 0) console.log(t("no_automations"));
      for (const info of automations) console.log(formatAutomationLine(info));
      break;
    }
    case "show": {
      const id = rest[0];
      if (!id) throw new Error(t("show_needs_id"));
      const info = await findAutomation(id);
      console.log(JSON.stringify(info.definition, null, 2));
      for (const next of info.nextOccurrences) console.log(t("next_occurrence", { local: next.local, utc: next.utc }));
      if (info.definition.target.kind === "swarm") console.log(JSON.stringify(await api(`/api/automations/${encodeURIComponent(info.definition.id)}/template`), null, 2));
      const { history } = await api<{ history: AutomationHistoryEntry[] }>(`/api/automations/${encodeURIComponent(info.definition.id)}/history`);
      if (history.length === 0) {
        console.log(t("no_history"));
        break;
      }
      for (const h of history) console.log(formatHistoryLine(h));
      break;
    }
    case "enable":
    case "disable": {
      const id = rest[0];
      if (!id) throw new Error(t("sub_needs_id", { sub }));
      const info = await findAutomation(id);
      const stored = await api<{ id: string; enabled: boolean }>(`/api/automations/${encodeURIComponent(info.definition.id)}/enable`, {
        method: "POST",
        body: JSON.stringify({ enabled: sub === "enable", generation: info.definition.generation }),
      });
      console.log(`${stored.id} ${stored.enabled ? t("enabled_ok") : t("disabled_ok")}`);
      break;
    }
    case "run-now": {
      const id = rest[0];
      if (!id) throw new Error(t("run_now_needs_id"));
      const info = await findAutomation(id);
      const claim = await api<AutomationHistoryEntry>(`/api/automations/${encodeURIComponent(info.definition.id)}/run-now`, { method: "POST", body: JSON.stringify({ generation: info.definition.generation }) });
      console.log(`${claim.claimKey}  ${claim.state}${claim.reason ? ` (${claim.reason})` : ""}${claim.sessionId ? `  session ${claim.sessionId}` : ""}`);
      break;
    }
    case "resolve": {
      const [id, claimKey, flag, ...noteWords] = rest;
      if (!id || !claimKey || flag !== "--note" || noteWords.length === 0) throw new Error(t("resolve_needs"));
      const info = await findAutomation(id);
      const claim = await api<AutomationHistoryEntry>(`/api/automations/${encodeURIComponent(info.definition.id)}/resolve`, { method: "POST", body: JSON.stringify({ claimKey, note: noteWords.join(" ") }) });
      console.log(formatHistoryLine(claim));
      break;
    }
    case "preview": {
      if (!rest[0]) throw new Error(t("preview_needs_id"));
      const info = await findAutomation(rest[0]);
      for (const next of info.nextOccurrences) console.log(`${next.local} (${next.utc})`);
      break;
    }
    case "update": {
      const [id, definitionPath, promptPath] = rest;
      if (!id || !definitionPath) throw new Error(t("update_needs"));
      const info = await findAutomation(id);
      const jsonText = definitionPath === "-" ? readStdinJson() : readFileSync(definitionPath, "utf8");
      const promptText = promptPath ? readFileSync(promptPath, "utf8") : null;
      const definition = buildAutomationUpdate(jsonText, info.definition, promptText);
      const stored = await api<AutomationDefinition>(`/api/automations/${encodeURIComponent(info.definition.id)}`, { method: "PATCH", body: JSON.stringify({ definition, ...(promptText === null ? {} : { promptText }) }) });
      console.log(`${stored.id} generation ${stored.generation} ${stored.enabled ? t("on_word") : t("off_word")}`);
      break;
    }
    case "create": {
      const [definitionPath, promptPath] = rest;
      if (!definitionPath) throw new Error(t("create_needs"));
      const jsonText = definitionPath === "-" ? readStdinJson() : readFileSync(definitionPath, "utf8");
      const promptText = promptPath ? readFileSync(promptPath, "utf8") : null;
      const definition = buildAutomationDefinition(jsonText, promptText);
      const stored = await api<{ id: string; enabled: boolean; generation: number }>("/api/automations", {
        method: "POST",
        body: JSON.stringify({ definition, ...(promptText === null ? {} : { promptText }) }),
      });
      console.log(`${stored.id}  generation ${stored.generation}  ${stored.enabled ? t("on_word") : t("off_word")} ${t("activation_separate")}`);
      break;
    }
    default:
      throw new Error(t("unknown_automations_cmd", { sub: sub ?? t("missing") }));
  }
}

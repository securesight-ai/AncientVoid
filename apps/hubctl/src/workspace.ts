import type { WorkspaceServiceLogs, WorkspaceStatus } from "@ancientvoid/contracts";
import { api } from "./api.ts";
import { t, type HubctlMsgKey } from "./i18n/index.ts";

/**
 * EPIC-P29 T29.6: `hubctl workspace …` — Status, Logs, menschlicher Retry
 * und die fertige Preview-URL (Ticket eingebettet) für eine Session.
 */

// Katalog-Schlüssel (nicht Anzeige-Text) — t() läuft lazial, Tests pinnen die Sprache.
const PHASE: Record<string, HubctlMsgKey> = {
  preparing: "phase_preparing",
  ready: "phase_ready",
  failed: "phase_failed",
  needs_attention: "phase_needs_attention",
  approval_required: "phase_approval_required",
};

/** Rein, für Tests: der Status als Zeilen (Basis-/Manifest-Hash gekürzt). */
export function formatWorkspaceStatus(status: WorkspaceStatus): string[] {
  const lines = [
    t("ws_phase_line", { phase: PHASE[status.phase] ? t(PHASE[status.phase]!) : status.phase, basis: status.baseSha.slice(0, 8), manifest: status.manifestHash.slice(0, 8) }),
  ];
  if (status.failure) {
    const failure = status.failure;
    lines.push(
      `${t("ws_fehler_word")}: ${failure.kind}${typeof failure.exitCode === "number" ? ` (Exit ${failure.exitCode})` : ""} ${t("ws_in_step", { step: failure.step })}${failure.detail ? ` — ${failure.detail}` : ""}${failure.logBlobRef ? ` ${t("ws_log_word")} ${failure.logBlobRef}` : ""}`,
    );
  }
  if (status.services.length === 0) lines.push(t("services_none"));
  for (const service of status.services) {
    lines.push(`service ${service.id}: ${service.state}${service.port !== null ? ` port=${service.port}` : ""} (${t("ws_stand")} ${service.updatedAt})`);
    if (service.failure) lines.push(`  fehler: ${service.failure.kind} in „${service.failure.step}“${service.failure.detail ? ` — ${service.failure.detail}` : ""}`);
  }
  return lines;
}

function usage(): never {
  console.log(t("usage_workspace"));
  process.exit(1);
}

export async function runWorkspace(args: string[]): Promise<void> {
  const [sub, sessionId, serviceId] = args;
  if (!sessionId) usage();
  if (sub === "logs") {
    if (!serviceId) usage();
    const logs = await api<WorkspaceServiceLogs>(`/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/logs`);
    console.log(logs.tail === "" ? t("no_output_yet") : logs.tail);
    if (logs.truncated) console.log(t("ws_truncated"));
    return;
  }
  if (sub === "retry") {
    const ack = await api<{ ok: boolean; detail?: string }>(`/api/sessions/${sessionId}/workspace/retry`, { method: "POST", body: "{}" });
    console.log(ack.ok ? `ok: ${ack.detail ?? ""}`.trim() : t("ws_rejected", { x: ack.detail ?? "" }));
    if (!ack.ok) process.exitCode = 1;
    return;
  }
  if (sub === "preview") {
    if (!serviceId) usage();
    const ticket = await api<{ ticket: string; expiresAt: number }>(`/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/preview-ticket`, { method: "POST", body: "{}" });
    const base = process.env.ANCIENTVOID_URL ?? "http://127.0.0.1:7373";
    console.log(`${base}/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/proxy/?ticket=${encodeURIComponent(ticket.ticket)}`);
    console.log(t("valid_until", { x: new Date(ticket.expiresAt).toISOString() }));
    return;
  }
  // kein Sub-Kommando: Status (sessionId steht dann in sub)
  const status = await api<WorkspaceStatus>(`/api/sessions/${sub}/workspace`);
  for (const line of formatWorkspaceStatus(status)) console.log(line);
}

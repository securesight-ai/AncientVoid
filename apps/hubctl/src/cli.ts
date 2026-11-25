#!/usr/bin/env node
/**
 * hubctl — reference client for the AncientVoid hub.
 *
 *   ANCIENTVOID_URL=https://hub.tailnet.ts.net ANCIENTVOID_TOKEN=… hubctl sessions
 *   hubctl tail <sessionId> -f
 *   hubctl token issue "pixel-9"          (issues against local hub DB file)
 */
import { pathToFileURL } from "node:url";
import type { NormalizedEvent } from "@ancientvoid/contracts";
import { DEFAULT_SERVER, findOrphanedWorkers, pruneOrphanedWorkers } from "@ancientvoid/workers";
import { BASE, TOKEN, api } from "./api.ts";
import { setCliLang, t } from "./i18n/index.ts";

/** Exported for unit testing — building this by hand (vs. the URL API) is
 * exactly how BUG-0005 (ws:://host, an invalid URL) slipped in unnoticed. */
export function buildWsUrl(base: string, token: string, sessionId: string): string {
  const proto = base.startsWith("https") ? "wss" : "ws";
  const url = `${proto}:${base.replace(/^https?:/, "")}/api/events/${sessionId}/tail${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  return url;
}

/** Exported so additive /api/health fields stay printed (ADR-0010) instead
 * of being silently ignored by the reference client. */
export function formatHealth(h: {
  ok: boolean;
  status?: string;
  adapters: { id: string; version: string }[];
  checks?: { database?: { ok: boolean }; eventStore?: { ok: boolean } };
  sessions?: { live: number; total: number };
}): string[] {
  const lines = [`ok: ${h.ok}${h.status ? `  status=${h.status}` : ""}`];
  if (h.sessions) lines.push(`  sessions live=${h.sessions.live} total=${h.sessions.total}`);
  if (h.checks) {
    const db = h.checks.database?.ok ? "ok" : "fail";
    const store = h.checks.eventStore?.ok ? "ok" : "fail";
    lines.push(`  checks db=${db} store=${store}`);
  }
  for (const a of h.adapters) lines.push(`  adapter ${a.id}@${a.version}`);
  return lines;
}

function usage(): never {
  console.log(t("usage_cli"));
  process.exit(1);
}
 
interface SessionRow {
  id: string;
  adapter: string;
  project: string;
  status: string;
  createdAt: string;
  lastSeq: number;
  workspaceMode?: string;
}

function printSession(s: SessionRow): void {
  const short = s.id.slice(0, 8);
  console.log(`${short}  ${s.status.padEnd(18)} ${s.adapter.padEnd(10)} ${(s.workspaceMode ?? "unknown").padEnd(8)} #${String(s.lastSeq).padEnd(6)} ${s.project}`);
}

async function* followWs(sessionId: string): AsyncGenerator<NormalizedEvent> {
  const socket = new WebSocket(buildWsUrl(BASE, TOKEN, sessionId));
  const queue: NormalizedEvent[] = [];
  let wake: (() => void) | null = null;
  socket.onmessage = (msg: MessageEvent) => {
    const data = JSON.parse(String(msg.data)) as { type: string; events?: NormalizedEvent[] };
    if (data.type === "events" && data.events) {
      queue.push(...data.events);
      wake?.();
    }
  };
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (e) => reject(new Error(`ws error: ${String(e)}`));
  });
  await opened;
  socket.send(JSON.stringify({ type: "hello", lastSeq: 0 }));
  while (true) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 30_000);
      });
      wake = null;
      continue;
    }
    const batch = queue.splice(0, queue.length);
    for (const ev of batch) yield ev;
  }
}

async function main(): Promise<void> {
  // EPIC-P61: --lang wird vor dem Dispatch aus argv entfernt — Unterbefehle sehen den Flag nicht.
  const raw = process.argv.slice(2);
  const argv: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--lang") { setCliLang(raw[i + 1]); i++; continue; }
    if (raw[i]?.startsWith("--lang=")) { setCliLang(raw[i]!.slice("--lang=".length)); continue; }
    argv.push(raw[i]!);
  }
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "activity": {
      const { activityCommand } = await import("./activity.ts");
      await activityCommand(args);
      break;
    }
    case "health": {
      const h = await api<{
        ok: boolean;
        status?: string;
        adapters: { id: string; version: string }[];
        checks?: { database?: { ok: boolean }; eventStore?: { ok: boolean } };
        sessions?: { live: number; total: number };
      }>("/api/health");
      for (const line of formatHealth(h)) console.log(line);
      break;
    }
    case "adapters": {
      const list = await api<{ id: string; version: string; capabilities: Record<string, boolean> }[]>(
        "/api/adapters",
      );
      for (const a of list) {
        const caps = Object.entries(a.capabilities)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(",");
        console.log(`${a.id}@${a.version}  [${caps}]`);
      }
      break;
    }
    case "sessions": {
      const sessions = await api<SessionRow[]>("/api/sessions");
      if (sessions.length === 0) console.log(t("no_sessions"));
      for (const s of sessions) printSession(s);
      break;
    }
    case "discover": {
      const page = await api<{
        items: { hubSessionId: string | null; adapter: string; status: string; nativeSessionId: string | null; unsupportedResume: boolean; fork: boolean; parentSessionId: string | null }[];
      }>("/api/discovery?limit=50");
      if (page.items.length === 0) console.log(t("no_sessions"));
      for (const item of page.items) {
        const id = item.hubSessionId ?? item.nativeSessionId ?? "?";
        const flags = [
          item.unsupportedResume ? "unsupported-resume" : "",
          item.fork ? "fork" : "",
          item.parentSessionId ? `parent=${item.parentSessionId}` : "",
        ].filter(Boolean).join(",");
        console.log(`${id}  ${item.status.padEnd(18)} ${item.adapter}${flags ? `  [${flags}]` : ""}`);
      }
      break;
    }
    case "inventory": {
      const page = await api<{ items: { id: string; version: string | null; discovery: string; resume: string }[] }>("/api/inventory");
      for (const item of page.items) {
        console.log(`${item.id.padEnd(10)} ${(item.version ?? "absent").padEnd(16)} discovery=${item.discovery} resume=${item.resume}`);
      }
      break;
    }
    case "show": {
      const id = args[0] ?? usage();
      const s = await api<SessionRow>(`/api/sessions/${id}`);
      console.log(JSON.stringify(s, null, 2));
      // ADR-0057: Arbeitsort samt Drift gegen die Start-Baseline (read-only).
      try {
        const place = await api<{ mode: string; path: string; drift: { headMoved: boolean; branchChanged: boolean } | null }>(`/api/sessions/${id}/workplace`);
        const drift = place.drift ? (place.drift.headMoved || place.drift.branchChanged ? t("drift_yes") : t("drift_no")) : "";
        console.log(`workplace: ${place.mode} ${place.path}${drift}`);
      } catch {
        // ältere Hubs kennen die Route nicht
      }
      // ADR-0036 (EPIC-P17 T17.3): the adapter's declared external
      // continuation command — display-only, placeholders stay visible.
      try {
        const adapters = await api<{ id: string; capabilities?: { resume?: { argv: string[] } } }[]>("/api/adapters");
        const resume = adapters.find((a) => a.id === s.adapter)?.capabilities?.resume;
        if (resume) {
          const cmd = resume.argv
            .map((part) => part.replaceAll("{sessionId}", "<session-id>").replaceAll("{token}", "<resume-token>"))
            .join(" ");
          console.log(`resume: ${cmd}`);
        }
      } catch {
        // a hub without the adapters route still gets its session printed
      }
      break;
    }
    case "events": {
      const id = args[0] ?? usage();
      const after = args[1] ?? "0";
      const events = await api<NormalizedEvent[]>(`/api/sessions/${id}/events?afterSeq=${after}`);
      for (const e of events) printEvent(e);
      break;
    }
    case "tail": {
      const id = args[0] ?? usage();
      const follow = args.includes("-f");
      if (follow) {
        for await (const ev of followWs(id)) printEvent(ev);
      } else {
        const events = await api<NormalizedEvent[]>(`/api/sessions/${id}/events`);
        for (const e of events) printEvent(e);
      }
      break;
    }
    case "token": {
      const sub = args[0] ?? usage();
      const dbIdx = args.indexOf("--db");
      const dbPath = dbIdx >= 0 ? (args[dbIdx + 1] ?? "data/hub.db") : "data/hub.db";
      if (sub === "issue") {
        // BUG-0108: same bar as the API (z.string().min(1)) — an empty label
        // here minted tokens no policy class could attribute. (revoke keeps ""
        // working, so existing empty-label tokens can still be cleaned up.)
        const name = args[1] || usage();
        // T7.4: an agent token (e.g. for the MCP gateway) may read and
        // request, never act on its own — every write waits for a human.
        // ADR-0048: a status display reads and decides `write` approvals only.
        const label = args.includes("--agent") && !name.startsWith("agent:") ? `agent:${name}` : args.includes("--display") && !name.startsWith("display:") ? `display:${name}` : name;
        // ADR-0066: nur ein Display kann Optionsfragen beantworten dürfen — Standard aus.
        const answerQuestions = args.includes("--answer-questions");
        if (answerQuestions && !label.startsWith("display:")) usage();
        const { TokenService, HubDatabase } = await import("@ancientvoid/core");
        const { DISPLAY_ANSWER_CAPABILITY } = await import("@ancientvoid/contracts");
        const tokens = new TokenService(new HubDatabase(dbPath));
        const issued = tokens.issue(label, answerQuestions ? [DISPLAY_ANSWER_CAPABILITY] : []);
        console.log(`token for "${label}"${answerQuestions ? t("aq_note") : ""} (shown once):\n  ${issued.token}`);
      } else if (sub === "list") {
        const { TokenService, HubDatabase } = await import("@ancientvoid/core");
        const tokens = new TokenService(new HubDatabase(dbPath));
        for (const t of tokens.list()) console.log(`${t.label}  created=${t.createdAt} lastUsed=${t.lastUsedAt ?? "never"}${t.capabilities.length > 0 ? ` capabilities=${t.capabilities.join(",")}` : ""}`);
      } else if (sub === "revoke") {
        const label = args[1] ?? usage();
        const { TokenService, HubDatabase } = await import("@ancientvoid/core");
        const tokens = new TokenService(new HubDatabase(dbPath));
        console.log(`revoked: ${tokens.revoke(label)}`);
      } else {
        usage();
      }
      break;
    }
    case "fleet": {
      // EPIC-P6 T6.2: pairing from a server shell, no browser needed.
      const sub = args[0] ?? usage();
      const dbIdx = args.indexOf("--db");
      const dbPath = dbIdx >= 0 ? (args[dbIdx + 1] ?? "data/hub.db") : "data/hub.db";
      const { TokenService, HubDatabase, FleetStore } = await import("@ancientvoid/core");
      const db = new HubDatabase(dbPath);
      const fleet = new FleetStore(db, new TokenService(db));
      if (sub === "invite") {
        const invite = fleet.createInvite();
        console.log(`pairing code (valid until ${invite.expiresAt}, one use):\n  ${invite.code}`);
      } else if (sub === "peers") {
        for (const p of fleet.peers()) console.log(`${p.hostId}  ${p.url}  paired=${p.pairedAt}`);
      } else {
        usage();
      }
      break;
    }
    case "scan": {
      const { scanCommand } = await import("./scan.ts");
      await scanCommand(args);
      break;
    }
    case "backup": {
      const sub = args[0] ?? usage();
      const option = (name: string): string => {
        const index = args.indexOf(name);
        if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--")) usage();
        return args[index + 1]!;
      };
      const { createBackup, pruneBackups, restoreBackup } = await import("./backup.ts");
      if (sub === "create") {
        const configFile = option("--config");
        const outputFile = option("--out");
        const keyFile = option("--key-file");
        const { loadConfig } = await import("@ancientvoid/core");
        const { config } = await loadConfig(configFile);
        await createBackup({ dataDir: config.dataDir, configFile, outputFile, keyFile });
        console.log(t("backup_created", { file: outputFile }));
      } else if (sub === "restore") {
        const archiveFile = option("--archive");
        const targetDir = option("--data-dir");
        const configOut = option("--config-out");
        const keyFile = option("--key-file");
        await restoreBackup({ archiveFile, targetDir, configOut, keyFile });
        console.log(t("restore_checked", { a: targetDir, b: configOut }));
      } else if (sub === "prune") {
        const directory = option("--dir");
        const keep = Number(option("--keep"));
        const apply = args.includes("--apply");
        const removed = await pruneBackups({ directory, keep, ...(apply ? { apply: true } : {}) });
        if (removed.length === 0) console.log(t("bt_keine_entfernen"));
        else for (const path of removed) console.log(t("prune_removed", { verb: apply ? t("verb_removed") : t("verb_would_remove"), path }));
      } else {
        usage();
      }
      break;
    }
    case "worktrees": {
      const { runWorktrees } = await import("./worktrees.ts");
      await runWorktrees(args);
      break;
    }
    case "workspace": {
      const { runWorkspace } = await import("./workspace.ts");
      await runWorkspace(args);
      break;
    }
    case "main-sync": {
      const { runMainSync } = await import("./main-sync.ts");
      await runMainSync(args);
      break;
    }
    case "browser": {
      // EPIC-P39: nur lesen — Bedienen und Testen sind Menschen-Aktionen der PWA (Policy, ADR-0059).
      if (args[0] === "tests") {
        const id = args[1] ?? usage();
        const { runs } = await api<{ runs: { id: string; name: string; state: string; viewport: string; startedAt: string; note: string | null }[] }>(`/api/sessions/${id}/browser/tests`);
        if (runs.length === 0) console.log(t("no_test_runs"));
        for (const r of runs) console.log(`${r.id.slice(0, 8)} ${r.state.padEnd(9)} ${r.viewport.padEnd(8)} ${r.startedAt} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
        break;
      }
      const id = args[0] ?? usage();
      const st = await api<{ state: string; url: string | null; viewport: string; allowedOrigins: string[]; unavailableReason: string | null; log: unknown[] }>(`/api/sessions/${id}/browser`);
      console.log(`browser: ${st.state}${st.unavailableReason ? ` (${st.unavailableReason})` : ""} url=${st.url ?? "-"} viewport=${st.viewport} console=${st.log.length}`);
      console.log(t("targets_line", { list: st.allowedOrigins.join(", ") || t("no_targets") }));
      break;
    }
    case "devices": {
      // EPIC-P42: nur lesen — Start/Steuerung/Tests sind Menschen-Aktionen der PWA (Policy, ADR-0067).
      if (args[0] === "tests") {
        const serial = args[1] ?? usage();
        const { runs } = await api<{ runs: { id: string; name: string; state: string; startedAt: string; note: string | null; env: { apiVersion: string | null; avdName: string | null } }[] }>(`/api/devices/tests?serial=${encodeURIComponent(serial)}`);
        if (runs.length === 0) console.log(t("no_test_runs"));
        for (const r of runs) console.log(`${r.id.slice(0, 8)} ${r.state.padEnd(9)} ${r.startedAt} ${r.name} · API ${r.env.apiVersion ?? "?"} · ${r.env.avdName ?? "?"}${r.note ? ` — ${r.note}` : ""}`);
        break;
      }
      const st = await api<{ capabilities: { ready: boolean; sdkRoot: string | null; reasons: string[] }; devices: { serial: string; state: string; rawState: string; owned: boolean; physical: boolean; foreignEmulator: boolean; instance: { avdName: string; state: string } | null }[]; avds: { name: string; allowed: boolean }[]; leases: { serial: string; owner: string; generation: number }[] }>("/api/devices");
      const caps = st.capabilities;
      console.log(`sdk: ${caps.sdkRoot ?? "-"}${caps.ready ? t("dev_ready") : t("dev_not_ready")}`);
      for (const r of caps.reasons) console.log(`  ! ${r}`);
      console.log(`avds: ${st.avds.map((a) => (a.allowed ? a.name : `${a.name} ${t("blocked")}`)).join(", ") || t("none")}`);
      for (const d of st.devices) {
        const who = d.instance ? `av-eigen ${d.instance.avdName} (${d.instance.state})` : d.physical ? t("phys_no_control") : d.foreignEmulator ? t("foreign_emu_no_control") : d.state;
        console.log(`${d.serial.padEnd(16)} ${who}`);
      }
      if (st.devices.length === 0) console.log(t("devices_none"));
      for (const l of st.leases) console.log(t("lease_line", { serial: l.serial, owner: l.owner, gen: l.generation }));
      break;
    }
    case "automations": {
      // EPIC-P41 T41.5: Liste/Editor/Run-now/Disable/Verlauf über die Hub-API (ADR-0064).
      const { runAutomationsCommand } = await import("./automations.ts");
      await runAutomationsCommand(args);
      break;
    }
    case "workers": {
      // BUG-0034: local, not a hub route — orphans are recognized on the
      // machine the tmux servers live on.
      const sub = args[0];
      if (sub !== "list" && sub !== "prune") {
        console.log(t("workers_usage_list"));
        console.log(t("workers_usage_prune"));
        break;
      }
      const found = sub === "prune" ? await pruneOrphanedWorkers() : await findOrphanedWorkers();
      if (found.killServers.length === 0 && found.killSessions.length === 0) {
        console.log("keine verwaisten ancientvoid-Worker");
        break;
      }
      for (const server of found.killServers) console.log(`${t(sub === "prune" ? "removed_server" : "orphan_server")}: ${server}`);
      for (const s of found.killSessions) console.log(`${t(sub === "prune" ? "removed_session" : "orphan_session")}: ${s.name} (${s.server === DEFAULT_SERVER ? t("default_server") : s.server})`);
      break;
    }
    default:
      usage();
  }
}

function printEvent(e: NormalizedEvent): void {
  const time = e.ts.slice(11, 19);
  const blob = e.blobRef ? " ⛁blob" : "";
  console.log(`${time} #${String(e.seq).padEnd(4)} ${e.type.padEnd(11)} ${e.summary.slice(0, 90)}${blob}`);
}

// Only run when executed directly (`node cli.ts ...` / the `hubctl` bin) —
// not when imported as a module (e.g. cli.test.ts importing buildWsUrl).
// Found while adding that very test: without this guard, importing this
// file for its exports ran the full CLI as a side effect and called
// process.exit(1) via usage(), polluting the test run.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("hubctl:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

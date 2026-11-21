import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { AiMetricsReport, StatisticsDistribution, StatisticsReport, TurnStatistics, SessionStatistics, SessionAnomaly } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { formatMetricAge, formatMetricValue } from "../../shared/metrics.ts";
import { Button, Card, EmptyState, Segmented, Select } from "../../shared/ui/index.ts";

/**
 * EPIC-P56 T56.3/T56.4 + EPIC-P66: die eine Metrik-Zentrale — konsolidierte
 * Kennzahlen aus dem Rollup-Cache (ADR-0079) plus System- und KI-Server-
 * Sektionen aus dem unveränderten Aimetrics-Report (EPIC-P59, keine zweite
 * Wahrheit). Beschreibend, kein Modell-Ranking. Jede Verteilung zeigt
 * p50/p90/p95 + n; Klein-n gekennzeichnet, Fehlendes bleibt sichtbar (nie 0).
 * Sektionen klappen auf/zu, der Zustand und der Schnitt überleben Reloads
 * (`ancientvoid.statistik.v1`, fail-safe).
 */

type Period = "all" | "7d" | "30d";

const STORAGE_KEY = "ancientvoid.statistik.v1";
/** EPIC-P66 Premortem 2: nur diese Sektionen sind standardmäßig offen. */
const DEFAULT_OPEN: readonly string[] = ["schnitt", "sessions"];

export interface StatistikState {
  collapsed: Record<string, boolean>;
  filter: { period: Period; project: string; host: string; harness: string };
}

const DEFAULT_STATE: StatistikState = { collapsed: {}, filter: { period: "all", project: "", host: "", harness: "" } };

/** Fail-safe: defektes/unbekanntes JSON fällt auf Defaults zurück, nie auf einen Crash (K10). */
export function parseStatistikState(raw: string | null): StatistikState {
  if (raw === null) return { collapsed: {}, filter: DEFAULT_STATE.filter };
  try {
    const parsed = JSON.parse(raw) as { collapsed?: unknown; filter?: { period?: unknown; project?: unknown; host?: unknown; harness?: unknown } };
    const collapsed: Record<string, boolean> = {};
    if (parsed.collapsed !== null && typeof parsed.collapsed === "object") {
      for (const [id, value] of Object.entries(parsed.collapsed as Record<string, unknown>)) {
        if (typeof value === "boolean") collapsed[id] = value;
      }
    }
    const f = parsed.filter ?? {};
    const period = f.period === "7d" || f.period === "30d" ? f.period : "all";
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return { collapsed, filter: { period, project: str(f.project), host: str(f.host), harness: str(f.harness) } };
  } catch {
    return { collapsed: {}, filter: DEFAULT_STATE.filter };
  }
}

function readState(): StatistikState {
  if (typeof localStorage === "undefined") return { collapsed: {}, filter: DEFAULT_STATE.filter };
  return parseStatistikState(localStorage.getItem(STORAGE_KEY));
}

function writeState(state: StatistikState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // privater Modus/voller Speicher: Dauerstand ist Komfort, kein Pflichtteil (K10).
  }
}

function formatMs(ms: number | null): string {
  if (ms === null) return "unbekannt";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}:${String(sec).padStart(2, "0")} min`;
}

function formatCount(n: number): string {
  return n.toLocaleString("de-DE");
}

/** p50/p90/p95 mit n und fehlenden Werten — Klein-n immer dazuschreiben (AC-P56-3). */
function Distribution({ d, unit }: { d: StatisticsDistribution; unit: string }) {
  const parts = [
    `p50 ${d.p50 === null ? "—" : formatMs(d.p50)}`,
    `p90 ${d.p90 === null ? "—" : formatMs(d.p90)}`,
    `p95 ${d.p95 === null ? "—" : formatMs(d.p95)}`,
  ].join(" · ");
  return (
    <span class="stat-dist">
      {unit === "ms" ? parts : `${d.p50 === null ? "—" : formatCount(d.p50)} (p50)`}
      <small>
        {" "}n {formatCount(d.n)}
        {d.missing > 0 ? `, ${formatCount(d.missing)} fehlend` : ""}
        {d.smallSample ? ", wenige Daten" : ""}
      </small>
    </span>
  );
}

function ratio(part: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((part / total) * 100)} %`;
}

const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "7d", label: "Woche" },
  { value: "30d", label: "Monat" },
];

function sinceOf(period: Period): string | undefined {
  if (period === "all") return undefined;
  const days = period === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** EPIC-P66 T66.1: eine klappbare Sektion — Kopf-Button mit aria-expanded, Inhalt nur offen im DOM. */
function Section({ id, title, note, collapsed, onToggle, children }: { id: string; title: string; note?: string; collapsed: boolean; onToggle: () => void; children: ComponentChildren }) {
  return (
    <Card aria-label={`Statistik ${title}`} role="region">
      <button type="button" class="stat-section-head" aria-expanded={!collapsed} aria-controls={`stat-sec-${id}`} onClick={onToggle}>
        <strong>{title}</strong>
        {note !== undefined && <small class="stat-section-note">{note}</small>}
        <span class="stat-chevron" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && <div id={`stat-sec-${id}`}>{children}</div>}
    </Card>
  );
}

export function StatisticsPage() {
  const initial = useMemo(readState, []);
  const [period, setPeriod] = useState<Period>(initial.filter.period);
  const [project, setProject] = useState(initial.filter.project);
  const [host, setHost] = useState(initial.filter.host);
  const [harness, setHarness] = useState(initial.filter.harness);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(initial.collapsed);
  const [report, setReport] = useState<StatisticsReport | null>(null);
  const [ai, setAi] = useState<AiMetricsReport | null>(null);
  const [error, setError] = useState("");

  const since = useMemo(() => sinceOf(period), [period]);

  // Zustand persistieren (T66.1/T66.3): ein versionierter Schlüssel.
  useEffect(() => {
    writeState({ collapsed, filter: { period, project, host, harness } });
  }, [collapsed, period, project, host, harness]);

  useEffect(() => {
    let alive = true;
    setReport(null);
    hubApi
      .statistics({
        ...(project ? { project } : {}),
        ...(host ? { host } : {}),
        ...(harness ? { harness } : {}),
        ...(since ? { since } : {}),
      })
      .then(r => {
        if (alive) {
          setReport(r);
          setError("");
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : "Statistik nicht erreichbar");
      });
    return () => {
      alive = false;
    };
  }, [project, host, harness, since]);

  // T66.2: Aimetrics unverändert einbetten — Poll im Report-Intervall.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await hubApi.aimetrics();
        if (!alive) return;
        setAi(res);
        timer = setTimeout(poll, Math.max(2, res.intervalSec) * 1000);
      } catch {
        if (!alive) return;
        timer = setTimeout(poll, 10_000);
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const toggle = (id: string) => setCollapsed(c => ({ ...c, [id]: !(c[id] ?? !DEFAULT_OPEN.includes(id)) }));
  const sectionIds = ["schnitt", "system", "kiserver", "sessions", "zuege", "gates", "tools", "teams", "anomalien", "vergleich"] as const;
  const setAll = (open: boolean) => {
    const next: Record<string, boolean> = {};
    for (const id of sectionIds) next[id] = !open;
    setCollapsed(next);
  };
  const allCollapsed = sectionIds.every(id => collapsed[id] ?? !DEFAULT_OPEN.includes(id));
  const resetFilter = () => {
    setPeriod("all");
    setProject("");
    setHost("");
    setHarness("");
  };

  if (error) return <EmptyState text={`Statistik nicht erreichbar — ${error}`} />;
  if (!report) return <EmptyState text={t("common.loading")} />;
  const filtered = project !== "" || host !== "" || harness !== "" || period !== "all";
  const host2 = ai?.sources.find(s => s.kind === "hub-host") ?? null;
  const servers = ai === null ? null : ai.sources.filter(s => s.kind === "model-server");

  return (
    <div class="status-page" aria-label={t("common.statistics")}>
      <div class="stat-bar">
        <Button variant="subtle" onClick={() => setAll(!allCollapsed)}>
          {allCollapsed ? "alle auf" : "alle zu"}
        </Button>
        <Button variant="subtle" onClick={resetFilter} disabled={!filtered}>
          {t("statistics.reset_cut")}
        </Button>
      </div>

      <Section id="schnitt" title={t("statistics.cut")} note="Zeitraum · Projekt · Host · Harness" collapsed={collapsed.schnitt ?? false} onToggle={() => toggle("schnitt")}>
        <Segmented label={t("statistics.period")} value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
        <div class="stat-filters">
          <Select
            label={t("newsession.project")}
            value={project}
            onChange={setProject}
            disabled={report.slices.projects.length === 0}
            options={[{ value: "", label: "alle Projekte" }, ...report.slices.projects.map(p => ({ value: p, label: p.split("/").filter(Boolean).pop() ?? p }))]}
          />
          <Select
            label={t("common.host")}
            value={host}
            onChange={setHost}
            disabled={report.slices.hosts.length === 0}
            options={[{ value: "", label: "alle Hosts" }, ...report.slices.hosts.map(h => ({ value: h, label: h }))]}
          />
          <Select
            label={t("status.harness")}
            value={harness}
            onChange={setHarness}
            disabled={report.slices.harnesses.length === 0}
            options={[{ value: "", label: "alle Harness" }, ...report.slices.harnesses.map(h => ({ value: h, label: h }))]}
          />
        </div>
        <p>
          {t("statistics.rollup")} {report.updatedAt === null ? "noch kein Lauf" : new Date(report.updatedAt).toLocaleString("de-DE")} {t("statistics.numbers_describe")}
        </p>
        <Button variant="subtle" onClick={() => exportCsv(report)}>
          {t("statistics.download_csv")}
        </Button>
      </Section>

      <Section id="system" title={t("statistics.system_hub")} note="unabhängig vom Schnitt" collapsed={collapsed.system ?? true} onToggle={() => toggle("system")}>
        {ai === null ? (
          <p class="stat-note">{t("statistics.source_unreachable")}</p>
        ) : host2 === null ? (
          <p class="stat-note">{t("statistics.host_probe")}</p>
        ) : (
          <MetricsTable source={host2} />
        )}
      </Section>

      <Section id="kiserver" title={t("statistics.ai_servers")} note="unabhängig vom Schnitt" collapsed={collapsed.kiserver ?? true} onToggle={() => toggle("kiserver")}>
        {ai === null ? (
          <p class="stat-note">{t("statistics.source_unreachable")}</p>
        ) : servers !== null && servers.length === 0 ? (
          <p class="stat-note">{t("statistics.no_sources")}</p>
        ) : (
          servers?.map(s => <MetricsTable key={s.id} source={s} />)
        )}
      </Section>

      {report.sessions.length === 0 && report.team === null ? (
        <EmptyState text={filtered ? "Keine Session in diesem Schnitt — der Schnitt ist echt leer, nicht kaputt." : "Noch keine Session ausgewertet — der Rollup läuft mit dem ersten Abruf."} />
      ) : (
        <>
          <Section id="sessions" title={t("common.sessions_cap")} note="je Adapter und Modell" collapsed={collapsed.sessions ?? false} onToggle={() => toggle("sessions")}>
            <SessionTable sessions={report.sessions} />
          </Section>
          <Section id="zuege" title={t("statistics.turns_tokens")} note="je Adapter und Modell" collapsed={collapsed.zuege ?? true} onToggle={() => toggle("zuege")}>
            <TurnTable turns={report.turns} />
            <p class="stat-note">{t("statistics.cloud_models")}</p>
          </Section>
          <Section id="gates" title={t("common.approvals")} note="Wartezeiten" collapsed={collapsed.gates ?? true} onToggle={() => toggle("gates")}>
            <GateTable report={report} />
          </Section>
          <Section id="tools" title={t("statistics.tools")} note="Aufrufe und Fehlerquoten" collapsed={collapsed.tools ?? true} onToggle={() => toggle("tools")}>
            <ToolTable report={report} />
          </Section>
          <Section id="teams" title={t("statistics.teams")} note="Projekt-/Zeitraum-Schnitt" collapsed={collapsed.teams ?? true} onToggle={() => toggle("teams")}>
            <TeamTable report={report} filtered={filtered} />
          </Section>
          <Section id="anomalien" title={t("statistics.anomalies")} note="über Gruppen-p95" collapsed={collapsed.anomalien ?? true} onToggle={() => toggle("anomalien")}>
            <AnomalyTable anomalies={report.anomalies} />
          </Section>
          <Section id="vergleich" title={t("statistics.period_ab")} note="gleicher Schnitt" collapsed={collapsed.vergleich ?? true} onToggle={() => toggle("vergleich")}>
            <CompareBody report={report} project={project} host={host} harness={harness} periodA={period} />
          </Section>
        </>
      )}
    </div>
  );
}

function MetricsTable({ source }: { source: AiMetricsReport["sources"][number] }) {
  return (
    <div class="stat-metrics">
      <p class="stat-metrics-head">
        <strong>{source.label}</strong>
        {!source.status.ok && <span role="status">{t("statistics.probe_failed")} {source.status.error}</span>}
      </p>
      <table>
        <thead>
          <tr><th>{t("statistics.field")}</th><th>{t("statistics.value")}</th><th>p50 / p95</th><th>{t("composer.source")}</th><th>{t("statistics.age")}</th></tr>
        </thead>
        <tbody>
          {source.fields.map(field => (
            <tr key={field.key}>
              <td>{field.label}</td>
              <td>{formatMetricValue(field.value, field.unit)}</td>
              <td>{field.window ? `${formatMetricValue(field.window.p50, field.unit)} / ${formatMetricValue(field.window.p95, field.unit)} (${field.window.samples})` : "—"}</td>
              <td>{field.source}</td>
              <td>{formatMetricAge(field.ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * T56.4 (AC-P56-5): CSV-Export exakt der angezeigten Daten — clientseitig
 * aus dem geladenen Report, als Download (kein Netzwerk, keine Cloud).
 */
function exportCsv(report: StatisticsReport): void {
  const line = (cells: (string | number | null)[]) => cells.map(c => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replaceAll("\"", "\"\"")}"` : String(c ?? ""))).join(",");
  const rows: string[] = [];
  rows.push(`# EPIC-P56 Statistik-Export · Schnitt: projekt=${report.filter.project ?? "-"} host=${report.filter.hostId ?? "-"} harness=${report.filter.harness ?? "-"} seit=${report.filter.since ?? "-"} bis=${report.filter.until ?? "-"}`);
  rows.push(`# Rollup-Stand: ${report.updatedAt ?? "noch kein Lauf"}`);
  rows.push("# Sessions je Adapter/Modell");
  rows.push(line(["adapter", "modell", "sessions", "offen", "fertig", "fehler", "unterbrochen", "gestoppt", "wall_p50_ms", "wall_p90_ms", "wall_p95_ms", "wall_n", "wall_fehlend", "aktiv_p50_ms", "aktiv_p95_ms", "zuge_p50", "zuge_p95"]));
  for (const s of report.sessions) {
    rows.push(line([s.adapter, s.model, s.sessions, s.openSessions, s.endReasons.completed, s.endReasons.error, s.endReasons.interrupted, s.endReasons.stopped, s.wallMs.p50, s.wallMs.p90, s.wallMs.p95, s.wallMs.n, s.wallMs.missing, s.activeMs.p50, s.activeMs.p95, s.turnsPerSession.p50, s.turnsPerSession.p95]));
  }
  rows.push("# Züge und Tokens je Adapter/Modell");
  rows.push(line(["adapter", "modell", "zuge", "fehlgeschlagen", "dauer_p50_ms", "dauer_p95_ms", "tokens_p50", "tokens_p95", "tokens_n", "tokens_fehlend", "geschaetzte_token_zuge"]));
  for (const tr of report.turns) {
    rows.push(line([tr.adapter, tr.model, tr.turns, tr.failedTurns, tr.durationMs.p50, tr.durationMs.p95, tr.tokens.p50, tr.tokens.p95, tr.tokens.n, tr.tokens.missing, tr.estimatedTokenTurns]));
  }
  rows.push("# Gates");
  if (report.gateWait) {
    const g = report.gateWait;
    rows.push(line(["gates", "beantwortet", "abgelaufen", "offen", "sofort_erlaubt", "warte_p50_ms", "warte_p95_ms", "warte_n", "warte_fehlend"]));
    rows.push(line([g.gates, g.answered, g.timedOut, g.open, g.autoApproved, g.waitMs.p50, g.waitMs.p95, g.waitMs.n, g.waitMs.missing]));
  }
  rows.push("# Tools");
  rows.push(line(["tool", "calls", "fehler", "ok", "iserror_unbelegt", "ohne_ergebnis", "fehlerquote"]));
  for (const tr of report.tools) {
    rows.push(line([tr.tool, tr.calls, tr.failed, tr.ok, tr.errorStatusUnknown, tr.unanswered, tr.failureRate]));
  }
  rows.push("# Recovery");
  rows.push(line(["p50_ms", "p90_ms", "p95_ms", "n", "fehlend"]));
  rows.push(line([report.recovery.p50, report.recovery.p90, report.recovery.p95, report.recovery.n, report.recovery.missing]));
  if (report.team) {
    const tm = report.team;
    rows.push("# Teams (nur Projekt-/Zeitraum-Schnitt)");
    rows.push(line(["teams", "aufgaben", "offen", "unbekannt", t("statistics.done"), "failed", "worker_ende_quote", "retry_rate"]));
    rows.push(line([tm.teams, tm.tasks, tm.open, tm.unknown, tm.done, tm.failed, tm.workerEndRate, tm.retryRate]));
  }
  rows.push("# Anomalien (über Gruppen-p95; Klein-n-Gruppen melden keine)");
  rows.push(line(["session", "adapter", "modell", "projekt", "wall_ms", "wall_p95", "zuge", "zuge_p95"]));
  for (const a of report.anomalies) {
    rows.push(line([a.sessionId, a.adapter, a.model, a.project, a.wallMs, a.wallP95, a.turns, a.turnsP95]));
  }
  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `statistik-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SessionTable({ sessions }: { sessions: SessionStatistics[] }) {
  if (sessions.length === 0) return <p class="stat-note">{t("statistics.no_sessions")}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{t("statistics.adapter_model")}</th>
          <th>{t("common.sessions_cap")}</th>
          <th>{t("statistics.end")}</th>
          <th>{t("statistics.wall_time")}</th>
          <th>{t("statistics.active")}</th>
          <th>{t("statistics.turns_session")}</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={`${s.adapter}\u0000${s.model ?? ""}`}>
            <td>
              {s.adapter}
              {s.model !== null ? ` · ${s.model}` : " · Modell unbelegt"}
            </td>
            <td>{formatCount(s.sessions)}{s.openSessions > 0 ? ` (${formatCount(s.openSessions)} offen)` : ""}</td>
            <td>
              {s.endReasons.completed > 0 && `fertig ${formatCount(s.endReasons.completed)}`}
              {s.endReasons.error > 0 && `, Fehler ${formatCount(s.endReasons.error)}`}
              {s.endReasons.interrupted > 0 && `, unterbrochen ${formatCount(s.endReasons.interrupted)}`}
              {s.endReasons.stopped > 0 && `, gestoppt ${formatCount(s.endReasons.stopped)}`}
              {s.openSessions > 0 && `, Grund offen ${formatCount(s.openSessions)}`}
            </td>
            <td><Distribution d={s.wallMs} unit="ms" /></td>
            <td><Distribution d={s.activeMs} unit="ms" /></td>
            <td><Distribution d={s.turnsPerSession} unit="ms" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TurnTable({ turns }: { turns: TurnStatistics[] }) {
  if (turns.length === 0) return <p class="stat-note">{t("statistics.no_turns")}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{t("statistics.adapter_model")}</th>
          <th>{t("statistics.turns")}</th>
          <th>{t("statistics.turn_duration")}</th>
          <th>{t("statistics.tokens_turn")}</th>
        </tr>
      </thead>
      <tbody>
        {turns.map(t => (
          <tr key={`${t.adapter}\u0000${t.model ?? ""}`}>
            <td>
              {t.adapter}
              {t.model !== null ? ` · ${t.model}` : " · Modell unbelegt"}
            </td>
            <td>
              {formatCount(t.turns)}
              {t.failedTurns > 0 ? `, ${formatCount(t.failedTurns)} fehlgeschlagen` : ""}
              {t.estimatedTokenTurns > 0 ? `, ${formatCount(t.estimatedTokenTurns)} geschätzt` : ""}
            </td>
            <td><Distribution d={t.durationMs} unit="ms" /></td>
            <td><Distribution d={t.tokens} unit="tokens" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GateTable({ report }: { report: StatisticsReport }) {
  const g = report.gateWait;
  if (g === null) return <p class="stat-note">{t("statistics.no_approvals")}</p>;
  return (
    <table>
      <tbody>
        <tr><th scope="row">{t("statistics.gates")}</th><td>{formatCount(g.gates)}</td></tr>
        <tr><th scope="row">{t("approvals.answer_verb")}</th><td>{formatCount(g.answered)} ({ratio(g.answered, g.gates)})</td></tr>
        <tr><th scope="row">{t("statistics.expired")}</th><td>{formatCount(g.timedOut)}</td></tr>
        <tr><th scope="row">{t("statistics.open_no_answer")}</th><td>{formatCount(g.open)}</td></tr>
        <tr><th scope="row">{t("statistics.immediately_allowed")}</th><td>{formatCount(g.autoApproved)}</td></tr>
        <tr><th scope="row">{t("statistics.wait_time")}</th><td><Distribution d={g.waitMs} unit="ms" /></td></tr>
      </tbody>
    </table>
  );
}

function ToolTable({ report }: { report: StatisticsReport }) {
  if (report.tools.length === 0) return <p class="stat-note">{t("statistics.no_tools")}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{t("statistics.tool")}</th>
          <th>{t("statistics.calls")}</th>
          <th>{t("statistics.errors_evidenced")}</th>
          <th>{t("statistics.without_result")}</th>
        </tr>
      </thead>
      <tbody>
        {report.tools.map((tl) => (
          <tr key={tl.tool ?? ""}>
            <td>{tl.tool ?? t("statistics.name_unbelegt")}</td>
            <td>{formatCount(tl.calls)}</td>
            <td>
              {tl.failureRate === null ? "—" : `${Math.round(tl.failureRate * 100)} %`}
              <small> ({formatCount(tl.failed + tl.ok)} {t("statistics.evidenced")} {formatCount(tl.errorStatusUnknown)} {t("statistics.unknown_paren")}</small>
            </td>
            <td>{formatCount(tl.unanswered)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamTable({ report, filtered }: { report: StatisticsReport; filtered: boolean }) {
  const tm = report.team;
  if (tm === null) return <p class="stat-note">{t("statistics.no_teams")}</p>;
  return (
    <div>
      <table>
        <tbody>
          <tr><th scope="row">{t("statistics.teams_tasks")}</th><td>{formatCount(tm.teams)} · {formatCount(tm.tasks)}</td></tr>
          <tr><th scope="row">{t("statistics.ends")}</th><td>{t("statistics.done")} {formatCount(tm.done)}{t("statistics.failed")} {formatCount(tm.failed)}{t("statistics.open")} {formatCount(tm.open)}{t("statistics.unknown")} {formatCount(tm.unknown)}</td></tr>
          <tr><th scope="row">{t("statistics.worker_end_rate")}</th><td>{tm.workerEndRate === null ? "—" : `${Math.round(tm.workerEndRate * 100)} %`}</td></tr>
          <tr><th scope="row">{t("statistics.retry_rate")}</th><td>{tm.retryRate === null ? "—" : `${Math.round(tm.retryRate * 100)} %`}</td></tr>
        </tbody>
      </table>
      <p class="stat-note">{t("statistics.done_note")}{filtered ? "" : " (hier ungeschnitten)"}{t("statistics.but_no_cut")}</p>
    </div>
  );
}

function AnomalyTable({ anomalies }: { anomalies: SessionAnomaly[] }) {
  if (anomalies.length === 0) return <p class="stat-note">{t("statistics.no_anomalies")}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{t("common.session_cap")}</th>
          <th>{t("statistics.adapter_model")}</th>
          <th>{t("statistics.wall_p95")}</th>
          <th>{t("statistics.turns_p95")}</th>
        </tr>
      </thead>
      <tbody>
        {anomalies.map(a => (
          <tr key={a.sessionId}>
            <td><code>{a.sessionId.slice(0, 12)}…</code></td>
            <td>
              {a.adapter}
              {a.model !== null ? ` · ${a.model}` : ""}
            </td>
            <td>{a.wallMs === null || a.wallP95 === null ? "—" : `${formatMs(a.wallMs)} > ${formatMs(a.wallP95)}`}</td>
            <td>{formatCount(a.turns)} {t("statistics.gt")} {formatCount(a.turnsP95)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * T56.4 A/B: derselbe Schnitt (Projekt/Host/Harness) in zwei Zeiträumen
 * nebeneinander — für Plugin-An/aus- oder Modellwechsel-Betrachtung (P55).
 */
function CompareBody({ report, project, host, harness, periodA }: { report: StatisticsReport; project: string; host: string; harness: string; periodA: Period }) {
  const [periodB, setPeriodB] = useState<Period>(periodA === "all" ? "7d" : "all");
  const [other, setOther] = useState<StatisticsReport | null>(null);
  useEffect(() => {
    let alive = true;
    setOther(null);
    hubApi
      .statistics({
        ...(project ? { project } : {}),
        ...(host ? { host } : {}),
        ...(harness ? { harness } : {}),
        ...(sinceOf(periodB) ? { since: sinceOf(periodB) } : {}),
      })
      .then(r => {
        if (alive) setOther(r);
      })
      .catch(() => {
        if (alive) setOther(null);
      });
    return () => {
      alive = false;
    };
  }, [project, host, harness, periodB]);

  const byKey = (rs: SessionStatistics[]) => new Map(rs.map(s => [`${s.adapter}\u0000${s.model ?? ""}`, s]));
  const a = byKey(report.sessions);
  const b = other ? byKey(other.sessions) : new Map<string, SessionStatistics>();
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  return (
    <div>
      <Segmented label={t("statistics.comparison_b")} value={periodB} options={PERIOD_OPTIONS} onChange={setPeriodB} />
      <table>
        <thead>
          <tr>
            <th>{t("statistics.adapter_model")}</th>
            <th>{t("statistics.sessions_ab")}</th>
            <th>{t("statistics.wall_p50")}</th>
            <th>{t("statistics.turns_session_p50")}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const sa = a.get(key);
            const sb = b.get(key);
            return (
              <tr key={key}>
                <td>
                  {sa?.adapter ?? sb?.adapter}
                  {(sa?.model ?? sb?.model) !== null ? ` · ${sa?.model ?? sb?.model}` : " · Modell unbelegt"}
                </td>
                <td>{formatCount(sa?.sessions ?? 0)} / {other ? formatCount(sb?.sessions ?? 0) : "…"}</td>
                <td>
                  {sa ? formatMs(sa.wallMs.p50) : "—"} / {sb ? formatMs(sb.wallMs.p50) : other ? "—" : "…"}
                </td>
                <td>
                  {sa && sa.turnsPerSession.p50 !== null ? Math.round(sa.turnsPerSession.p50).toLocaleString("de-DE") : "—"} /{" "}
                  {sb && sb.turnsPerSession.p50 !== null ? Math.round(sb.turnsPerSession.p50).toLocaleString("de-DE") : other ? "—" : "…"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="stat-note">{t("statistics.ab_explain")}</p>
    </div>
  );
}

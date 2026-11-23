import { useEffect, useState } from "preact/hooks";
import { COMPONENT_POWER_KEY, HOST_METRIC_RANGES, type HostMetricPoint, type HostMetricRange, type HostMetricsDetail, type HostMetricsHistory, type HostMetricsHost, type HostMetricsReport } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { fmtDateTime, fmtNumber, fmtTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { formatMetricAge } from "../../shared/metrics.ts";
import { AreaChart, Meter, ShareBars, Sparkline, TrendChip, type ChartTone } from "../../shared/ui/charts/index.tsx";
import { trend } from "../../shared/ui/charts/geometry.ts";
import { Button, Card, EmptyState, Field, Segmented } from "../../shared/ui/index.ts";
import { statTabHash } from "../../app/route.ts";
import { domainName, formatHostValue, formatWh, groupName, groupPoints, sumSeries, totalPower } from "./hosts-format.ts";

/**
 * EPIC-P81 T81.10 (ADR-0117): alle Werte aller Hosts. Der Aufbau folgt powermeter
 * (MIT): große Live-Zahl, Kurve, Anteile, Gerätezeilen, Detailseite.
 */
const POLL_MS = 5_000;
const HISTORY_POLL_MS = 60_000;
const DETAIL = /^#\/statistik\/hosts\/([^/?]+)/;

const tone = (domain: string): ChartTone => (domain.startsWith("cpu-package") ? "cpu" : domain.startsWith("gpu") ? "gpu" : "other");
const watts = (v: number) => formatHostValue(v, "W");
const when = (range: HostMetricRange) => (ts: number) => (range === "1h" || range === "24h" ? fmtTime(ts) : fmtDateTime(ts, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

/** Abfrage im Takt; bei Ausfall bleibt der letzte Stand stehen (K10). */
function usePoll<T>(load: () => Promise<T>, ms: number, deps: readonly unknown[]): { data: T | null; stale: boolean } {
  const [state, setState] = useState<{ data: T | null; stale: boolean }>({ data: null, stale: false });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ data: null, stale: false });
    const tick = async () => {
      try {
        const data = await load();
        if (alive) setState({ data, stale: false });
      } catch {
        if (alive) setState((s) => ({ ...s, stale: true }));
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, deps);
  return state;
}

function hostFromHash(): string | null {
  const hit = DETAIL.exec(location.hash)?.[1];
  return hit ? decodeURIComponent(hit) : null;
}

export function HostsPage() {
  const [selected, setSelected] = useState<string | null>(hostFromHash);
  useEffect(() => {
    const sync = () => {
      if (location.hash.startsWith("#/statistik/hosts")) setSelected(hostFromHash());
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  const go = (id: string | null) => {
    setSelected(id);
    location.hash = id === null ? statTabHash("hosts") : `${statTabHash("hosts")}/${encodeURIComponent(id)}`;
  };
  return selected === null ? <Overview onOpen={go} /> : <Detail key={selected} id={selected} onBack={() => go(null)} />;
}

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const [range, setRange] = useState<HostMetricRange>("24h");
  const { data: report, stale } = usePoll<HostMetricsReport>(() => hubApi.hostMetrics(), POLL_MS, []);
  const ids = report?.hosts.map((h) => h.id).join("\n") ?? "";
  const { data: histories } = usePoll<(HostMetricsHistory | null)[]>(
    () => Promise.all(ids === "" ? [] : ids.split("\n").map((id) => hubApi.hostMetricsHistory(id, range).catch(() => null))),
    HISTORY_POLL_MS,
    [ids, range],
  );
  if (!report) return <EmptyState text={stale ? t("hosts.empty") : t("hosts.loading")} />;
  if (report.hosts.length === 0) return <EmptyState text={t("hosts.empty")} />;
  const total = totalPower(report.hosts);
  const { series, partial } = sumSeries((histories ?? []).map((h) => (h?.points ?? []).map(([ts, avg]) => [ts, avg] as const)));
  const step = (histories?.find((h) => h !== null)?.stepSec ?? 60) * 1000;
  const delta = trend(sumSeries(report.hosts.filter((h) => h.status.ok).map((h) => h.spark)).complete, 300_000);
  const today = report.hosts.flatMap((h) => (h.today ? [h.today.wh] : []));
  const shares = report.hosts
    .filter((h) => h.status.ok)
    .flatMap((h) => (h.summary?.wattParts ?? []).map((p) => ({ key: `${h.id}:${p.domain}`, label: p.label, note: h.label, value: p.value, text: watts(p.value), tone: tone(p.domain) })))
    .sort((a, b) => b.value - a.value);
  return (
    <div class="status-page hosts">
      {stale && <p class="stat-note" role="status">{t("hosts.stale", { age: formatMetricAge(report.generatedAt) })}</p>}
      <Card aria-label={t("hosts.title")} class="hosts-hero">
        <Hero value={total.watts} delta={delta} />
        <p class="stat-note">{t("hosts.hint")}</p>
        {total.missing.length > 0 && <p class="stat-note">{t("hosts.missing", { list: total.missing.join(", ") })}</p>}
        {total.excluded.length > 0 && <p class="stat-note" role="status">{t("hosts.excluded", { list: total.excluded.join(", ") })}</p>}
        <RangePicker value={range} onChange={setRange} />
        <Series points={series} step={step} range={range} label={t("hosts.title")} format={watts} />
        {partial && <p class="stat-note">{t("hosts.partial")}</p>}
        {today.length > 0 && <p class="hosts-pair"><span>{t("hosts.today")}</span><strong>{formatWh(today.reduce((a, b) => a + b, 0))}</strong></p>}
      </Card>
      {shares.length > 0 && (
        <Card aria-label={t("hosts.shares")}>
          <strong>{t("hosts.shares")}</strong>
          <ShareBars label={t("hosts.shares")} rows={shares} />
        </Card>
      )}
      <div class="hosts-grid" role="list" aria-label={t("hosts.list")}>
        {report.hosts.map((h) => (
          <HostCard key={h.id} host={h} onOpen={() => onOpen(h.id)} />
        ))}
      </div>
    </div>
  );
}

function Hero({ value, delta }: { value: number | null; delta: number | null }) {
  return (
    <p class="hosts-hero-value">
      {value === null ? <strong class="hosts-none">{t("hosts.none")}</strong> : <><strong>{fmtNumber(value, { maximumFractionDigits: 0 })}</strong><span>W</span></>}
      {value !== null && delta !== null && <TrendChip delta={Math.round(delta)} text={watts(Math.round(Math.abs(delta)))} label={t("hosts.trend")} />}
    </p>
  );
}

function RangePicker({ value, onChange }: { value: HostMetricRange; onChange: (r: HostMetricRange) => void }) {
  return <Segmented label={t("hosts.range")} value={value} onChange={onChange} options={HOST_METRIC_RANGES.map((r) => ({ value: r, label: t(`hosts.range.${r}`) }))} />;
}

function Series({ points, step, range, label, format, rows }: { points: readonly (readonly [number, number])[]; step: number; range: HostMetricRange; label: string; format: (v: number) => string; rows?: HostMetricsHistory["points"] }) {
  if (points.length < 2) return <p class="stat-note">{t("hosts.noHistory")}</p>;
  const values = points.map((p) => p[1]);
  const peak = rows ? Math.max(...rows.map((r) => r[3])) : Math.max(...values);
  const low = rows ? Math.min(...rows.map((r) => r[2])) : Math.min(...values);
  const time = when(range);
  return (
    <>
      <p class="stat-note">{t("hosts.stats", { max: format(peak), avg: format(values.reduce((a, b) => a + b, 0) / values.length), min: format(low) })}</p>
      <AreaChart
        points={points}
        stepMs={step}
        label={t("hosts.history", { label })}
        format={format}
        formatTime={time}
        table={
          <details class="hosts-table">
            <summary>{t("hosts.table")}</summary>
            <table>
              <thead><tr><th>{t("hosts.time")}</th><th>{t("hosts.avg")}</th></tr></thead>
              <tbody>{[...points].reverse().slice(0, 120).map(([ts, v]) => <tr key={ts}><td>{time(ts)}</td><td>{format(v)}</td></tr>)}</tbody>
            </table>
          </details>
        }
      />
    </>
  );
}

function StatusLine({ host }: { host: HostMetricsHost }) {
  if (host.status.ok) return null;
  return (
    <p class="hosts-failed" role="status">
      <span aria-hidden="true">⚠</span> {t("hosts.failed", { error: host.status.error })}
      {host.ts && <> · {t("hosts.lastSeen", { age: formatMetricAge(host.ts) })}</>}
    </p>
  );
}

function Meters({ host }: { host: HostMetricsHost }) {
  const s = host.summary;
  if (!s) return null;
  const ram = s.memUsedBytes !== null && s.memTotalBytes ? (s.memUsedBytes / s.memTotalBytes) * 100 : null;
  const pct = (v: number | null) => formatHostValue(v, "%");
  return (
    <div class="hosts-meters">
      <Meter label={t("hosts.cpu")} percent={s.cpuPercent} text={pct(s.cpuPercent)} />
      <Meter label={t("hosts.ram")} percent={ram} text={ram === null ? pct(null) : `${formatHostValue(s.memUsedBytes, "bytes")} / ${formatHostValue(s.memTotalBytes, "bytes")}`} />
      <Meter label={t("hosts.gpu")} percent={s.gpuPercent} text={pct(s.gpuPercent)} />
      <Meter label={s.fullestDisk ? `${t("hosts.disk")} · ${s.fullestDisk.label}` : t("hosts.disk")} percent={s.fullestDisk?.value ?? null} text={pct(s.fullestDisk?.value ?? null)} />
      <p class="hosts-pair"><span>{t("hosts.hottest")}{s.hottest && ` · ${s.hottest.label}`}</span><strong>{formatHostValue(s.hottest?.value ?? null, "°C")}</strong></p>
    </div>
  );
}

function HostCard({ host, onOpen }: { host: HostMetricsHost; onOpen: () => void }) {
  return (
    <div role="listitem" class="hosts-card" data-ok={host.status.ok}>
      <button type="button" class="hosts-card-head" aria-label={t("hosts.open", { host: host.label })} onClick={onOpen}>
        <strong>{host.label}</strong>
        <span class="hosts-card-watts">{formatHostValue(host.summary?.watts ?? null, "W")}</span>
        <span aria-hidden="true">›</span>
      </button>
      <StatusLine host={host} />
      {host.status.ok && <Sparkline points={host.spark} />}
      <Meters host={host} />
      {host.today && <p class="hosts-pair"><span>{t("hosts.today")}</span><strong>{formatWh(host.today.wh)}</strong></p>}
    </div>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [range, setRange] = useState<HostMetricRange>("24h");
  const [metric, setMetric] = useState<HostMetricPoint | null>(null);
  const [query, setQuery] = useState("");
  const { data, stale } = usePoll<HostMetricsDetail>(() => hubApi.hostMetricsDetail(id), POLL_MS, [id]);
  // Ein Host ohne jede Watt-Quelle (NAS) zeigt statt einer leeren Leistungskurve seine erste Temperatur.
  const noPower = data !== null && data.host.summary !== null && data.host.summary.watts === null && data.host.summary.wattMissing.length === 0;
  const shown = metric ?? (noPower ? (data.sample?.points.find((p) => p.group === "temperature" && p.value !== null) ?? null) : null);
  const key = shown?.key ?? COMPONENT_POWER_KEY;
  const { data: history } = usePoll<HostMetricsHistory>(() => hubApi.hostMetricsHistory(id, range, key), HISTORY_POLL_MS, [id, range, key]);
  const back = <Button variant="subtle" onClick={onBack}>‹ {t("hosts.back")}</Button>;
  if (!data) return <div class="status-page hosts">{back}<EmptyState text={stale ? t("hosts.failed", { error: id }) : t("hosts.loading")} /></div>;
  const { host, sample } = data;
  const label = shown ? `${shown.device} ${shown.label}` : t("hosts.power");
  const format = (v: number) => formatHostValue(v, shown?.unit ?? "W");
  const days = history?.days.slice(-14) ?? [];
  const groups = groupPoints(sample?.points ?? [], query);
  return (
    <div class="status-page hosts">
      {back}
      {stale && <p class="stat-note" role="status">{t("hosts.stale", { age: formatMetricAge(host.ts) })}</p>}
      <Card aria-label={host.label} class="hosts-hero">
        <strong>{host.label}</strong>
        <StatusLine host={host} />
        <Hero value={host.summary?.watts ?? null} delta={trend(host.spark, 300_000)} />
        {(host.summary?.wattMissing.length ?? 0) > 0 && <p class="stat-note">{t("hosts.missing", { list: host.summary!.wattMissing.map(domainName).join(", ") })}</p>}
        <RangePicker value={range} onChange={setRange} />
        <p class="hosts-pair"><strong>{label}</strong>{metric && <Button variant="subtle" onClick={() => setMetric(null)}>{t("hosts.power")}</Button>}</p>
        <Series points={(history?.points ?? []).map(([ts, avg]) => [ts, avg] as const)} {...(history ? { rows: history.points } : {})} step={(history?.stepSec ?? 60) * 1000} range={range} label={label} format={format} />
      </Card>
      <Card><Meters host={host} /></Card>
      {days.length > 0 && (
        <Card aria-label={t("hosts.energy")}>
          <strong>{t("hosts.energy")}</strong>
          <ShareBars
            label={t("hosts.energy")}
            rows={[...days].reverse().map((d) => ({ key: d.day, label: d.day, value: d.wh, text: formatWh(d.wh), note: t("hosts.covered", { h: fmtNumber(d.coveredSec / 3600, { maximumFractionDigits: 1 }) }), tone: "cpu" as const }))}
          />
        </Card>
      )}
      {(sample?.errors.length ?? 0) > 0 && <p class="hosts-failed" role="status"><span aria-hidden="true">⚠</span> {t("hosts.sourceErrors", { list: sample!.errors.map((e) => `${e.source}: ${e.error}`).join(" · ") })}</p>}
      <Field label={t("hosts.search")} type="search" value={query} onInput={setQuery} />
      {groups.length === 0 && <p class="stat-note">{t("hosts.noHit")}</p>}
      {groups.map((g) => (
        <details key={g.group} class="hosts-group" open={query !== "" || ["power", "temperature", "gpu", "disk"].includes(g.group)}>
          <summary><strong>{groupName(g.group)}</strong> <small>{t("hosts.points", { n: g.points.length })}</small></summary>
          <ul>
            {g.points.map((p) => (
              <li key={p.key}>
                <button type="button" aria-pressed={p.key === shown?.key} onClick={() => setMetric(p)}>
                  <span>{p.device} · {p.label}</span>
                  <small>{p.reason ?? p.source}</small>
                  <strong>{formatHostValue(p.value, p.unit)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

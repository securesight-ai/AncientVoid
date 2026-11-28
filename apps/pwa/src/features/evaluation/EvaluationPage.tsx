import { useEffect, useState } from "preact/hooks";
import { evaluationTable } from "@ancientvoid/contracts";
import type { EvalLaunchList, EvalSeriesList, EvalSeriesSummary } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Button, Card, EmptyState, Select } from "../../shared/ui/index.ts";
import { t } from "../../shared/i18n/index.ts";
import { sessionHash } from "../../app/route.ts";

type Comparison = NonNullable<EvalSeriesSummary["comparison"]>;

function ComparisonResults({ comparison }: { comparison: Comparison }) {
  return (
    <section aria-label={t("evaluation.comparison")}>
      <h3>{t("evaluation.comparison")}</h3>
      <p>{t(`evaluation.kind.${comparison.kind}`)} · <code>{comparison.source}</code></p>
      <p>
        {t("evaluation.reference")} <code title={comparison.reference}>{comparison.reference.slice(0, 12)}</code>
        {" · "}
        {t("evaluation.candidate")} <code title={comparison.candidate}>{comparison.candidate.slice(0, 12)}</code>
      </p>
      <p class="dim">{t("evaluation.minimumEffect", { percent: Math.round(comparison.minimumEffect * 1_000) / 10 })}</p>
      {comparison.tasks.map((task) => (
        <details key={task.task} open={task.status === "regressed" || task.status === "insufficient"}>
          <summary>
            {task.task} · {t(`evaluation.status.${task.status}`)} · {t("evaluation.pairs", { n: task.pairs })}
          </summary>
          <p>{task.reason === "measured" ? t(`evaluation.next.${task.status}`) : t(`evaluation.reason.${task.reason}`)}</p>
          {task.checks.length > 0 && (
            <div class="stat-scroll">
              <table>
                <thead><tr>
                  <th scope="col">{t("evaluation.check")}</th>
                  <th scope="col">{t("evaluation.reference")}</th>
                  <th scope="col">{t("evaluation.candidate")}</th>
                  <th scope="col">{t("evaluation.evidence")}</th>
                </tr></thead>
                <tbody>{task.checks.map((check) => (
                  <tr key={check.id}>
                    <th scope="row">{t(`evaluation.check.${check.id}`)}</th>
                    <td>{check.reference}/{task.pairs}</td>
                    <td>{check.candidate}/{task.pairs}</td>
                    <td>{check.evidence.map((id, index) => (
                      <div key={id}><a href={sessionHash(id)}>{t("evaluation.runEvidence", { n: index + 1 })}</a></div>
                    ))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {task.effort && task.effort.length > 0 && (
            <details>
              <summary>{t("evaluation.effort")}</summary>
              <div class="stat-scroll">
                <table>
                  <thead><tr>
                    <th scope="col">{t("evaluation.effort")}</th>
                    <th scope="col">{t("evaluation.reference")}</th>
                    <th scope="col">{t("evaluation.candidate")}</th>
                    <th scope="col">{t("evaluation.pairedDifference")}</th>
                  </tr></thead>
                  <tbody>{task.effort.map(({ id, reference, candidate, pairedDifference }) => {
                    const format = (value: number) => Number(value.toFixed(id === "costUsd" ? 5 : 1));
                    return <tr key={id}>
                      <th scope="row">{t(`evaluation.effort.${id}`)}</th>
                      <td>{format(reference.median)}</td>
                      <td>{format(candidate.median)}</td>
                      <td>{format(pairedDifference.median)} ({format(pairedDifference.min)}…{format(pairedDifference.max)})</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </details>
          )}
        </details>
      ))}
    </section>
  );
}

export function EvaluationPage() {
  const [list, setList] = useState<EvalSeriesList | null>(null);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [repo, setRepo] = useState("");
  const [selectedSeries, setSelectedSeries] = useState("");
  const [summary, setSummary] = useState<EvalSeriesSummary | null>(null);
  const [listError, setListError] = useState(false);
  const [projectsError, setProjectsError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [worker, setWorker] = useState<EvalLaunchList | null>(null);
  const [workerError, setWorkerError] = useState(false);
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [launchError, setLaunchError] = useState(false);
  const isRunning = worker?.runs.some(({ state }) => state === "running") ?? false;

  useEffect(() => {
    let current = true;
    const refresh = async () => {
      const [launches, series] = await Promise.allSettled([
        hubApi.evaluationRuns(),
        isRunning ? hubApi.evaluationSeries() : Promise.resolve(null),
      ]);
      if (!current) return;
      if (series.status === "fulfilled" && series.value) setList(series.value);
      if (launches.status === "fulfilled") {
        setWorker(launches.value);
        setWorkerError(false);
      } else {
        setWorkerError(true);
      }
    };
    void refresh();
    const timer = isRunning ? window.setInterval(() => void refresh(), 4_000) : undefined;
    return () => { current = false; if (timer !== undefined) clearInterval(timer); };
  }, [isRunning]);

  useEffect(() => {
    let current = true;
    hubApi.evaluationSeries().then((value) => {
      if (!current) return;
      setList(value);
      setRepo(value.series.find((entry) => entry.repo)?.repo ?? "");
    }).catch(() => { if (current) setListError(true); });
    hubApi.projects().then(({ projects, warnings }) => {
      if (!current) return;
      setProjectNames(Object.fromEntries(projects.map(({ path, name }) => [path, name])));
      setProjectsError(warnings.length > 0);
    }).catch(() => { if (current) setProjectsError(true); });
    return () => { current = false; };
  }, []);

  const seriesInRepo = list?.series.filter((entry) => (entry.repo ?? "") === repo) ?? [];
  const series = seriesInRepo.some((entry) => entry.series === selectedSeries) ? selectedSeries : seriesInRepo.at(-1)?.series;
  const seriesRuns = seriesInRepo.find((entry) => entry.series === series)?.runs;
  useEffect(() => {
    if (!series) return;
    let current = true;
    hubApi.evaluationSummary(series, repo || undefined)
      .then((value) => { if (current) setSummary(value); })
      .catch(() => { if (current) setSummaryError(true); });
    return () => { current = false; };
  }, [series, repo, seriesRuns]);

  if (listError) return <EmptyState text={t("evaluation.error")} />;
  if (list === null) return <p role="status">{t("evaluation.loading")}</p>;
  const repos = [...new Set([
    ...Object.keys(projectNames),
    ...list.series.flatMap((entry) => entry.repo ? [entry.repo] : []),
    ...(worker?.presets.map(({ repo }) => repo) ?? []),
    ...(worker?.runs.map(({ repo }) => repo) ?? []),
  ])].sort();
  const presets = worker?.presets.filter((preset) => preset.repo === repo) ?? [];
  const preset = presets.some(({ id }) => id === draft) ? draft : presets[0]?.id;
  const repoRuns = worker?.runs.filter((run) => run.repo === repo).reverse() ?? [];
  const launch = async () => {
    if (!preset || !worker) return;
    setStarting(true);
    setLaunchError(false);
    try {
      const pending = await hubApi.startEvaluation(preset);
      setWorker({ presets: worker.presets, runs: [...worker.runs, pending] });
      setSelectedSeries(pending.series);
    } catch {
      setLaunchError(true);
    } finally {
      setStarting(false);
    }
  };
  const table = summary ? evaluationTable(summary) : null;
  return (
    <Card aria-label={t("evaluation.title")}>
      {repos.length > 0 && (
        <Select label={t("evaluation.repo")} value={repo} options={[
          { value: "", label: t("evaluation.legacy") },
          ...repos.map((path) => ({ value: path, label: projectNames[path] ? `${projectNames[path]} · ${path}` : path })),
        ]} onChange={(value) => {
          if (value === repo) return;
          setRepo(value);
          setSelectedSeries("");
          setLaunchError(false);
          setSummary(null);
          setSummaryError(false);
        }} />
      )}
      {projectsError && <p role="status">{t("evaluation.projectsError")}</p>}
      {workerError && <p role="status">{t("evaluation.launchListError")}</p>}
      {preset && (
        <div class="form-grid">
          <Select label={t("evaluation.preset")} value={preset}
            options={presets.map(({ id, label }) => ({ value: id, label }))} onChange={setDraft} disabled={starting || isRunning} />
          <Button onClick={() => void launch()} disabled={starting || isRunning}>{t("evaluation.start")}</Button>
          {launchError && <p role="alert">{t("evaluation.startError")}</p>}
        </div>
      )}
      {repoRuns.slice(0, 4).map((run) => (
        <p key={run.series} role="status">{run.series} · {t(`evaluation.launch.${run.state}`)}</p>
      ))}
      {series ? (
        <Select label={t("evaluation.series")} value={series}
          options={seriesInRepo.map((entry) => ({ value: entry.series, label: `${entry.series} · ${t("evaluation.runs", { n: entry.runs })}` }))}
          onChange={(value) => { if (value !== series) { setSelectedSeries(value); setSummary(null); setSummaryError(false); } }} />
      ) : <EmptyState text={t(repo ? "evaluation.repoEmpty" : "evaluation.empty")} />}
      {summaryError && <p role="alert">{t("evaluation.error")}</p>}
      {series && !summary && !summaryError && <p role="status">{t("evaluation.loading")}</p>}
      {summary && !summary.consistent && <p role="alert">{t("evaluation.inconsistent")}</p>}
      {summary?.comparison && <ComparisonResults comparison={summary.comparison} />}
      {table && (
        <div class="stat-scroll">
          <table data-testid="evaluation-table">
            <thead><tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
            <tbody>{table.rows.map((row) => <tr key={`${row[0]}/${row[1]}`}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

import { t } from "../../shared/i18n/index.ts";
import { sessionHash } from "../../app/route.ts";
import { remoteHost } from "../../shared/api.ts";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { addSource } from "../../shared/sources.ts";
import { Sheet } from "../../shared/ui/index.ts";
import {
  newInputId,
  type DraftMrPlan,
  type ForgeIssueSummary,
  type ForgeJobSummary,
  type ForgeMrSummary,
  type ForgeOperation,
  type ForgeOverview,
  type ForgePipelineSummary,
  type ForgeThread,
  type ForgeTraceView,
  type SessionRecord,
} from "../../shared/api.ts";

/**
 * EPIC-P37 / ADR-0056: GitLab im Session-Kontext. Lesen ist read-only;
 * Feedback und Draft-MR sind menschliche, bestätigte Aktionen. Fremdtexte
 * (Threads, Logs) sind zitierte Daten. Cache-Daten tragen ihren Zeitstempel
 * (K10/AC-P37-6), pending/skipped/canceled sind nie grün (AC-P37-2).
 */

const statusClass = (status: string): string =>
  status === "success" ? "fp-ok" : status === "failed" ? "fp-fail" : status === "running" ? "fp-run" : "fp-neutral";

const statusLabel = (status: string): string => {
  const map: Record<string, string> = {
    success: "erfolgreich",
    failed: "fehlgeschlagen",
    running: "läuft",
    pending: "wartet (Runner)",
    canceled: "abgebrochen",
    skipped: "übersprungen",
    manual: "manuell",
    created: "angelegt",
  };
  return map[status] ?? status;
};

const short = (sha: string | null): string => (sha ? sha.slice(0, 8) : "—");
const time = (iso: string | null): string => (iso ? new Date(iso).toLocaleString("de-DE") : "—");

export function ForgePanel({ session, onOpenSession }: { session: SessionRecord; onOpenSession: (id: string) => void }) {
  const api = useApi();
  const [overview, setOverview] = useState<ForgeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [jobsOf, setJobsOf] = useState<number | null>(null);
  const [jobs, setJobs] = useState<ForgeJobSummary[] | null>(null);
  const [threads, setThreads] = useState<ForgeThread[] | null>(null);
  const [threadsTruncated, setThreadsTruncated] = useState(false);
  const [trace, setTrace] = useState<ForgeTraceView | null>(null);
  const [issues, setIssues] = useState<ForgeIssueSummary[] | null>(null);
  const [finding, setFinding] = useState("");
  const [findingSource, setFindingSource] = useState<{ pipelineId?: number; jobId?: number; threadId?: string }>({});
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** EPIC-P43.5 T43.5-1: Quittung für die Composer-Übernahme (nicht der Sendeweg). */
  const [note, setNote] = useState<string | null>(null);
  const [operationId] = useState(() => newInputId());
  const [plan, setPlan] = useState<DraftMrPlan | null>(null);
  const [mrTitle, setMrTitle] = useState("");
  const [mrDescription, setMrDescription] = useState("");
  const [mrBusy, setMrBusy] = useState(false);
  const [mrResult, setMrResult] = useState<string | null>(null);
  const [operations, setOperations] = useState<ForgeOperation[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.forgeOverview(session.id);
      setOverview(res);
      setError(res.staleError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forge nicht erreichbar");
    }
  }, [api, session.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadJobs = async (pipelineId: number): Promise<void> => {
    if (jobsOf === pipelineId) {
      setJobsOf(null);
      setJobs(null);
      return;
    }
    setJobsOf(pipelineId);
    setJobs(null);
    try {
      const res = await api.forgeJobs(session.id, pipelineId);
      setJobs(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jobs nicht ladbar");
    }
  };

  const openTrace = async (job: ForgeJobSummary): Promise<void> => {
    setTrace(null);
    try {
      setTrace(await api.forgeTrace(session.id, job.id, jobsOf));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trace nicht ladbar");
    }
  };

  const link = async (): Promise<void> => {
    if (!linkUrl.trim()) return;
    try {
      await api.forgeLink(session.id, linkUrl.trim());
      setLinkUrl("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verknüpfen fehlgeschlagen");
    }
  };

  const unlink = async (): Promise<void> => {
    try {
      await api.forgeUnlink(session.id);
      setThreads(null);
      setJobs(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lösen fehlgeschlagen");
    }
  };

  const loadThreads = async (): Promise<void> => {
    setThreads(null);
    try {
      const res = await api.forgeThreads(session.id);
      setThreads(res.items);
      setThreadsTruncated(res.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Threads nicht ladbar");
    }
  };

  const loadIssues = async (): Promise<void> => {
    setIssues(null);
    try {
      const res = await api.forgeIssues(session.id);
      setIssues(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issues nicht ladbar");
    }
  };

  const startFromIssue = async (issue: ForgeIssueSummary): Promise<void> => {
    try {
      const created = await api.createSession({
        adapter: "dummy",
        project: session.project,
        title: `Issue #${issue.iid} · ${issue.title}`.slice(0, 120),
        prompt: `Arbeite GitLab-Issue #${issue.iid} „${issue.title}" ab (${issue.webUrl}).\n\n${issue.description.slice(0, 2_000)}`,
      });
      onOpenSession(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session-Anlage aus Issue fehlgeschlagen");
    }
  };

  const preparePreview = async (): Promise<void> => {
    setSendError(null);
    setPreviewPrompt(null);
    try {
      const res = await api.forgeFeedbackPreview(session.id, { finding, ...findingSource });
      setPreviewPrompt(res.prompt);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen");
    }
  };

  const sendFeedback = async (): Promise<void> => {
    setSendBusy(true);
    setSendError(null);
    try {
      const res = await api.forgeFeedbackSend(session.id, { operationId, finding, ...findingSource });
      if (res.ok) {
        setPreviewPrompt(null);
        setFinding("");
        const ops = await api.forgeOperations(session.id);
        setOperations(ops.items);
      } else {
        setSendError(res.detail ?? "Versand abgelehnt");
      }
    } catch {
      setSendError("Zustellung unklar (Netzwerk) — erneuter Versuch mit derselben Operations-ID ist sicher.");
    } finally {
      setSendBusy(false);
    }
  };

  const prepareMr = async (): Promise<void> => {
    setMrResult(null);
    try {
      const res = await api.forgeMrPlan(session.id);
      setPlan(res);
      setMrTitle(res.suggestedTitle);
      setMrDescription(`## Was\n\n(siehe Commits)\n\n## Testplan\n\n- \n\nCo-Authored-By: ${session.adapter} <noreply@ancientvoid.local>`);
    } catch (err) {
      setMrResult(err instanceof Error ? err.message : "Plan fehlgeschlagen");
    }
  };

  const createMr = async (): Promise<void> => {
    if (!plan) return;
    setMrBusy(true);
    setMrResult(null);
    try {
      const res = await api.forgeMrCreate(session.id, { operationId, title: mrTitle, description: mrDescription, targetBranch: plan.targetBranch, push: plan.pushNeeded });
      setMrResult(res.ok ? `Draft-MR angelegt: ${res.webUrl}` : (res.detail ?? "Fehlgeschlagen"));
      if (res.ok) setPlan(null);
    } catch {
      setMrResult("Ausgang unklar (Netzwerk) — Erneut versuchen findet einen bestehenden MR und dupliziert nicht.");
    } finally {
      setMrBusy(false);
    }
  };

  const mr: ForgeMrSummary | null = overview?.mr ?? null;

  return (
    <div class="forge-panel">
      {error && <div class="fp-warn">{error}</div>}
      {overview?.staleError === null && overview?.cachedAt && (
        <div class="dim fp-cached">{t("app.data_from")} {time(overview.cachedAt)}</div>
      )}

      {!overview?.link ? (
        <section class="fp-section">
          <h3>{t("forge.link_mr")}</h3>
          <div class="fp-link-row">
            <input type="url" placeholder={t("forge.gitlab_placeholder")} value={linkUrl} onInput={(e) => setLinkUrl((e.target as HTMLInputElement).value)} />
            <button class="fp-btn" disabled={!linkUrl.trim()} onClick={() => void link()}>{t("forge.link")}</button>
          </div>
          <details>
            <summary>{t("forge.issues_source")}</summary>
            <button class="fp-btn" onClick={() => void loadIssues()}>{t("forge.load_issues")}</button>
            {issues === null ? null : issues.length === 0 ? (
              <div class="dim">{t("forge.no_open_issues")}</div>
            ) : (
              <ul class="fp-issue-list">
                {issues.map((issue) => (
                  <li key={issue.iid}>
                    <span class="mono">#{issue.iid}</span> {issue.title}
                    <button class="fp-btn small" onClick={() => void startFromIssue(issue)}>{t("forge.start_session")}</button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      ) : (
        <>
          <section class="fp-section">
            <div class="fp-mr-head">
              <span class={`fp-chip ${mr?.state === "opened" ? "fp-run" : "fp-neutral"}`}>{mr?.state ?? "?"}</span>
              {mr?.draft && <span class="fp-chip fp-neutral">{t("forge.draft")}</span>}
              <a href={mr?.webUrl} target="_blank" rel="noreferrer noopener" class="fp-mr-title">
                {mr?.title ?? "MR"} <span class="dim mono">!{overview.link.mr.mrIid}</span>
              </a>
              <button class="fp-btn small" onClick={() => void unlink()}>{t("forge.resolve")}</button>
            </div>
            <div class="fp-meta mono">
              {mr?.sourceBranch} → {mr?.targetBranch} {t("forge.mr_head")} {short(mr?.sha ?? null)}
              {overview.shaDrift && <span class="fp-fail-text"> {t("forge.mr_new_commits")}</span>}
            </div>
            <div class="fp-meta dim mono">
              {t("forge.session_colon")} {overview.sessionBranch ?? "?"}@{short(overview.sessionHead)}{" "}
              {overview.sessionHead && mr?.sha && overview.sessionHead !== mr.sha ? "(weicht vom MR-Head ab)" : ""}
            </div>
          </section>

          <section class="fp-section">
            <h3>{t("forge.pipelines")}</h3>
            {overview.pipelines.length === 0 ? (
              <div class="dim">{t("forge.no_pipelines")}</div>
            ) : (
              <ul class="fp-pipeline-list">
                {overview.pipelines.map((p: ForgePipelineSummary) => (
                  <li key={p.id} class={jobsOf === p.id ? "open" : ""}>
                    <button class="fp-pipeline-row" onClick={() => void loadJobs(p.id)}>
                      <span class={`fp-chip ${statusClass(p.status)}`}>{statusLabel(p.status)}</span>
                      <span class="mono">#{p.id}</span>
                      <span class="dim">{short(p.sha)} · {p.ref}</span>
                    </button>
                    {jobsOf === p.id && (
                      <div class="fp-jobs">
                        {jobs === null ? (
                          <div class="dim">{t("common.loading_dots")}</div>
                        ) : (
                          jobs.map((j) => (
                            <div key={j.id} class="fp-job">
                              <span class={`fp-chip ${statusClass(j.status)}`}>{statusLabel(j.status)}</span>
                              <span class="mono">{j.name}</span>
                              {j.kind === "bridge" && j.downstreamPipelineId && <span class="dim">{t("forge.child_pipeline")}{j.downstreamPipelineId}</span>}
                              {j.status === "failed" && (
                                <>
                                  <button class="fp-btn small" onClick={() => void openTrace(j)}>{t("forge.trace")}</button>
                                  <button
                                    class="fp-btn small"
                                    onClick={() => {
                                      setFindingSource({ pipelineId: p.id, jobId: j.id });
                                      setFinding(`Job ${j.name} (Pipeline #${p.id}) fehlgeschlagen — Trace-Ausschnitt prüfen:\n`);
                                    }}
                                  >
                                    {t("forge.as_finding")}
                                  </button>
                                </>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {overview.pipelineStaleError && <div class="fp-warn">{t("forge.pipelines_colon")} {overview.pipelineStaleError}</div>}
          </section>

          <section class="fp-section">
            <h3>{t("forge.threads")}</h3>
            <button class="fp-btn small" onClick={() => void loadThreads()}>{t("forge.load")}</button>
            {threadsTruncated && <div class="dim"> {t("forge.more_discussions")}</div>}
            {threads?.map((th) => (
              <div key={th.id} class="fp-thread">
                {th.notes.slice(0, 3).map((n, i) => (
                  <div key={i} class={n.system ? "fp-note system" : "fp-note"}>
                    <span class="mono dim">{n.author}</span>
                    <blockquote>{n.body}</blockquote>
                  </div>
                ))}
                <button
                  class="fp-btn small"
                  onClick={() => {
                    setFindingSource({ threadId: th.id });
                    setFinding(`Review-Thread (erste Notiz von ${th.notes[0]?.author ?? "?"}):\n${th.notes[0]?.body.slice(0, 1_000) ?? ""}\n\nBitte Stellung nehmen und beheben.`);
                  }}
                >
                  {t("forge.as_finding")}
                </button>
              </div>
            ))}
          </section>

          <section class="fp-section">
            <h3>{t("forge.send_finding")}</h3>
            <textarea
              class="fp-finding"
              rows={4}
              placeholder={t("forge.finding_data")}
              value={finding}
              maxLength={8000}
              onInput={(e) => setFinding((e.target as HTMLTextAreaElement).value)}
            />
            <div class="fp-meta dim">
              {t("forge.source")} {findingSource.pipelineId ? `Pipeline #${findingSource.pipelineId}` : ""}{" "}
              {findingSource.jobId ? `· Job ${findingSource.jobId}` : ""} {findingSource.threadId ? `· Thread` : ""}{" "}
              {findingSource.pipelineId || findingSource.jobId || findingSource.threadId ? "" : "(noch keine — über Pipeline/Thread wählen)"}
            </div>
            <div class="fp-row">
              <button class="fp-btn" disabled={!finding.trim()} onClick={() => void preparePreview()}>{t("forge.preview")}</button>
              <button
                class="fp-btn"
                disabled={!finding.trim()}
                onClick={() => {
                  // EPIC-P43.5 T43.5-1: CI-Befund als Quellenchip — Composer zeigt die Mitgabe.
                  addSource(session.id, {
                    id: `forge:${findingSource.pipelineId ?? findingSource.threadId ?? "manual"}:${finding.slice(0, 40)}`,
                    kind: "forge",
                    label: `CI-Befund${findingSource.pipelineId ? ` · Pipeline #${findingSource.pipelineId}` : ""}`,
                    excerpt: finding.trim(),
                    hash: sessionHash(session.id, remoteHost(session.hostId)),
                    view: "forge",
                  });
                  setFinding("");
                  setSendError(null);
                  setNote("Als Quelle im Composer — dort prüfen und mit dem nächsten Absenden mitgeben.");
                }}
              >
                {t("forge.into_composer")}
              </button>
            </div>
            {previewPrompt !== null && (
              <div class="fp-preview">
                <pre class="mono">{previewPrompt}</pre>
                <div class="fp-row">
                  <button class="fp-btn small" onClick={() => setPreviewPrompt(null)}>{t("common.cancel_lower")}</button>
                  <button class="fp-btn primary" disabled={sendBusy} onClick={() => void sendFeedback()}>
                    {sendBusy ? "sendet…" : "an Agenten senden"}
                  </button>
                </div>
                {sendError && <div class="fp-warn">{sendError}</div>}
              </div>
            )}
            {note && <div class="dim" role="status">{note}</div>}
            {sendError && previewPrompt === null && <div class="fp-warn">{sendError}</div>}
          </section>

          <section class="fp-section">
            <h3>{t("forge.draft_mr")}</h3>
            {plan === null ? (
              <button class="fp-btn" onClick={() => void prepareMr()}>{t("forge.prepare")}</button>
            ) : (
              <div class="fp-plan">
                <div class="fp-meta mono">
                  {plan.branch} → {plan.targetBranch} · {plan.pushNeeded ? `${plan.commitsAhead.length} Commit(s) werden gepusht` : "Branch ist aktuell"}
                </div>
                <ul class="fp-commits">
                  {plan.commitsAhead.map((c) => (
                    <li key={c.sha} class="mono dim">{c.sha.slice(0, 8)} {c.subject}</li>
                  ))}
                </ul>
                <input type="text" value={mrTitle} maxLength={120} onInput={(e) => setMrTitle((e.target as HTMLInputElement).value)} aria-label={t("forge.mr_title")} />
                <textarea rows={4} value={mrDescription} maxLength={20000} onInput={(e) => setMrDescription((e.target as HTMLTextAreaElement).value)} aria-label={t("forge.mr_description")} />
                <div class="fp-row">
                  <button class="fp-btn small" onClick={() => setPlan(null)}>{t("common.cancel_lower")}</button>
                  <button class="fp-btn primary" disabled={mrBusy || mrTitle.trim().length < 3} onClick={() => void createMr()}>
                    {mrBusy ? "erstellt…" : plan.pushNeeded ? "pushen & Draft-MR erstellen" : "Draft-MR erstellen"}
                  </button>
                </div>
              </div>
            )}
            {mrResult && <div class="fp-warn">{mrResult}</div>}
          </section>

          <section class="fp-section">
            <h3>{t("forge.operations")}</h3>
            <button
              class="fp-btn small"
              onClick={async () => {
                const ops = await api.forgeOperations(session.id);
                setOperations(ops.items);
              }}
            >
              {t("forge.load")}
            </button>
            {operations?.map((op) => (
              <div key={op.id} class="fp-op">
                <span class={`fp-chip ${op.state === "done" ? "fp-ok" : op.state === "uncertain" ? "fp-fail" : "fp-neutral"}`}>{op.state}</span>
                <span class="mono dim">{op.kind === "draft_mr" ? t("forge.draft_mr") : "Feedback"} · {short(op.sha)}{op.jobId ? ` · Job ${op.jobId}` : ""}</span>
                {op.detail && <span class="dim">{op.detail.slice(0, 160)}</span>}
              </div>
            ))}
          </section>
        </>
      )}

      {trace !== null && (
        <Sheet open onClose={() => setTrace(null)} label={t("forge.job_trace")} variant="modal" testid="modal" class="fp-trace-dialog">
          <h3>{t("forge.trace_job")} {trace.jobId}{trace.truncated ? " (gekürzt)" : ""}</h3>
          <div class="dim">{t("forge.fetch")} {time(trace.fetchedAt)} · {(trace.sizeBytes / 1024).toFixed(1)} {t("forge.kb_sha")} {short(trace.sha)}</div>
          <pre class="mono fp-trace">{trace.preview}</pre>
          <div class="fp-row right">
            <button class="fp-btn" onClick={() => setTrace(null)}>{t("forge.close")}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

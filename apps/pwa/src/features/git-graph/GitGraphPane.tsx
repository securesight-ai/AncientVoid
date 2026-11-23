import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { GitGraphReport } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";
import { openLayer } from "../../shared/layers.ts";
import { GIT_LANE_COLORS, groupGitRefs, layoutGitGraph, mergeSources } from "./layout.ts";

const ROW_H = 44;
const LANE_W = 14;
const DOT_R = 5;
const FILE_ROW_H = 22;
/** Git-Fachbegriff, nicht übersetzt. */
const HEAD_LABEL = "HEAD";

/**
 * ADR-0071: farbige Branch-Linien, Merge-/Fork-Punkte; Datei-Klick → Projekt-Explorer.
 * BUG-0190: durchgehende Spuren, lesbare Worktree-Labels, Farb-Legende.
 */
export function GitGraphPane({
  target,
  hostId = null,
  sessionId,
}: {
  target: string;
  hostId?: string | null;
  /** Projekt-Target (früher globale Git-Struktur-Ebene): null — Dateiklicks haben dann keinen Session-Explorer. */
  sessionId: string | null;
}) {
  const api = useMemo(() => hostApi(hostId), [hostId]);
  const [report, setReport] = useState<GitGraphReport | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError("");
    api
      .gitGraph(target)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [api, target]);

  const { rows, laneCount } = useMemo(() => (report ? layoutGitGraph(report.commits) : { rows: [], laneCount: 1 }), [report]);
  const bySha = useMemo(() => new Map((report?.commits ?? []).map((c) => [c.sha, c])), [report]);

  const openInExplorer = (path: string, sha: string) => {
    if (!sessionId) return;
    openLayer("files");
    window.dispatchEvent(
      new CustomEvent("ancientvoid:files-open-path", {
        detail: { sessionId, path, hostId: hostId ?? null, sha },
      }),
    );
  };

  const graphW = Math.max(48, laneCount * LANE_W + 16);

  return (
    <div class="git-graph-pane" data-testid="git-graph-pane">
      {report?.truncated && (
        <div class="graph-banner">
          {t("git-graph.history_capped")} {report.maxCommits} {t("git-graph.commits_missing")}
        </div>
      )}
      {report && !report.error && (
        <p class="git-graph-legend dim" data-testid="git-graph-legend">
          {t("git-graph.lanes_note")}
        </p>
      )}
      {error && <div class="files-error">{t("git-graph.gitgraph_not_loadable")} {error}</div>}
      {report?.error && (
        <div class="ui-empty git-graph-norepo" data-testid="git-graph-error">
          <strong>{report.error}</strong>
          {report.error.startsWith("Kein Git") && <p class="dim">{t("git-graph.no_repo_hint")}</p>}
        </div>
      )}
      {!report && !error && <div class="ui-empty">{t("git-graph.gitgraph_loading")}</div>}
      {report && !report.error && (
        <ul class="git-graph-list" role="list">
          {rows.map((row) => {
            const color = GIT_LANE_COLORS[row.lane % GIT_LANE_COLORS.length];
            const open = expanded === row.commit.sha;
            const filesH = open ? Math.max(1, row.commit.files.length) * FILE_ROW_H + (row.commit.filesTruncated ? FILE_ROW_H : 0) + 12 : 0;
            const svgH = ROW_H + filesH;
            const dotY = ROW_H / 2;
            const chips = groupGitRefs(row.commit.refs);
            const isHead = report?.head === row.commit.sha;
            const sources = row.merge ? mergeSources(row.commit, bySha) : [];
            return (
              <li key={row.commit.sha} class={`git-graph-row${row.merge ? " merge" : ""}`} data-sha={row.commit.sha}>
                <svg class="git-graph-rails" width={graphW} height={svgH} aria-hidden="true">
                  {row.active.map((lane) => (
                    <line
                      key={`a${lane}`}
                      x1={8 + lane * LANE_W}
                      y1={0}
                      x2={8 + lane * LANE_W}
                      y2={svgH}
                      stroke={GIT_LANE_COLORS[lane % GIT_LANE_COLORS.length]}
                      stroke-width="2.5" stroke-linecap="round"
                    />
                  ))}
                  {/* Spur des Commits von oben bis zum Punkt */}
                  <line
                    x1={8 + row.lane * LANE_W}
                    y1={0}
                    x2={8 + row.lane * LANE_W}
                    y2={dotY}
                    stroke={color}
                    stroke-width="2.5" stroke-linecap="round"
                  />
                  {row.edges.map((e, ei) => {
                    const x1 = 8 + e.fromLane * LANE_W;
                    const x2 = 8 + e.toLane * LANE_W;
                    const y1 = dotY;
                    const y2 = svgH;
                    const c = GIT_LANE_COLORS[e.colorLane % GIT_LANE_COLORS.length];
                    if (x1 === x2) {
                      return <line key={ei} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} stroke-width="2.5" stroke-linecap="round" />;
                    }
                    return (
                      <path
                        key={ei}
                        d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={c}
                        stroke-width="2.5" stroke-linecap="round"
                      />
                    );
                  })}
                  <circle
                    cx={8 + row.lane * LANE_W}
                    cy={dotY}
                    r={row.merge ? DOT_R + 1.5 : DOT_R}
                    fill={color}
                    stroke={isHead ? "var(--fg)" : "var(--bg)"}
                    stroke-width={isHead ? 3 : 2}
                  />
                </svg>
                <div class="git-graph-body">
                  <button type="button" class="git-graph-commit" onClick={() => setExpanded(open ? null : row.commit.sha)}>
                    <code class="git-graph-sha">{row.commit.shortSha}</code>
                    {isHead && <span class="git-graph-head" title={t("git-graph.head_title")}>{HEAD_LABEL}</span>}
                    {chips.length > 0 && (
                      <span class="git-graph-refs">
                        {chips.map((c) => (
                          <span
                            class={`git-graph-ref${c.remoteOnly ? " remote" : ""}${c.session ? " session" : ""}`}
                            key={c.label}
                            title={c.title}
                            style={{ "--lane": color } as never}
                          >
                            {c.label}
                            {c.withRemote && <span class="git-graph-sync" aria-label={t("git-graph.remote_in_sync")}> ⇄</span>}
                          </span>
                        ))}
                      </span>
                    )}
                    <span class="git-graph-subject">{row.commit.subject}</span>
                    <span class="dim git-graph-meta">{row.commit.author} · {new Date(row.commit.date).toLocaleString("de-DE")}</span>
                  </button>
                  {sources.length > 0 && (
                    <p class="git-graph-merge dim" data-testid="git-graph-merge">
                      {t("git-graph.merge_from")}{" "}
                      {sources.map((m, i) => (
                        <span key={m.shortSha}>
                          {i > 0 && ", "}
                          <strong>{m.name ?? m.shortSha}</strong>
                          {m.name && <code class="git-graph-sha"> {m.shortSha}</code>}
                          {m.outside && ` ${t("git-graph.merge_outside")}`}
                        </span>
                      ))}
                      {" "}{t("git-graph.merge_into")}
                    </p>
                  )}
                  {open && (
                    <ul class="git-graph-files" data-testid="git-graph-files">
                      {row.commit.files.map((f) => (
                        <li key={f.path}>
                          <button type="button" class="link-btn" onClick={() => openInExplorer(f.path, row.commit.sha)}>
                            <span class="git-graph-status">{f.status}</span> {f.path}
                          </button>
                        </li>
                      ))}
                      {row.commit.files.length === 0 && <li class="dim">{t("git-graph.no_file_changes")}</li>}
                      {row.commit.filesTruncated && <li class="dim">{t("git-graph.more_files_capped")}</li>}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

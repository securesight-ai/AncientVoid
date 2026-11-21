import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ReleaseNotesDetail, ReleaseNotesEntry, ReleaseNotesListReport } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Markdown } from "../../shared/Markdown.tsx";
import { EmptyState } from "../../shared/ui/index.ts";
import { notationLine, statsLine } from "./release-notes-model.ts";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * EPIC-P70 (ADR-0093): Release-Notes — gemergte PRs eines Projekts chronologisch,
 * Kurzfassung aus der Commit-Notation; Details (Was: Commits/Dateien, Warum:
 * PR-Beschreibung) klappen auf und werden lazy geladen. Session-Worktrees zeigen
 * PRs nur bis zum Branch-Punkt — Regelfall ist die Projekt-Wahl.
 */
export function ReleaseNotesPage() {
  const [project, setProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]);
  const [report, setReport] = useState<ReleaseNotesListReport | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  /** mergeSha → Detail (lazy geladen) oder Fehlerzeile. */
  const [details, setDetails] = useState<Map<string, ReleaseNotesDetail | string>>(new Map());

  useEffect(() => {
    let alive = true;
    hubApi
      .projects()
      .then((r) => alive && setProjects(r.projects.map((p) => ({ name: p.name, path: p.path }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    setReport(null);
    setError("");
    setExpanded(null);
    hubApi
      .releaseNotes(`project=${encodeURIComponent(project)}`)
      .then((r) => alive && setReport(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [project]);

  const toggle = (entry: ReleaseNotesEntry): void => {
    const sha = entry.mergeSha;
    setExpanded((cur) => (cur === sha ? null : sha));
    if (details.has(sha) || !project) return;
    setDetails((cur) => new Map(cur).set(sha, t("common.loading_short")));
    hubApi
      .releaseNotesDetail(`project=${encodeURIComponent(project)}`, sha)
      .then((d) => setDetails((cur) => new Map(cur).set(sha, d)))
      .catch((e: unknown) =>
        setDetails((cur) => new Map(cur).set(sha, `Detail nicht ladbar: ${e instanceof Error ? e.message : String(e)}`)),
      );
  };

  const label = useMemo(() => (path: string) => projects.find((p) => p.path === path)?.name ?? path, [projects]);

  return (
    <section class="rn-page" data-testid="release-notes-page" aria-label={t("common.release_notes")}>
      <header class="rn-head-page">
        <h2>{t("common.release_notes")}</h2>
        <label class="rn-project">
          <span class="rn-project-label">{t("newsession.project")}</span>
          <select
            data-testid="rn-project"
            value={project ?? ""}
            onChange={(e) => setProject((e.currentTarget as HTMLSelectElement).value || null)}
          >
            <option value="" disabled>
              {t("release-notes.choose_project2")}
            </option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {label(p.path)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {!project && (
        <EmptyState icon="▤" text={t("release-notes.choose_project")} />
      )}
      {project && error && <EmptyState icon="⚠" text={`Release-Notes nicht lesbar: ${error}`} />}
      {project && !error && !report && <EmptyState icon="▤" text={t("release-notes.loading")} />}
      {project && report?.error && <EmptyState icon="▤" text={report.error} />}
      {project && report && !report.error && report.entries.length === 0 && (
        <EmptyState icon="▤" text={t("release-notes.no_merged")} />
      )}
      {project && report && !report.error && report.entries.length > 0 && (
        <div class="rn-list">
          {report.entries.map((entry) => (
            <article key={entry.mergeSha} class="rn-entry" data-testid="rn-entry">
              <button type="button" class="rn-toggle" aria-expanded={expanded === entry.mergeSha} onClick={() => toggle(entry)}>
                <span class="rn-title-row">
                  {entry.notation.prNumber !== null && <span class="rn-pr">#{entry.notation.prNumber}</span>}
                  <span class="rn-summary">{entry.notation.summary}</span>
                </span>
                <span class="rn-meta">
                  {entry.notation.unparsed && <span class="rn-badge rn-unparsed">{t("release-notes.no_notation")}</span>}
                  {!entry.notation.unparsed && <span class="rn-badge">{notationLine(entry.notation)}</span>}
                  <span class="rn-date">{formatDate(entry.mergedAt)}</span>
                  {statsLine(entry.stats) && <span class="rn-stats">{statsLine(entry.stats)}</span>}
                </span>
              </button>
              {expanded === entry.mergeSha && <PrDetail detail={details.get(entry.mergeSha)} />}
            </article>
          ))}
          {report.truncated && <p class="rn-truncated">{t("release-notes.older_not_loaded")} {report.maxEntries})</p>}
        </div>
      )}
    </section>
  );
}

function PrDetail({ detail }: { detail: ReleaseNotesDetail | string | undefined }) {
  if (detail === undefined) return <div class="rn-detail"><p class="rn-wait">{t("common.loading_short")}</p></div>;
  if (typeof detail === "string") return <div class="rn-detail"><p class="rn-wait">{detail}</p></div>;
  return (
    <div class="rn-detail" data-testid="rn-detail">
      <h3>{t("release-notes.why")}</h3>
      {detail.body ? <Markdown text={detail.body} /> : <p class="rn-nobody">{t("release-notes.no_pr_desc")}</p>}
      {detail.bodyTruncated && <p class="rn-truncated">{t("release-notes.desc_truncated")}</p>}
      <h3>
        {t("release-notes.what")} {detail.commits.length}
        {detail.commitsTruncated ? "+" : ""} {detail.commits.length === 1 ? "Commit" : "Commits"}
      </h3>
      <ul class="rn-commits">
        {detail.commits.map((c) => (
          <li key={c.sha} class="rn-commit" data-testid="rn-commit">
            <span class="rn-commit-head">
              <code>{c.shortSha}</code>
              <span class="rn-badge">{notationLine(c.notation)}</span>
              <span class="rn-date">{formatDate(c.date)}</span>
            </span>
            <span class="rn-summary">{c.notation.summary}</span>
            {c.body && <Markdown class="rn-commit-body" text={c.body} />}
            {c.bodyTruncated && <p class="rn-truncated">{t("release-notes.commit_desc_truncated")}</p>}
          </li>
        ))}
      </ul>
      {detail.stats && (
        <p class="rn-stats">
          {statsLine(detail.stats)} · {detail.files.length}
          {detail.filesTruncated ? "+" : ""} {detail.files.length === 1 ? "Datei" : t("release-notes.files")} {t("release-notes.listed")}
        </p>
      )}
      {detail.files.length > 0 && (
        <details class="rn-files">
          <summary>{t("release-notes.files")}</summary>
          <ul>
            {detail.files.map((f) => (
              <li key={`${f.status}-${f.path}`}>
                <span class="rn-file-status" data-status={f.status}>
                  {f.status}
                </span>{" "}
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
          {detail.filesTruncated && <p class="rn-truncated">{t("release-notes.filelist_truncated")}</p>}
        </details>
      )}
    </div>
  );
}

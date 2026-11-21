import { t } from "../../shared/i18n/index.ts";
import { fmtDateTime, fmtTime, fmtNumber } from "../../shared/i18n/format.ts";
import { useMemo, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type SessionDiffResult, type SessionDiffFile, type DiffCommit, type DiffHunk } from "../../shared/api.ts";
import { isOneSided, mapHunkLines, oversizeNote, pairHunkLines, type MappedDiffLine } from "./diff-lines.ts";
import { wordDiff, wordMarksFor, type WordSeg } from "./word-diff.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";

/** EPIC-P36: Zeilen-Anker für Review-Notizen. DiffPane bleibt Renderer —
 * Auswahlzustand und Notizlogik liegen in DiffReview.tsx. */
export interface LinePick {
  path: string;
  /** AC-P2-1: Commit-Abschnitt, zu dem die Zeile gehört (uncommittet → undefined). */
  commit?: string;
  side: "old" | "new";
  line: number;
  text: string;
}

export interface ReviewHooks {
  pickEnabled: boolean;
  onLinePick?: (pick: LinePick) => void;
  /** Aktuell markierter Bereich (gleicher Pfad/Commit) oder null. */
  picked: { path: string; commit?: string; side: "old" | "new"; start: number; end: number } | null;
  /** Anzahl Notizen je Datei (Badge in der Dateiliste). */
  noteCount: (path: string) => number;
}

/**
 * T1.6-5 → T2.3 (EPIC-P2 §4): per-file hunk cards, replacing the raw
 * concatenated-patch view. Each hunk shows git's own real function-context
 * anchor (T2.2) and, once collapsed under K3, a tap-to-expand button that
 * fetches the full hunk via GET /api/sessions/:id/diff/hunk.
 */
/**
 * Segmente einer wortweise markierten Zeile: das `+`/`−` sitzt am geaenderten Segment,
 * nicht an der ganzen Zeile. aria-label macht die Aenderungsart ohne Farbe lesbar.
 */
function Segs({ segs }: { segs: WordSeg[] }) {
  return (
    <>
      {segs.map((seg, k) =>
        seg.t === "eq" ? (
          <span key={k}>{seg.s}</span>
        ) : (
          <span
            key={k}
            class={seg.t === "add" ? "wd-add" : "wd-del"}
            aria-label={seg.t === "add" ? t("session.added_label", { "s": seg.s.trim() }) : t("session.removed_label", { "s": seg.s.trim() })}
          >
            <span class="wd-mark" aria-hidden="true">
              {seg.t === "add" ? "+" : "−"}
            </span>
            {seg.s}
          </span>
        ),
      )}
    </>
  );
}

function HunkCard({
  sessionId,
  path,
  hunk,
  index,
  commit,
  review,
}: {
  sessionId: string;
  path: string;
  hunk: DiffHunk;
  index: number;
  /** AC-P2-1: Hunk gehört zu diesem Commit-Abschnitt — Expand lädt ihn
   * gegen sha^..sha statt gegen das Arbeitsverzeichnis. */
  commit?: string;
  review?: ReviewHooks;
}) {
  const api = useApi();
  const [expanded, setExpanded] = useState<DiffHunk | null>(null);
  const [loading, setLoading] = useState(false);
  const active = expanded ?? hunk;
  const rows = useMemo(() => pairHunkLines(active.body), [active.body]);
  const oneSided = useMemo(() => isOneSided(rows), [rows]);
  const mapped = useMemo(() => mapHunkLines(active), [active]);
  // Kleine Aenderungen (eine Zahl, ein Wort) werden wortweise markiert statt zwei ganze
  // Zeilen rot/gruen — wo die Paartechnik nichts erklaert, bleibt die Zeilendarstellung.
  const marks = useMemo(() => wordMarksFor(mapped), [mapped]);

  const onExpand = async () => {
    setLoading(true);
    try {
      const res = await api.sessionDiffHunk(sessionId, path, commit);
      const full = res.hunks[index];
      if (full) setExpanded(full);
    } catch {
      // stays collapsed — a failed expand is a no-op, not a crash
    } finally {
      setLoading(false);
    }
  };

  const isPicked = (line: MappedDiffLine): boolean => {
    if (!review?.picked || review.picked.path !== path || review.picked.commit !== commit) return false;
    const n = review.picked.side === "old" ? line.oldLine : line.newLine;
    return n !== null && n >= review.picked.start && n <= review.picked.end;
  };

  return (
    <div class={`hunk-card${oneSided ? " one-sided" : ""}`}>
      <div class="hunk-card-header mono">
        <span class="hunk-range">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
        </span>
        <span class="hunk-fn">{active.functionContext ?? "—"}</span>
        {active.collapsed && (
          <Button  aria-busy={loading} onClick={onExpand} disabled={loading} class={loading ? "hunk-expand-btn busy" : "hunk-expand-btn"}>
            {loading ? t("common.loading_dots") : t("session.whole_hunk")}
          </Button>
        )}
      </div>
      <div class="hunk-body-unified mono">
        {mapped.map((line, i) => {
          const cls = line.type === "add" ? "diff-line-add" : line.type === "del" ? "diff-line-del" : "diff-line-ctx";
          const picked = isPicked(line);
          const clickable = review?.pickEnabled && review.onLinePick;
          return (
            <div
              key={i}
              class={`${cls}${marks[i] ? " wd-line" : ""}${picked ? " review-picked" : ""}${clickable ? " review-pickable" : ""}`}
              onClick={
                clickable
                  ? () => {
                      const side = review.picked?.side ?? "new";
                      const n = side === "old" ? line.oldLine : line.newLine;
                      if (n !== null) review.onLinePick!({ path, commit, side, line: n, text: line.text });
                    }
                  : undefined
              }
            >
              <span class="wd-gutter">{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}</span>
              {marks[i] ? <Segs segs={marks[i]!} /> : line.text}
            </div>
          );
        })}
      </div>
      <div class="hunk-body-split mono">
        {rows.map((row, i) => {
          // Spaltenansicht (ab Rechnerbreite) bekommt dieselbe Feinmarkierung.
          const pair = row.left.type === "del" && row.right.type === "add" ? wordDiff(row.left.text, row.right.text) : null;
          return (
            <div class="hunk-split-row" key={i}>
              <span class={`hunk-split-cell ${row.left.type}${pair ? " wd-line" : ""}`}>
                {pair ? <Segs segs={pair.left} /> : row.left.text}
              </span>
              <span class={`hunk-split-cell ${row.right.type}${pair ? " wd-line" : ""}`}>
                {pair ? <Segs segs={pair.right} /> : row.right.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The anchor of a file's hunks — the list on the left jumps to it. */
const fileAnchor = (index: number) => `diff-file-${index}`;

function CommitHeading({ commit }: { commit: DiffCommit }) {
  return (
    <div class="diff-commit-heading">
      <span class="mono diff-commit-sha">{commit.shortSha}</span>
      <span class="diff-commit-subject">{commit.subject}</span>
      <span class="dim diff-commit-meta">
        {commit.author} · {fmtDateTime(commit.date)}
      </span>
      {commit.oversize && <div class="diff-oversize">{oversizeNote(commit.oversize)}</div>}
    </div>
  );
}

export function DiffPane({
  diff,
  sessionId,
  review,
}: {
  diff: SessionDiffResult | null;
  sessionId: string;
  /** EPIC-P36: optionale Review-Hooks — ohne sie rendert DiffPane wie vorher. */
  review?: ReviewHooks;
}) {
  if (diff === null) return <EmptyState text={t("common.loading")} />;
  if (diff.error) return <EmptyState text={diff.error} />;
  // AC-P2-1: ein Abschnitt pro Commit (ältester zuerst), danach der
  // uncommittete Rest. `diff.files` trägt seit der Umstellung nur noch
  // den uncommitteten Teil — die Sprungliste links ist die Union aus
  // beiden, dedupliziert pro Pfad (eine Datei kann in einem Commit UND
  // uncommittet geändert sein).
  const commits = diff.commits ?? [];
  const union: SessionDiffFile[] = [];
  const seen = new Set<string>();
  for (const f of [...commits.flatMap((c) => c.files), ...diff.files]) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    union.push(f);
  }
  const preexisting = new Set(diff.baseline?.dirtyAtStart ?? []);
  const maxChange = Math.max(1, ...union.map((f) => (f.binary ? 0 : f.additions + f.deletions)));
  const anchorOf = new Map(union.map((f, i) => [f.path, i]));
  const groups = (files: SessionDiffFile[], commit?: string) =>
    files.map((f) => {
      const i = anchorOf.get(f.path) ?? 0;
      return f.binary || f.hunks.length === 0 ? null : (
        <div key={f.path} class="diff-file-group" id={fileAnchor(i)}>
          <div class="diff-file-heading mono">
            {f.path}
            {preexisting.has(f.path) && <span class="diff-preexisting" title={t("session.changed_before_start")}>{t("session.changed_before_start_short")}</span>}
            {review && review.noteCount(f.path) > 0 && <span class="review-note-badge">{review.noteCount(f.path)}</span>}
          </div>
          {f.hunks.map((h, j) => (
            <HunkCard key={`${f.path}:${j}`} sessionId={sessionId} path={f.path} hunk={h} index={j} commit={commit} review={review} />
          ))}
        </div>
      );
    });
  // EPIC-P20 T20.1: from 1280 px the file list sits beside the code (CSS), a click jumps to
  // the file. The phone keeps the stacked list; the rows only gain a jump there.
  const jump = (index: number) => {
    const root = document.querySelector(".tail-scroll");
    root?.querySelector(`[id="${fileAnchor(index)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div class="diff-pane">
      {diff.baseline && diff.baseline.dirtyAtStart.length > 0 && (
        <div class="workplace-warn" role="note">
          {t("session.project_direct_colon")} {diff.baseline.dirtyAtStart.length}{diff.baseline.dirtyTruncated ? "+" : ""} {t("session.files_prechanged")}
        </div>
      )}
      <div class="diff-files">
        {union.map((f, i) => (
          <div
            key={f.path}
            class="diff-file-row"
            role="button"
            tabIndex={0}
            onClick={() => jump(i)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                jump(i);
              }
            }}
          >
            <span class="mono">{f.path}</span>
            {f.binary ? (
              <span class="dim">{t("session.binary")}</span>
            ) : (
              <span class="diff-file-counts">
                <span class="diff-add-count">+{f.additions}</span> <span class="diff-del-count">-{f.deletions}</span>
                {/* EPIC-P43 T43.5: Plus/Minus als Balken, Länge relativ zur größten Datei. */}
                <span class="diff-bar" aria-hidden="true" style={{ width: `${Math.max(4, Math.round(((f.additions + f.deletions) / maxChange) * 56))}px` }}>
                  <span class="add" style={{ flexGrow: f.additions }} />
                  <span class="del" style={{ flexGrow: f.deletions }} />
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div class="diff-main">
        <div class="diff-legend" aria-hidden="true">
          <span class="wd-add">
            <span class="wd-mark">+</span>{t("common.new")}
          </span>
          <span class="wd-del">
            <span class="wd-mark">−</span>{t("session.removed")}
          </span>
          <span class="diff-legend-hint">{t("session.marked_only_real_changes")}</span>
        </div>
        {diff.truncated && (
          <div class="dim" style="margin: 8px 0">
            {t("session.big_hunks_trimmed")}
          </div>
        )}
        {diff.commitsTruncated && (
          <div class="dim" style="margin: 8px 0">
            {t("session.more_than_200_commits")} {diff.baseRef} {t("session.only_recent_grouped")}
          </div>
        )}
        {commits.map((c) => (
          <section key={c.sha} class="diff-commit-section">
            <CommitHeading commit={c} />
            {groups(c.files, c.sha)}
          </section>
        ))}
        {commits.length > 0 && diff.files.length > 0 && (
          <div class="diff-section-heading">{t("session.uncommitted_changes")}</div>
        )}
        {groups(diff.files)}
      </div>
    </div>
  );
}

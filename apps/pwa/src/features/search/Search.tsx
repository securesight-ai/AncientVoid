import { t } from "../../shared/i18n/index.ts";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { TranscriptRole, UnifiedSearchResponse } from "@ancientvoid/contracts";
import { useApi } from "../../shared/api-context.ts";
import { type ProjectDoc, type ProjectFile } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";
import { Markdown } from "../../shared/Markdown.tsx";
import { Button, Chip, Segmented } from "../../shared/ui/index.ts";
import { DEFAULT_ROLES, ROLE_ORDER, SessionHits, Snippet, groupHits, hitsLabel, roleLabel, toggleRole } from "./session-hits.tsx";

// T3.8 (EPIC-P3 §3 "Sprachsuche"): real qmd-backed project MARKDOWN search
// (the underlying qmd CLI only ever indexes `**/*.md` files — see
// search.ts's DEFAULT_PATTERN doc comment), plus the structured document
// overview over the same files (no qmd needed — plain directory listing).
// Documents open rendered as Markdown (shared/Markdown.tsx, Preact nodes,
// never innerHTML) — a documentation viewer, not a code viewer: no gutter,
// no line numbers, no highlight.js. Design tokens only from app/styles/
// (docs/design-system.md, P1.6).

/** Verzeichnis-Gruppe der Dokumentübersicht; „." ist das Projekt-Stammverzeichnis. */
export interface DocGroup {
  dir: string;
  items: ProjectDoc[];
}

export function groupDocs(docs: readonly ProjectDoc[]): DocGroup[] {
  const groups = new Map<string, ProjectDoc[]>();
  for (const doc of docs) {
    const dir = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : ".";
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(doc);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "." ? -1 : b[0] === "." ? 1 : a[0].localeCompare(b[0])))
    .map(([dir, items]) => ({ dir, items }));
}

export function dirLabel(dir: string): string {
  return dir === "." ? "Stammverzeichnis" : dir;
}

/** Der stabilste gemeinsame Kern eines Snippets: führender Titel/Whitespace
 * * ist weg, gekürzt — genug, um den Abschnitt im gerenderten Dokument
 * wiederzufinden, ohne von Markdown-Formatierung abzuhängen. */
export function snippetAnchor(snippet: string): string {
  // \u0002/\u0003 sind Markierungszeichen des Hubs, kein Text — sie dürfen den
  // Anker nicht verschieben, sonst findet die Dokuansicht ihren eigenen Treffer
  // nicht wieder.
  return snippet.replace(/[\u0002\u0003]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function docName(doc: ProjectDoc): string {
  return doc.path.slice(doc.path.lastIndexOf("/") + 1);
}

/** Suchseite (Nachschärfe 2026-11-22): ein Feld für den ganzen Fundus — die
 * Sessiontexte des Hubs (Fragen, Antworten, Denk- und Werkzeugspuren) und die
 * Markdown-Doku des Projekts. Die Grenzen hier sind bewusst keine Konstanten
 * aus `@ancientvoid/contracts`: die Vertragsdatei zieht sonst zod in das
 * PWA-Bündel, weil sie Validierungen enthält. */
const MIN_QUERY = 2;
const PAGE = 20;

type Scope = "all" | "sessions" | "docs";
type Status = "idle" | "searching" | "ready" | "error";

export function SearchPane({
  project,
  sessionId,
  onJumpToSeq,
}: {
  project: string;
  sessionId: string;
  onJumpToSeq?: (seq: number) => void;
}) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [roles, setRoles] = useState<readonly TranscriptRole[]>(DEFAULT_ROLES);
  const [sessionsHereOnly, setSessionsHereOnly] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [res, setRes] = useState<UnifiedSearchResponse | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [docs, setDocs] = useState<ProjectDoc[] | null>(null);
  const [viewing, setViewing] = useState<{ path: string; snippet?: string } | null>(null);
  // Eine jüngere Suche muss eine ältere Antwort überholen können, ohne dass
  // die ältere später dazwischenfunkt (Tippen auf dem Handy ist schnell).
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    // Die Dokumentübersicht braucht keinen Index — sie steht auch ohne Suche.
    api
      .searchDocs(project)
      .then((r) => alive && setDocs(r.docs))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [project]);

  const request = useCallback(
    async (q: string, offset = 0, nextScope = scope, nextRoles = roles, hereOnly = sessionsHereOnly) => {
      if (!q) return;
      const mine = ++seqRef.current;
      setStatus("searching");
      setErrorMsg("");
      try {
        const r = await api.searchAll({
          q,
          scope: nextScope,
          roles: [...nextRoles],
          limit: PAGE,
          offset,
          project,
          ...(hereOnly ? { sessionProject: project } : {}),
        });
        if (mine !== seqRef.current) return;
        setRes((prev) => (offset > 0 && prev ? { ...r, sessions: [...prev.sessions, ...r.sessions] } : r));
        setLoaded(offset + r.sessions.length);
        setStatus("ready");
      } catch (err) {
        if (mine !== seqRef.current) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : t("search.doc_error"));
      }
    },
    [api, project, roles, scope, sessionsHereOnly],
  );

  /** Tippen sucht: 350 ms Ruhe, dann läuft die Anfrage. Ein Ein-Wort-Rest
   * schickt nichts raus — die Trefferliste wäre Müll. */
  const type = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      seqRef.current += 1;
      setRes(null);
      setLoaded(0);
      setStatus("idle");
      return;
    }
    timerRef.current = setTimeout(() => void request(q), 350);
  };

  const changeScope = (next: Scope) => {
    setScope(next);
    const q = query.trim();
    if (q.length >= MIN_QUERY) void request(q, 0, next);
  };

  const changeRole = (role: TranscriptRole) => {
    const next = toggleRole(roles, role);
    setRoles(next);
    const q = query.trim();
    if (q.length >= MIN_QUERY) void request(q, 0, scope, next);
  };

  const changeHereOnly = (on: boolean) => {
    setSessionsHereOnly(on);
    const q = query.trim();
    if (q.length >= MIN_QUERY) void request(q, 0, scope, roles, on);
  };

  const groups = res ? groupHits(res.sessions) : [];
  const searching = status === "searching";
  const facetCount = (role: TranscriptRole) => res?.facets.find((f) => f.role === role)?.count ?? 0;
  const indexLine = res
    ? res.index.lines === 0
      ? t("search.index_empty")
      : `${t("search.index_line", { lines: res.index.lines, sessions: res.index.sessions })}${
          res.index.engine === "scan" ? ` · ${t("search.engine_scan")}` : ""
        }`
    : "";

  return (
    <div class="search-pane">
      <form
        class="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (timerRef.current) clearTimeout(timerRef.current);
          const q = query.trim();
          if (q.length >= MIN_QUERY) void request(q);
        }}
      >
        <input
          class="search-input"
          type="search"
          inputmode="search"
          autocomplete="off"
          aria-label={t("search.query_all")}
          placeholder={t("search.query_all")}
          value={query}
          onInput={(e) => type((e.target as HTMLInputElement).value)}
        />
        <Button type="submit" aria-busy={searching} disabled={query.trim().length < MIN_QUERY || searching} variant="primary" class={searching ? "busy" : undefined}>
          {searching ? "…" : t("search.go")}
        </Button>
      </form>

      <div class="search-controls">
        <Segmented
          value={scope}
          label={t("search.query_all")}
          options={[
            { value: "all", label: t("search.scope_all") },
            { value: "sessions", label: t("search.scope_sessions") },
            { value: "docs", label: t("search.scope_docs") },
          ]}
          onChange={changeScope}
        />
        {scope !== "docs" && (
          <div class="search-roles" role="group" aria-label={t("search.head_sessions")}>
            {ROLE_ORDER.map((role) => (
              <Chip key={role} active={roles.includes(role)} onClick={() => changeRole(role)}>
                {roleLabel(role)}
                {facetCount(role) > 0 ? <span class="hit-facet">{facetCount(role)}</span> : null}
              </Chip>
            ))}
          </div>
        )}
        <label class="search-here">
          <input type="checkbox" checked={sessionsHereOnly} onChange={(e) => changeHereOnly((e.target as HTMLInputElement).checked)} />
          {t("search.only_this_project")}
        </label>
      </div>

      {status === "error" && <div class="reply-error">{errorMsg}</div>}
      {res && <div class="search-index dim mono">{indexLine}</div>}
      {res && res.mode === "or" && <div class="dim search-note">{t("search.mode_or")}</div>}

      {res && scope !== "docs" && (
        <section class="search-block">
          <div class="search-block-head">
            <span>{t("search.head_sessions")}</span>
            <span class="dim">{hitsLabel(res.sessionTotal)}</span>
          </div>
          {res.sessionStatus === "unavailable" && <div class="dim search-status">{t("search.sessions_unavailable")}</div>}
          {groups.length === 0 && res.sessionStatus !== "unavailable" && <div class="ui-empty">{t("search.no_hits")}</div>}
          {groups.length > 0 && (
            <SessionHits
              groups={groups}
              currentSessionId={sessionId}
              onJumpToSeq={onJumpToSeq}
              onOpenSession={(id) => (window.location.hash = sessionHash(id))}
            />
          )}
          {res.sessionTotal > loaded && (
            <Button class="search-more" onClick={() => void request(query.trim(), loaded)}>
              {t("search.load_more")}
            </Button>
          )}
        </section>
      )}

      {res && scope !== "sessions" && (
        <section class="search-block">
          <div class="search-block-head">
            <span>{t("search.head_docs")}</span>
            <span class="dim">{hitsLabel(res.docs.length)}</span>
          </div>
          {res.docStatus === "indexing" && <div class="dim search-status">{t("search.doc_indexing")}</div>}
          {res.docStatus === "unavailable" && <div class="dim search-status">{t("search.doc_no_project")}</div>}
          {res.docStatus === "error" && <div class="dim search-status">{t("search.doc_error")}</div>}
          {res.docEngine === "local" && res.docs.length > 0 && (
            <div class="dim search-status">
              {t("search.fulltext_unavailable")} <span class="mono">{t("search.qmd")}</span> {t("search.not_installed")}
            </div>
          )}
          {res.docs.length === 0 && res.docStatus !== "indexing" && res.docStatus !== "unavailable" && res.docStatus !== "error" && (
            <div class="ui-empty">{t("search.no_hits")}</div>
          )}
          {res.docs.map((doc, i) => (
            <button key={`${doc.file}:${i}`} class="search-result-card" onClick={() => setViewing({ path: doc.file, snippet: doc.snippet })}>
              <div class="search-result-head">
                <span class="mono search-result-file">{doc.file}</span>
                <span class="dim">
                  {t("search.line")} {doc.line}
                </span>
              </div>
              <div class="search-result-title">{doc.title}</div>
              <Snippet snippet={doc.snippet} />
            </button>
          ))}
        </section>
      )}

      {res && scope !== "docs" && scope !== "sessions" && res.sessions.length === 0 && res.docs.length === 0 && status === "ready" && (
        <div class="ui-empty">{t("search.no_hits_any")}</div>
      )}

      <div class="doc-overview">
        <div class="doc-overview-head dim">
          {t("search.documents")} {docs === null ? "…" : `${docs.length}`}
        </div>
        {docs !== null && docs.length === 0 && <div class="ui-empty">{t("search.no_md")}</div>}
        {docs !== null &&
          groupDocs(docs).map((group) => (
            <div key={group.dir} class="doc-group">
              <div class="doc-group-dir mono dim">{dirLabel(group.dir)}</div>
              {group.items.map((doc) => (
                <button key={doc.path} type="button" class="doc-item" onClick={() => setViewing({ path: doc.path })}>
                  <span class="doc-item-name">{doc.title ?? docName(doc)}</span>
                  <span class="doc-item-path mono dim">{doc.path}</span>
                </button>
              ))}
            </div>
          ))}
      </div>

      {viewing && <DocViewer project={project} path={viewing.path} snippet={viewing.snippet} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * Strukturierte Dokumentansicht: gerendertes Markdown statt Code-Ansicht —
 * keine Zeilennummern, kein Syntax-Highlight (das hier ist Doku, nicht
 * Quelle). Aus einem Suchtreffer heraus wird der Abschnitt, der das
 * Snippet enthält, markiert und angesprungen.
 */
function DocViewer({ project, path, snippet, onClose }: { project: string; path: string; snippet?: string; onClose: () => void }) {
  const api = useApi();
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError("");
    api
      .searchFile(project, path)
      .then((f) => alive && setFile(f))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Dokument konnte nicht geladen werden"));
    return () => {
      alive = false;
    };
  }, [project, path]);

  // Erst nach dem Rendern: den Block suchen, der das Snippet enthält — der
  // Textkontext ist im DOM normalisiert (Whitespace kollabiert), weil
  // Markdown-Blöcke Zwischenräume beim Rendern verändern.
  useEffect(() => {
    if (!file || !snippet || !bodyRef.current) return;
    const anchor = snippetAnchor(snippet);
    if (!anchor) return;
    const norm = (s: string) => s.replace(/\s+/g, " ");
    const hit = [...bodyRef.current.querySelectorAll<HTMLElement>(".markdown > *")].find((el) =>
      norm(el.textContent ?? "").includes(anchor),
    );
    if (hit) {
      hit.classList.add("doc-hit");
      hit.scrollIntoView({ block: "center" });
    }
  }, [file, snippet]);

  // Ins <body>: Session-Stapelkontexte liegen unter dem festen Nyx-FAB —
  // ohne Portal blockiert der FAB „Schließen“ trotz höherem Overlay-z-index.
  return createPortal(
    <div class="file-viewer-overlay" onClick={onClose}>
      <div class="file-viewer" onClick={(e) => e.stopPropagation()}>
        <div class="file-viewer-head">
          <span class="mono">{path}</span>
          <Button onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
        <div class="file-viewer-body" ref={bodyRef}>
          {error && <div class="ui-empty">{error}</div>}
          {!error && !file && <div class="ui-empty">{t("common.loading")}</div>}
          {file && (
            <div class="doc-prose">
              <Markdown text={file.content} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

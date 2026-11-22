import type { FastifyInstance } from "fastify";
import { isProjectPathAllowed } from "@ancientvoid/core";
import {
  TranscriptQueryLimits,
  type DocSearchHit,
  type SearchIndexState,
  type SessionTextHit,
  type TranscriptRole,
  type UnifiedSearchResponse,
} from "@ancientvoid/contracts";
import {
  ensureIndexed,
  indexStatus,
  isQmdAvailable,
  listProjectDocs,
  readProjectFile,
  relativeDataDir,
  searchProject,
  searchProjectLocal,
} from "./search.ts";
import type { RouteContext } from "../../route-context.ts";

const ALL_ROLES: readonly TranscriptRole[] = ["user", "assistant", "thinking", "tool", "system"];

/** Rollen aus einem Query-Parameter. Unbekannte Namen fallen weg — ein
 * Tippfehler soll weder eine 500 erzeugen noch heimlich die ganze Liste
 * öffnen. */
export function parseRoles(raw: string | undefined): TranscriptRole[] | undefined {
  if (!raw) return undefined;
  const picked = raw
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is TranscriptRole => ALL_ROLES.includes(r as TranscriptRole));
  return picked.length ? picked : undefined;
}

function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.trunc(n), max) : fallback;
}

/** Local project search over qmd (T3.8) plus the hub-wide session-text
 * search (Nachschärfe 2026-11-22). */
export function registerSearchRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, indexingInFlight } = ctx;

  // T3.8 (EPIC-P3 §3 "Sprachsuche"): read-class, no approval needed — a
  // search never changes anything. All three routes validate `project`
  // against projectRoots exactly like session creation does (T1.5-4).
  app.get("/api/search/status", async (req, reply) => {
    const { project } = req.query as { project?: string };
    if (!project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    return indexStatus(project);
  });


  app.get("/api/search", async (req, reply) => {
    const { project, q } = req.query as { project?: string; q?: string };
    if (!project || !q) return reply.code(400).send({ error: "project and q query params required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // BUG (Suche, 2026-11-22): ohne qmd war die Suchansicht bisher tot (501).
    // Die Dokumente liegen im Projekt — der lokale Durchlauf findet sie auch
    // ohne CLI, und `engine:"local"` sagt ehrlich, welche Stufe geantwortet hat.
    const excludeRelDirs = deps.dataDir ? [relativeDataDir(project, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
    if (!(await isQmdAvailable())) {
      return { status: "ready", engine: "local", results: await searchProjectLocal(project, q, 8, excludeRelDirs) };
    }
    const status = await indexStatus(project);
    if (!status.indexed) {
      if (!indexingInFlight.has(project)) {
        const job = ensureIndexed(project).finally(() => indexingInFlight.delete(project));
        indexingInFlight.set(project, job);
        job.catch((err) => req.log.error({ err, project }, "search index build failed"));
      }
      return reply.code(202).send({ status: "indexing", results: [] });
    }
    try {
      // BUG-0014: exclude the hub's own dataDir (worktree copies of every
      // real markdown file) when it happens to live inside the searched
      // project — a real, ordinary setup, not a contrived edge case.
      const results = await searchProject(project, q, 5, excludeRelDirs);
      return { status: "ready", engine: "qmd", results };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "search failed" });
    }
  });

  /** Sessiontexte: Fragen, Antworten, Denk- und Werkzeugspuren — hub-weit,
   * nicht project-gebunden. Braucht kein qmd (eigener FTS5-Index, K7:
   * ableitbar aus JSONL + Blobs). */
  app.get("/api/search/transcript", async (req, reply) => {
    const p = req.query as { q?: string; limit?: string; offset?: string; roles?: string; project?: string; projectUnder?: string; session?: string };
    const q = p.q?.trim() ?? "";
    if (!q) return reply.code(400).send({ error: "q query param required" });
    if (q.length > TranscriptQueryLimits.maxChars) return reply.code(400).send({ error: `q is longer than ${TranscriptQueryLimits.maxChars} characters` });
    if ((p.project || p.projectUnder) && !(await isProjectPathAllowed(p.project ?? p.projectUnder!, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    if (!deps.search) return reply.code(501).send({ error: "session-text search is not wired on this hub" });
    await deps.search.transcript.refreshIfStale(2_000);
    const roles = parseRoles(p.roles);
    const res = await deps.search.transcript.search({
      q,
      limit: clampInt(p.limit, TranscriptQueryLimits.defaultLimit, TranscriptQueryLimits.maxLimit),
      offset: clampInt(p.offset, 0, 100_000),
      ...(roles ? { roles } : {}),
      ...(p.project ? { project: p.project } : {}),
      ...(p.projectUnder ? { projectRoot: p.projectUnder } : {}),
      ...(p.session ? { sessionId: p.session } : {}),
    });
    return { status: "ready", query: q, mode: res.mode, index: res.index, hits: res.hits, total: res.total, facets: res.facets };
  });

  /** Ein Suchfeld, beide Körper in einer Antwort — die PWA muss nicht zweimal
   * warten und die Zahlen der beiden Bereiche passen zueinander. */
  app.get("/api/search/all", async (req, reply) => {
    const p = req.query as { q?: string; project?: string; scope?: string; roles?: string; limit?: string; offset?: string; session?: string };
    const q = p.q?.trim() ?? "";
    if (!q) return reply.code(400).send({ error: "q query param required" });
    if (q.length > TranscriptQueryLimits.maxChars) return reply.code(400).send({ error: `q is longer than ${TranscriptQueryLimits.maxChars} characters` });
    const scope = p.scope === "docs" || p.scope === "sessions" ? p.scope : "all";
    if (p.project && !(await isProjectPathAllowed(p.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const limit = clampInt(p.limit, TranscriptQueryLimits.defaultLimit, TranscriptQueryLimits.maxLimit);
    const offset = clampInt(p.offset, 0, 100_000);
    const roles = p.roles ? parseRoles(p.roles) : undefined;

    let sessions: SessionTextHit[] = [];
    let sessionTotal = 0;
    let facets: { role: TranscriptRole; count: number }[] = [];
    let mode: "and" | "or" = "and";
    let sessionStatus: "ready" | "unavailable" = "unavailable";
    let index: SearchIndexState = { engine: "scan", sessions: 0, lines: 0, indexedAt: null };
    if (scope !== "docs" && deps.search) {
      await deps.search.transcript.refreshIfStale(2_000);
      const res = await deps.search.transcript.search({
        q,
        limit,
        offset,
        ...(roles ? { roles } : {}),
        ...(p.project ? { project: p.project } : {}),
        ...(p.session ? { sessionId: p.session } : {}),
      });
      sessions = res.hits;
      sessionTotal = res.total;
      facets = res.facets;
      mode = res.mode;
      sessionStatus = "ready";
      index = res.index;
    }

    let docs: DocSearchHit[] = [];
    let docStatus: "ready" | "indexing" | "unavailable" | "skipped" | "error" = "skipped";
    let docEngine: "qmd" | "local" | "none" = "none";
    if (scope !== "sessions") {
      const project = p.project;
      if (!project) {
        docStatus = "unavailable";
      } else {
        const excludeRelDirs = deps.dataDir ? [relativeDataDir(project, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
        if (!(await isQmdAvailable())) {
          docs = await searchProjectLocal(project, q, limit, excludeRelDirs);
          docEngine = "local";
          docStatus = "ready";
        } else {
          const status = await indexStatus(project);
          if (!status.indexed) {
            if (!indexingInFlight.has(project)) {
              const job = ensureIndexed(project).finally(() => indexingInFlight.delete(project));
              indexingInFlight.set(project, job);
              job.catch((err) => req.log.error({ err, project }, "search index build failed"));
            }
            docStatus = "indexing";
          } else {
            try {
              docs = await searchProject(project, q, limit, excludeRelDirs);
              docEngine = "qmd";
              docStatus = "ready";
            } catch (err) {
              req.log.error({ err, project }, "search failed");
              docStatus = "error";
            }
          }
        }
      }
    }

    return {
      status: "ready",
      query: q,
      mode,
      scope,
      sessions,
      sessionTotal,
      facets,
      index,
      sessionStatus,
      docs,
      docTotal: docs.length,
      docEngine,
      docStatus,
    } satisfies UnifiedSearchResponse;
  });


  app.get("/api/search/file", async (req, reply) => {
    const { project, path } = req.query as { project?: string; path?: string };
    if (!project || !path) return reply.code(400).send({ error: "project and path query params required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const file = await readProjectFile(project, path);
    if (!file) return reply.code(404).send({ error: "file not found, not a regular file, or outside the project" });
    return file;
  });

  // Dokumentübersicht der Suchansicht: alle Markdown-Dateien des Projekts,
  // ohne qmd (nur Dateisystem) — read-class wie die Suche selbst.
  app.get("/api/search/docs", async (req, reply) => {
    const { project } = req.query as { project?: string };
    if (!project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // BUG-0014: gleiche dataDir-Aussparung wie die Suche — Worktree-Kopien
    // sind keine eigenen Dokumente.
    const excludeRelDirs = deps.dataDir ? [relativeDataDir(project, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
    return { docs: await listProjectDocs(project, excludeRelDirs) };
  });
}

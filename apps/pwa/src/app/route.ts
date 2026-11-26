/** Hash routes for the same session after reload (AC-P5-5), per host (EPIC-P6).
 * `seq` hängt eine Fundstelle an: `#/sessions/<id>/seq/474` öffnet die Sitzung und
 * springt an diese Nachricht — der Weg aus der Suche und aus dem Sitzungsfilter. */
export function sessionHash(sessionId: string, hostId?: string | null, seq?: number | null): string {
  const session = `sessions/${encodeURIComponent(sessionId)}${seq !== undefined && seq !== null ? `/seq/${seq}` : ""}`;
  return hostId ? `#/hosts/${encodeURIComponent(hostId)}/${session}` : `#/${session}`;
}

/** T7.6: a line in a session's worktree — `…/code/<path>:L<line>`. */
export function codeHash(sessionId: string, path: string, line: number | null, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/code/${path.split("/").map(encodeURIComponent).join("/")}${line ? `:L${line}` : ""}`;
}

/** EPIC-P48: Repo-Graph der Session im Chat-Fenster — `…/graph`. */
export function graphHash(sessionId: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/graph`;
}

/** EPIC-P48: eine Datei der Session im Datei-Tab des Chat-Fensters — `…/datei/<path>`. */
export function fileHash(sessionId: string, path: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/datei/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** EPIC-P39 T39.3-Rest: Browser-Arbeitsplatz der Session als eigenes Fenster — `…/browser`. */
export function browserHash(sessionId: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/browser`;
}

/**
 * Ein Anhang (Bild, Datei) als eigenes Fenster — `#/anhang/<id>`. Der Link ist das,
 * was ein Agent zu einem Bild mitschickt: er oeffnet die Ansicht direkt, das Geraet
 * authentisiert sich mit seinem eigenen Token (der Token steckt nie in der URL).
 */
export function attachmentHash(attachmentId: string): string {
  return `#/anhang/${encodeURIComponent(attachmentId)}`;
}

/** Dasselbe innerhalb der Session — `…/anhang/<id>`; Zurueck fuehrt zurueck in die Session. */
export function sessionAttachmentHash(sessionId: string, attachmentId: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/anhang/${encodeURIComponent(attachmentId)}`;
}

/** EPIC-P42: Android-Testgeräte als eigenes Fenster — `#/geraete` (host-scoped, ohne Session). */
export function devicesHash(): string {
  return "#/geraete";
}

/** BUG-0128: die Datei-Seitenleiste (Baum + offene Dateien) als genau ein eigenes Fenster — `#/dateibaum`. */
export function filetreeHash(): string {
  return "#/dateibaum";
}

/** EPIC-P49: eine Vault-Datei als eigene Seite/Fenster — `#/notizen/datei/<path>`. */
export function vaultFileHash(path: string): string {
  return `#/notizen/datei/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** BUG-0257: der Metrik-/Inferenz-Reiter der Analyse-Seite — `#/statistik/<tab>`. */
export function statTabHash(tab: "hosts" | "metriken" | "inferenz" | "evaluation"): string {
  return `#/statistik/${tab}`;
}

/** EPIC-P74 T74.6: der Wissen-Tab im Notizen-Bereich — `#/notizen/wissen`. */
export function vaultKnowledgeHash(): string {
  return "#/notizen/wissen";
}


export interface CodeTarget {
  path: string;
  line: number | null;
}

/** Tabs, die eine eigene Hash-Route haben (EPIC-P48 / ADR-0071) — `datei` trägt den Pfad in `file`. */
export type TailTab = "graph" | "git" | "datei";

/** T8.1: every page has a URL, so Back in the browser goes back.
 * EPIC-P47 §3.4: `discovery` ist kein Page mehr — `#/gefunden` bleibt als Alias auf die
 * Übersicht (die schaltet dort auf den Discovery-Zustand); Dashboards `FOUND_HASH_ALIAS`.
 * EPIC-P60 (ADR-0077): `orchestrierung` hieß `teams` (ehemals `runs`);
 * EPIC-P83 (ADR-0123): die Fläche heißt `swarms`, Slug `#/swarms`.
 * `#/teams` wird ab T83.3 die Fläche der Menschen-Teams (neu `?id=`). */
export type ListPage = "dashboard" | "new" | "settings" | "approvals" | "status" | "media" | "pc" | "vault" | "swarms" | "automationen" | "statistics" | "terminal" | "releasenotes" | "pentest";
export const FOUND_HASH_ALIAS = "#/gefunden";
// EPIC-P62 T62.1: exportiert — der Guide-Inventar-Test (AC-P62-1) macht
// jede neue Seite ohne docs/guide/inventory.md-Zeile rot.
export const PAGE_SLUG: Record<ListPage, string> = { dashboard: "", new: "neu", settings: "einstellungen", approvals: "freigaben", status: "status", media: "medien", pc: "pc", vault: "notizen", swarms: "swarms", automationen: "automationen", statistics: "statistik", terminal: "terminal", releasenotes: "releasenotes", pentest: "pentest" };

/** EPIC-P34 T34.2: Seiten, die am Desktop die Detailspalte füllen. Übersicht, Neu und Freigaben bleiben in der Liste (K1-Weg). */
export const TOOL_PAGE_IDS = ["settings", "media", "pc", "status", "vault", "swarms", "automationen", "statistics", "terminal", "releasenotes", "pentest"] as const;
export type ToolPageId = (typeof TOOL_PAGE_IDS)[number];
const TOOL_PAGES: ReadonlySet<ListPage> = new Set<ListPage>(TOOL_PAGE_IDS);

export function isToolPage(page: ListPage): page is ToolPageId {
  return TOOL_PAGES.has(page);
}

export function pageHash(page: ListPage): string {
  return `#/${PAGE_SLUG[page]}`;
}

/** EPIC-P60 (ADR-0077, AC-P60-1) / EPIC-P83 (ADR-0123 §5): alte Run- und
 * Team-Links permanent auf Swarm-Links umleiten — `#/runs…` und `#/teams…`
 * → `#/swarms…`, Query-Schlüssel `?run=`/`?team=` → `?swarm=`
 * (`?host=` und alles andere bleibt). null = kein Altlink. */
export function redirectLegacyRunHash(hash: string): string | null {
  if (!/^#\/(runs|teams)/.test(hash)) return null;
  return hash.replace(/^#\/(runs|teams)/, "#/swarms").replace(/([?&])(run|team)=/, "$1swarm=");
}

/** BUG-0257: alte Links der drei Einzelseiten leiten permanent auf die
 * Tabs der einen Analyse-Seite um (`#/metriken…` → `#/statistik/metriken`,
 * `#/inferenz…` → `#/statistik/inferenz`). null = kein Altlink. */
export function redirectLegacyStatHash(hash: string): string | null {
  const hit = /^#\/(metriken|inferenz)\/?/.exec(hash);
  return hit ? `#/statistik/${hit[1]}` : null;
}

export type AppRoute =
  | { view: "list"; page: ListPage; vaultFile?: string; vaultTab?: "wissen"; statTab?: "hosts" | "metriken" | "inferenz" | "evaluation" }
  | { view: "tail"; sessionId: string; hostId?: string; code?: CodeTarget; tab?: TailTab; file?: string; browser?: true; attachment?: string; seq?: number }
  | { view: "attachment"; attachmentId: string }
  | { view: "devices" }
  | { view: "filetree" };

function codeTarget(raw: string | undefined): CodeTarget | undefined {
  if (!raw) return undefined;
  const m = /^(.+?)(?::L(\d+))?$/.exec(raw);
  if (!m?.[1]) return undefined;
  const path = m[1].split("/").map(decodeURIComponent).join("/");
  return { path, line: m[2] ? Number(m[2]) : null };
}

function fileTarget(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.split("/").map(decodeURIComponent).join("/");
}

export function parseAppHash(hash: string): AppRoute {
  // EPIC-P42: Geräte-Fenster ist host-scoped — vor dem Slug-Match prüfen.
  if (/^#\/geraete\/?$/.test(hash)) return { view: "devices" };
  // BUG-0128: Fenster-Route der Datei-Seitenleiste — vor dem Slug-Match prüfen.
  if (/^#\/dateibaum\/?$/.test(hash)) return { view: "filetree" };
  // BUG-0257: Reiter der Analyse-Seite vor dem Slug-Match prüfen (Pfad-Segmente!).
  const statTab = /^#\/statistik\/(hosts|metriken|inferenz|evaluation)(?:\/[^/]*)?\/?$/.exec(hash);
  if (statTab?.[1]) return { view: "list", page: "statistics", statTab: statTab[1] as "hosts" | "metriken" | "inferenz" | "evaluation" };
  // BUG-0257: unbekannter Reiter unter #/statistik/… fällt auf die Seite selbst zurück.
  if (/^#\/statistik(\/|$)/.test(hash)) return { view: "list", page: "statistics" };
  // EPIC-P74 T74.6 / BUG-0275: Wissen-Tab vor den Datei- und Slug-Matches
  // prüfen (1ce6cf1f hatte den Zweig versehentlich entfernt).
  if (/^#\/notizen\/wissen\/?$/.test(hash)) return { view: "list", page: "vault", vaultTab: "wissen" };
  const vaultFile = /^#\/notizen\/datei\/(.+)$/.exec(hash);
  if (vaultFile?.[1]) return { view: "list", page: "vault", vaultFile: vaultFile[1].split("/").map(decodeURIComponent).join("/") };
  // EPIC-P60/P83: Query-Hashes (Slug-Regex greift dort nicht) — `#/swarms?swarm=…` neu,
  // `#/teams?…` und `#/runs?…` bleiben als Alias vor dem Redirect (parse sicherheitshalber).
  if (/^#\/swarms\?/.test(hash)) return { view: "list", page: "swarms" };
  if (/^#\/teams\?/.test(hash)) return { view: "list", page: "swarms" };
  if (/^#\/runs\?/.test(hash)) return { view: "list", page: "swarms" };
  // Ein Anhang als eigenes Fenster — vor dem Slug-Match (der Slug-Regex traegt keine Pfade).
  const anhang = /^#\/anhang\/([^/?#]+)\/?$/.exec(hash);
  if (anhang?.[1]) return { view: "attachment", attachmentId: decodeURIComponent(anhang[1]) };
  const slug = /^#\/([a-z]*)\/?$/.exec(hash || "#/")?.[1];
  if (slug !== undefined) {
    const page = (Object.keys(PAGE_SLUG) as ListPage[]).find((p) => PAGE_SLUG[p] === slug);
    return { view: "list", page: page ?? "dashboard" };
  }
  const hosted = /^#\/hosts\/([^/?#]+)\/sessions\/([^/?#]+)(?:\/code\/(.+))?(?:\/(graph|git|datei)(?:\/(.+))?)?(?:\/anhang\/([^/?#]+))?(\/browser)?(?:\/seq\/(\d+))?$/.exec(hash);
  if (hosted?.[1] && hosted[2]) {
    const code = codeTarget(hosted[3]);
    const file = hosted[4] === "datei" ? fileTarget(hosted[5]) : undefined;
    return {
      view: "tail",
      hostId: decodeURIComponent(hosted[1]),
      sessionId: decodeURIComponent(hosted[2]),
      ...(code ? { code } : {}),
      ...(hosted[4] === "graph" || hosted[4] === "git" ? { tab: hosted[4] as TailTab } : {}),
      ...(file !== undefined ? { tab: "datei" as const, file } : {}),
      ...(hosted[6] !== undefined ? { attachment: decodeURIComponent(hosted[6]) } : {}),
      ...(hosted[7] ? { browser: true as const } : {}),
      ...(hosted[8] ? { seq: Number(hosted[8]) } : {}),
    };
  }
  const match = /^#\/sessions\/([^/?#]+)(?:\/code\/(.+))?(?:\/(graph|git|datei)(?:\/(.+))?)?(?:\/anhang\/([^/?#]+))?(\/browser)?(?:\/seq\/(\d+))?$/.exec(hash);
  const raw = match?.[1];
  if (!raw) return { view: "list", page: "dashboard" };
  const code = codeTarget(match[2]);
  const file = match[3] === "datei" ? fileTarget(match[4]) : undefined;
  return {
    view: "tail",
    sessionId: decodeURIComponent(raw),
    ...(code ? { code } : {}),
    ...(match[3] === "graph" || match[3] === "git" ? { tab: match[3] as TailTab } : {}),
    ...(file !== undefined ? { tab: "datei" as const, file } : {}),
    ...(match[5] !== undefined ? { attachment: decodeURIComponent(match[5]) } : {}),
    ...(match[6] ? { browser: true as const } : {}),
    ...(match[7] ? { seq: Number(match[7]) } : {}),
  };
}

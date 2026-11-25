import { codeHash, fileHash, sessionHash, pageHash, PAGE_SLUG, type CodeTarget, type ListPage } from "../../app/route.ts";

const SESSION_TABS = ["chat", "verlauf", "bericht", "diff", "graph", "git", "datei", "forge", "suche", "code", "umgebung"] as const;
export type SessionTab = (typeof SESSION_TABS)[number];
export type WorkspaceContent =
  | { kind: "page"; page: Exclude<ListPage, "dashboard">; vaultFile?: string; vaultTab?: "wissen"; statTab?: "hosts" | "metriken" | "inferenz"; hash?: string }
  /** `seq`: Fundstelle, an der die Sitzung aufgehen soll (Sitzungsfilter/Suche);
   * `seqAt` macht dieselbe Fundstelle als *neue* Bitte erkennbar — sonst fällt der
   * zweite Tipp auf dieselbe Karte stumm aus. */
  | { kind: "session"; tab: SessionTab; file?: string; code?: CodeTarget; seq?: number; seqAt?: number }
  | { kind: "file"; target: string; path: string; sha?: string }
  | { kind: "search" }
  | { kind: "browser" }
  | { kind: "devices" };

/** Stored UI preferences are untrusted; unknown targets never turn into blank cards. */
export function parseContent(raw: unknown): WorkspaceContent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const str = (key: string) => typeof c[key] === "string" ? c[key] as string : undefined;
  if (c.kind === "page" && typeof c.page === "string" && c.page !== "dashboard" && Object.hasOwn(PAGE_SLUG, c.page)) {
    return { kind: "page", page: c.page as Exclude<ListPage, "dashboard">, ...(str("vaultFile") ? { vaultFile: str("vaultFile")! } : {}), ...(c.vaultTab === "wissen" ? { vaultTab: "wissen" } : {}), ...(str("hash")?.startsWith("#/") ? { hash: str("hash")! } : {}) };
  }
  if (c.kind === "session" && SESSION_TABS.includes(c.tab as SessionTab)) {
    const code = c.code as CodeTarget | undefined;
    const seq = typeof c.seq === "number" && Number.isInteger(c.seq) && c.seq >= 0 ? c.seq : undefined;
    const seqAt = typeof c.seqAt === "number" && Number.isFinite(c.seqAt) ? c.seqAt : undefined;
    return { kind: "session", tab: c.tab as SessionTab, ...(str("file") ? { file: str("file")! } : {}), ...(code && typeof code.path === "string" && (code.line === null || Number.isInteger(code.line)) ? { code: { path: code.path, line: code.line } } : {}), ...(seq !== undefined ? { seq, ...(seqAt !== undefined ? { seqAt } : {}) } : {}) };
  }
  if (c.kind === "file" && str("target") && str("path")) return { kind: "file", target: str("target")!, path: str("path")!, ...(str("sha") ? { sha: str("sha")! } : {}) };
  if (c.kind === "search" || c.kind === "browser" || c.kind === "devices") return { kind: c.kind };
  return undefined;
}

/** Only routes that can reconstruct this exact view are written to the address bar. */
export function contentHash(ref: import("./tiles.ts").TileRef | null | undefined): string {
  if (!ref) return "#/";
  const content = ref.content;
  if (content?.kind === "page") return content.hash ?? pageHash(content.page);
  if (content && content.kind !== "session") return "#/";
  if (content?.kind === "session") {
    if (content.code) return codeHash(ref.sessionId, content.code.path, content.code.line, ref.hostId);
    if (content.tab === "datei" && content.file) return fileHash(ref.sessionId, content.file, ref.hostId);
    if (content.tab === "graph" || content.tab === "git") return `${sessionHash(ref.sessionId, ref.hostId)}/${content.tab}`;
    if (content.tab !== "chat" && content.tab !== "verlauf") return "#/";
  }
  return sessionHash(ref.sessionId, ref.hostId);
}

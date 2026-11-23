import { browserHash, devicesHash, fileHash, filetreeHash, graphHash, isToolPage, pageHash, sessionHash, TOOL_PAGE_IDS, vaultFileHash, type ToolPageId } from "../../app/route.ts";
import type { TileRef } from "../workspace/tiles.ts";

/**
 * EPIC-P34 T34.10 (ADR-0053): Abstimmung zwischen dem Hauptfenster und eigenen Fenstern über
 * `BroadcastChannel("ancientvoid.windows")`. Reine Daten und Regeln; Kanal und Fenster stehen in `windows.ts`
 * und `PopoutShell.tsx`. Das Hauptfenster ist optional: Fenster laufen allein weiter und melden sich auf `ping` neu.
 */
export const WINDOW_CHANNEL = "ancientvoid.windows";
export const HEARTBEAT_MS = 3000;
/** Zwei verpasste Herzschläge plus Puffer. */
export const WINDOW_TTL_MS = 10_000;

/** EPIC-P43 T43.7 (ADR-0068): Ansichten einer Session, je als eigenes Fenster. */
export const SESSION_VIEW_KINDS = ["changes", "files", "report", "forge", "search", "environment"] as const;
export type SessionViewKind = (typeof SESSION_VIEW_KINDS)[number];
/** Der Reiter in `SessionTail`, den ein Ansichtsfenster zeigt. */
export const VIEW_TAB = { changes: "diff", files: "code", report: "bericht", forge: "forge", search: "suche", environment: "umgebung" } as const satisfies Record<SessionViewKind, string>;
export type ViewTab = (typeof VIEW_TAB)[SessionViewKind];
export const VIEW_LABEL: Record<SessionViewKind, string> = { changes: "Änderungen", files: "Befehle", report: "Bericht", forge: "GitLab", search: "Suche", environment: "Umgebung" };
export function viewKindOfTab(tab: string): SessionViewKind | null {
  return SESSION_VIEW_KINDS.find((k) => VIEW_TAB[k] === tab) ?? null;
}
const isViewKind = (k: unknown): k is SessionViewKind => (SESSION_VIEW_KINDS as readonly unknown[]).includes(k);

export type WindowTarget =
  | { kind: "session"; sessionId: string; hostId?: string }
  | { kind: SessionViewKind; sessionId: string; hostId?: string }
  | { kind: "queue" }
  | { kind: "nyx" }
  | { kind: "tool"; page: ToolPageId }
  | { kind: "graph"; sessionId: string; hostId?: string }
  | { kind: "file"; sessionId: string; path: string; hostId?: string }
  | { kind: "vault"; path?: string }
  | { kind: "browser"; sessionId: string; hostId?: string }
  | { kind: "device" }
  /** BUG-0128: die rechte Datei-Seitenleiste als Ganzes — Baum und alle offenen Dateien in genau einem Fenster. */
  | { kind: "filetree" };

export type WindowMessage =
  | { type: "hello"; id: string; target: WindowTarget }
  | { type: "heartbeat"; id: string }
  /** BUG-0245: `target` optional — alte Fenster ohne Feld bleiben gültig; mit Target kann das Hauptfenster `detached` aufräumen. */
  | { type: "bye"; id: string; target?: WindowTarget }
  | { type: "focus"; id: string }
  | { type: "return"; id: string; target: WindowTarget }
  /** ADR-0068: das Hauptfenster bittet ein Fenster, sich zurückzugeben (es antwortet mit `return` und schließt sich). */
  | { type: "recall"; id: string }
  /** Das Hauptfenster (neu gestartet) bittet alle Fenster, sich zu melden. */
  | { type: "ping" };

export interface WindowEntry {
  id: string;
  target: WindowTarget;
  lastSeen: number;
}
export type WindowRegistry = Record<string, WindowEntry>;

export function targetKey(target: WindowTarget): string {
  if (target.kind === "tool") return `tool:${target.page}`;
  if (target.kind === "vault") return `vault:${target.path ?? ""}`;
  if (target.kind === "filetree") return "filetree";
  if (target.kind === "device") return "device";
  if (target.kind === "queue") return "queue";
  if (target.kind === "nyx") return "nyx";
  const host = target.hostId ?? "";
  if (isViewKind(target.kind)) return `${target.kind}:${host}|${target.sessionId}`;
  if (target.kind === "browser") return `browser:${host}|${target.sessionId}`;
  if (target.kind === "graph") return `graph:${host}|${target.sessionId}`;
  if (target.kind === "file") return `file:${host}|${target.sessionId}|${target.path}`;
  return `session:${host}|${target.sessionId}`;
}

/** BUG-0245: stabiler Browsing-Context-Name — zweites `window.open` mit demselben Namen hebt das bestehende Fenster statt eines Duplikats. */
export function windowName(target: WindowTarget): string {
  return `av_${targetKey(target).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * BUG-0262: das Fensterziel einer Kachel. Nur Session-Kacheln sind Session-Fenster — Seiten-Kacheln
 * tragen `sessionId: ""`; als Session gelöst wäre `#/sessions/` keine Route und das Fenster zeigte
 * „Dieses Fenster hat kein Ziel.". null = keine Fensteradresse (Neu, Suche, Datei-Karte): die
 * Kachel löst sich dann gar nicht ab, statt in ein kaputtes Fenster zu wandern.
 */
export function tileWindowTarget(ref: TileRef): WindowTarget | null {
  const host = ref.hostId ? { hostId: ref.hostId } : {};
  const content = ref.content;
  if (!content || content.kind === "session") return { kind: "session", sessionId: ref.sessionId, ...host };
  if (content.kind === "page") {
    // Vault rundet anders als die anderen Werkzeugseiten: `#/notizen` parst im Fenster als
    // { kind: "vault" } zurück — nur als Vault gelöst, matcht das `hello` des Fensters den
    // Öffner-Schlüssel und die Kachel löst sich wirklich ab.
    if (content.page === "vault") return { kind: "vault", ...(content.vaultFile ? { path: content.vaultFile } : {}) };
    return isToolPage(content.page) ? { kind: "tool", page: content.page } : null;
  }
  if (content.kind === "browser") return ref.sessionId ? { kind: "browser", sessionId: ref.sessionId, ...host } : null;
  if (content.kind === "devices") return { kind: "device" };
  return null;
}

/** Das Token steht nie in der URL — es liegt im gemeinsamen localStorage. */
export function popoutUrl(target: WindowTarget): string {
  if (target.kind === "tool") return `/?window=1${pageHash(target.page)}`;
  if (target.kind === "filetree") return `/?window=1${filetreeHash()}`;
  if (target.kind === "graph") return `/?window=1${graphHash(target.sessionId, target.hostId)}`;
  if (target.kind === "file") return `/?window=1${fileHash(target.sessionId, target.path, target.hostId)}`;
  if (target.kind === "vault") return `/?window=1${target.path ? vaultFileHash(target.path) : pageHash("vault")}`;
  if (target.kind === "browser") return `/?window=1${browserHash(target.sessionId, target.hostId)}`;
  if (target.kind === "device") return `/?window=1${devicesHash()}`;
  if (target.kind === "queue") return `/?window=1&view=queue${pageHash("dashboard")}`;
  if (target.kind === "nyx") return `/?window=1&view=nyx${pageHash("dashboard")}`;
  if (isViewKind(target.kind)) return `/?window=1&view=${target.kind}${sessionHash(target.sessionId, target.hostId)}`;
  return `/?window=1${sessionHash(target.sessionId, target.hostId)}`;
}

function parseTarget(raw: unknown): WindowTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { kind?: unknown; sessionId?: unknown; hostId?: unknown; page?: unknown; path?: unknown };
  if (t.kind === "tool") return (TOOL_PAGE_IDS as readonly unknown[]).includes(t.page) ? { kind: "tool", page: t.page as ToolPageId } : null;
  if (t.kind === "session" && typeof t.sessionId === "string" && t.sessionId) {
    return typeof t.hostId === "string" && t.hostId ? { kind: "session", sessionId: t.sessionId, hostId: t.hostId } : { kind: "session", sessionId: t.sessionId };
  }
  if (t.kind === "graph" && typeof t.sessionId === "string" && t.sessionId) {
    return typeof t.hostId === "string" && t.hostId ? { kind: "graph", sessionId: t.sessionId, hostId: t.hostId } : { kind: "graph", sessionId: t.sessionId };
  }
  if (t.kind === "file" && typeof t.sessionId === "string" && t.sessionId && typeof t.path === "string" && t.path) {
    return typeof t.hostId === "string" && t.hostId ? { kind: "file", sessionId: t.sessionId, path: t.path, hostId: t.hostId } : { kind: "file", sessionId: t.sessionId, path: t.path };
  }
  if (t.kind === "vault") {
    return typeof t.path === "string" && t.path ? { kind: "vault", path: t.path } : { kind: "vault" };
  }
  if (t.kind === "filetree") return { kind: "filetree" };
  if (t.kind === "device") return { kind: "device" };
  if (t.kind === "queue") return { kind: "queue" };
  if (t.kind === "nyx") return { kind: "nyx" };
  if (isViewKind(t.kind) && typeof t.sessionId === "string" && t.sessionId) {
    return typeof t.hostId === "string" && t.hostId ? { kind: t.kind, sessionId: t.sessionId, hostId: t.hostId } : { kind: t.kind, sessionId: t.sessionId };
  }
  if (t.kind === "browser" && typeof t.sessionId === "string" && t.sessionId) {
    return typeof t.hostId === "string" && t.hostId ? { kind: "browser", sessionId: t.sessionId, hostId: t.hostId } : { kind: "browser", sessionId: t.sessionId };
  }
  return null;
}

/** Nachrichten kommen aus einem Kanal, den jede Seite des Ursprungs beschreiben kann: nichts ungeprüft annehmen. */
export function parseWindowMessage(raw: unknown): WindowMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { type?: unknown; id?: unknown; target?: unknown };
  if (m.type === "ping") return { type: "ping" };
  if (typeof m.id !== "string" || !m.id) return null;
  if (m.type === "heartbeat" || m.type === "focus" || m.type === "recall") return { type: m.type, id: m.id };
  if (m.type === "bye") {
    const target = m.target !== undefined ? parseTarget(m.target) : undefined;
    if (m.target !== undefined && !target) return null;
    return target ? { type: "bye", id: m.id, target } : { type: "bye", id: m.id };
  }
  if (m.type === "hello" || m.type === "return") {
    const target = parseTarget(m.target);
    return target ? { type: m.type, id: m.id, target } : null;
  }
  return null;
}

export function applyWindowMessage(reg: WindowRegistry, msg: WindowMessage, now: number): WindowRegistry {
  switch (msg.type) {
    case "hello": {
      // Ein Fenster je Ziel: ein Reload meldet sich mit neuer ID und ersetzt das alte.
      const next: WindowRegistry = Object.fromEntries(Object.entries(reg).filter(([, e]) => targetKey(e.target) !== targetKey(msg.target)));
      next[msg.id] = { id: msg.id, target: msg.target, lastSeen: now };
      return next;
    }
    case "heartbeat":
      // Ohne hello unbekannt: kein Phantomfenster aus einem verspäteten Herzschlag.
      return reg[msg.id] ? { ...reg, [msg.id]: { ...reg[msg.id]!, lastSeen: now } } : reg;
    case "bye":
    case "return": {
      const { [msg.id]: _gone, ...rest } = reg;
      return rest;
    }
    default:
      return reg;
  }
}

export function pruneWindows(reg: WindowRegistry, now: number): WindowRegistry {
  return Object.fromEntries(Object.entries(reg).filter(([, e]) => now - e.lastSeen <= WINDOW_TTL_MS));
}

export function windowFor(reg: WindowRegistry, target: WindowTarget): WindowEntry | null {
  return Object.values(reg).find((e) => targetKey(e.target) === targetKey(target)) ?? null;
}

import { t, matchForms } from "../../shared/i18n/index.ts";
import type { ListPage } from "../../app/route.ts";
import { projectName } from "../../shared/project-name.ts";

/**
 * EPIC-P43 T43.6: Schnellsuche im Befehlsfeld — Springen zu Sessions, Projekten, Dateien, Werkzeugen und
 * Befehlen. Kein eigener Index: Sessions und Projekte sind die Listen, die die App ohnehin lädt; „Dateien“
 * ist die bestehende Codesuche der offenen Session. Reine Funktion, damit Reihenfolge und Treffer testbar sind.
 * EPIC-P51 T51.11: bewusste Grenze — Sprungziele unterhalb der Werkzeug-/Session-Ebene (einzelne Notizen,
 * Graph/Galaxie, Host-Detail) sind keine eigenen Treffer; sie liegen einen Sprung + einen Tap entfernt
 * (dokumentiert im Funktionsinventar G64).
 */
export type QuickKind = "session" | "projekt" | "datei" | "werkzeug" | "befehl" | "quelle" | "statusnotiz";

export type QuickTarget =
  | { kind: "quelle"; hash: string; view?: "forge" }
  | { kind: "statusnotiz"; sessionId: string; hostId: string | null }
  | { kind: "session"; sessionId: string; hostId: string | null }
  | { kind: "projekt"; path: string }
  | { kind: "datei"; sessionId: string; hostId: string | null; text: string }
  /** `hash` setzt den Ziel-Hash direkt — für Aliase wie `#/gefunden` (EPIC-P47 §3.4). */
  | { kind: "werkzeug"; page: ListPage; hash?: string }
  | { kind: "befehl"; text: string };

export interface QuickItem {
  kind: QuickKind;
  label: string;
  detail: string;
  target: QuickTarget;
}

export interface QuickSources {
  sessions: readonly { id: string; title?: string | null; project: string; hostId?: string | null; archived?: boolean }[];
  sourceRefs?: readonly { label: string; excerpt: string | null; hash: string | null; view?: "forge" }[];
  notes?: readonly { sessionId: string; hostId: string | null; text: string }[];
  projects: readonly { path: string; name: string }[];
  /** Die gerade offene Session — nur dann gibt es den Sprung in ihre Dateien. */
  here: { sessionId: string; hostId: string | null } | null;
}

// Katalogschlüssel — Anzeige erfolgt über t() (EPIC-P61 T61.9).
export const QUICK_KIND_LABEL: Record<QuickKind, string> = { quelle: "quick.kind_quelle", statusnotiz: "quick.kind_statusnotiz", session: "quick.kind_session", projekt: "quick.kind_projekt", datei: "quick.kind_dateien", werkzeug: "quick.kind_werkzeug", befehl: "quick.kind_befehl" };

// EPIC-P61 T61.9: Label-Katalogschlüssel — Anzeige über t(), Match über beide Sprachen.
const TOOLS: readonly { page: ListPage; key: string; hash?: string }[] = [
  { page: "dashboard", key: "quick.tool_start" },
  { page: "new", key: "common.new_session" },
  { page: "approvals", key: "common.approvals" },
  { page: "teams", key: "app.teams" },
  // EPIC-P47 §3.4: kein eigener Page mehr — der Sprung geht über den Alias auf den Übersichtszustand.
  { page: "dashboard", key: "quick.tool_discovered", hash: "#/gefunden" },
  { page: "media", key: "common.media" },
  { page: "vault", key: "common.notes" },
  { page: "automationen", key: "common.automations" },
  { page: "settings", key: "common.settings" },
  { page: "status", key: "common.provider_status" },
  { page: "pc", key: "desktop.pc" },
  { page: "aimetrics", key: "common.metrics" },
  { page: "terminal", key: "common.terminal" },
];

export const COMMANDS: readonly string[] = ["quick.cmd_show_waiting", "quick.cmd_start_codex", "quick.cmd_answer_there", "quick.cmd_correct_text"];

const PER_KIND = 5;
const base = projectName;
const norm = (s: string) => s.toLocaleLowerCase("de-DE");

/** Rang eines Treffers: Wortanfang vor Teilstring; -1 = kein Treffer. */
function rank(hay: string, q: string): number {
  const h = norm(hay);
  const i = h.indexOf(q);
  if (i < 0) return -1;
  return i === 0 ? 0 : /[\s/·:._-]/.test(h[i - 1] ?? "") ? 1 : 2;
}

/** Bester Rang über alle Sprachformen — Muscle-Memory bleibt in beiden Sprachen erhalten (T61.9). */
function rankForms(key: string, q: string): number {
  let best = -1;
  for (const form of matchForms(key)) {
    const r = rank(form, q);
    if (r >= 0 && (best < 0 || r < best)) best = r;
  }
  return best;
}

export function quickMatches(query: string, src: QuickSources): QuickItem[] {
  const q = norm(query.trim());
  if (!q) return [];
  const pick = <T>(list: readonly T[], text: (x: T) => string, item: (x: T) => QuickItem, rankOf: (x: T) => number = (x) => rank(text(x), q)): QuickItem[] =>
    list
      .map((x, order) => ({ x, order, r: rankOf(x) }))
      .filter((m) => m.r >= 0)
      .sort((a, b) => a.r - b.r || a.order - b.order)
      .slice(0, PER_KIND)
      .map((m) => item(m.x));

  const sessions = pick(
    src.sessions.filter((s) => !s.archived),
    (s) => `${s.title ?? ""} ${base(s.project)}`,
    (s) => ({ kind: "session", label: s.title ?? base(s.project), detail: base(s.project), target: { kind: "session", sessionId: s.id, hostId: s.hostId ?? null } }),
  );
  const projects = pick(
    src.projects,
    (p) => p.name,
    (p) => ({ kind: "projekt", label: p.name, detail: t("quick.new_session_here"), target: { kind: "projekt", path: p.path } }),
  );
  const files: QuickItem[] =
    src.here && q.length >= 2
      ? [{ kind: "datei", label: t("quick.search_files", { "q": query.trim() }), detail: t("quick.open_session"), target: { kind: "datei", sessionId: src.here.sessionId, hostId: src.here.hostId, text: query.trim() } }]
      : [];
  const tools = pick(TOOLS, (x) => t(x.key), (x) => ({ kind: "werkzeug" as const, label: t(x.key), detail: t("quick.open"), target: { kind: "werkzeug" as const, page: x.page, ...(x.hash ? { hash: x.hash } : {}) } }), (x) => rankForms(x.key, q));
  const commands = pick(COMMANDS, (c) => t(c), (c) => ({ kind: "befehl" as const, label: t(c), detail: t("quick.add_as_command"), target: { kind: "befehl", text: t(c).replace(/…/g, "").replace(/: $/, ": ") } }), (c) => rankForms(c, q));
  const refs = pick((src.sourceRefs ?? []).filter(s => s.hash), s => `${s.label} ${s.excerpt ?? ""}`, s => ({ kind: "quelle", label: s.label, detail: t("quick.view_source"), target: { kind: "quelle", hash: s.hash!, ...(s.view ? { view: s.view } : {}) } }));
  const notes = pick(src.notes ?? [], s => s.text, s => ({ kind: "statusnotiz", label: s.text, detail: t("quick.own_note_device"), target: { kind: "statusnotiz", sessionId: s.sessionId, hostId: s.hostId } }));
  return [...refs, ...notes, ...sessions, ...projects, ...files, ...tools, ...commands];
}

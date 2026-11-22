import { t } from "../../shared/i18n/index.ts";
import { displayState, type DisplayState } from "../../shared/display-state.ts";

/**
 * EPIC-P43 T43.8: der Gesamtzustand der kleinen Nyx — Priorität wie VoidWarden `spec.md` §5.1, in der PWA
 * nachgebaut (keine Laufzeitabhängigkeit): offline > Freigabe > Frage > Fehler > arbeitet > ruhig.
 * Ein fertiger Zug ist für Nyx ruhig (bei VoidWarden ist „success“ nur ein kurzer Übergang).
 */
export type NyxState = "offline" | "approval" | "question" | "error" | "working" | "quiet";

const NYX_PRIORITY: readonly NyxState[] = ["offline", "approval", "question", "error", "working", "quiet"];

/** Zustand → Animation im Atlas (`public/nyx/nyx-atlas.json`). */
export const NYX_SPRITE: Record<NyxState, string> = {
  offline: "offline",
  approval: "approval_pending",
  question: "listening",
  error: "error",
  working: "executing",
  quiet: "idle",
};

export interface NyxInput {
  online: boolean;
  sessions: readonly { id: string; status: string; archived?: boolean }[];
  /** Offene Freigaben insgesamt (auch solche, deren Session gerade nicht in der Liste steht). */
  pendingApprovals: number;
  /** Sessions, deren offene Anfrage eine Rückfrage des Agenten ist. */
  questionSessions: readonly string[];
}

export interface NyxSummary {
  state: NyxState;
  /** Wie viele Sessions den Zustand tragen (für den Satz). */
  count: number;
}

const fromDisplay = (s: DisplayState): NyxState => (s === "done" ? "quiet" : s);

export function nyxSummary({ online, sessions, pendingApprovals, questionSessions }: NyxInput): NyxSummary {
  if (!online) return { state: "offline", count: 0 };
  const questions = new Set(questionSessions);
  const states = sessions.filter((s) => !s.archived).map((s) => fromDisplay(displayState({ status: s.status, question: questions.has(s.id) })));
  const counts = Object.fromEntries(NYX_PRIORITY.map((p) => [p, states.filter((s) => s === p).length])) as Record<NyxState, number>;
  // Freigaben zählt der Hub; eine Rückfrage ist eine offene Anfrage, aber keine Freigabe.
  const approvals = Math.max(counts.approval, pendingApprovals - counts.question);
  if (approvals > 0) return { state: "approval", count: approvals };
  const state = NYX_PRIORITY.find((p) => p !== "offline" && p !== "approval" && counts[p] > 0) ?? "quiet";
  return { state, count: counts[state] };
}

/** Nyx' Satz: eine feste Vorlage je Zustand, nie Agenten-Text (PRD §8.5). */
export function nyxSentence({ state, count }: NyxSummary): string {
  switch (state) {
    case "offline":
      return t("nyx.offline");
    case "approval":
      return count === 1 ? t("nyx.approval.one") : t("nyx.approval.other", { "count": count });
    case "question":
      return count === 1 ? t("nyx.question.one") : t("nyx.question.other", { "count": count });
    case "error":
      return count === 1 ? t("nyx.help.one") : t("nyx.help.other", { "count": count });
    case "working":
      return count === 1 ? t("nyx.working.one") : t("nyx.working.other", { "count": count });
    default:
      return t("nyx.quiet");
  }
}

/**
 * Vorauswahl einer Option: Claude markiert die empfohlene Option im Text („(Recommended)“). Das steuert nur,
 * was vorgewählt aussieht — gesendet wird erst auf Tipp (PRD §8.5: Agenten-Text ist Daten).
 */
export function recommendedOption(options: readonly { label: string }[]): string | null {
  return options.find((o) => /\((recommended|empfohlen)\)/i.test(o.label))?.label ?? null;
}

/** Ja/Nein-Frage: genau zwei Optionen, Ja und Nein (de/en) — dann genügt ein Tipp. */
export function isYesNo(options: readonly { label: string }[]): boolean {
  if (options.length !== 2) return false;
  const norm = options.map((o) => o.label.trim().toLowerCase().replace(/[.!]$/, ""));
  return norm.some((l) => l === "ja" || l === "yes") && norm.some((l) => l === "nein" || l === "no");
}

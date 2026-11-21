import { fmtDateTime } from "../shared/i18n/format.ts";
import { t } from "../shared/i18n/index.ts";
/**
 * EPIC-P57 T57.9 (AC-P57-8): Meldungen des Token-Gates. Je Fall eine eigene Ursache mit nächstem Schritt —
 * leeres Token, abgelehntes Token, Hub nicht erreichbar. Nie ein Token in einer Meldung oder URL (PRD §8, ADR-0073).
 */
export type GateProblem = "empty" | "rejected" | "unreachable" | "other";

export function classifyGateError(err: unknown): GateProblem {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return "rejected";
  // Kein HTTP-Status = das Netz hat nie geantwortet (fetch wirft TypeError); 502–504 liefern Proxy bzw. Service Worker offline.
  if (typeof status !== "number" || status === 502 || status === 503 || status === 504) return "unreachable";
  return "other";
}

const NEXT_STEP_REJECTED =
  t("tokengate.wrong_part1") +
  t("tokengate.wrong_part2");

/** lastContact: ISO-Zeitpunkt der letzten erfolgreichen Antwort dieses Hubs auf diesem Gerät (K10), falls bekannt. */
export function gateMessage(problem: GateProblem, detail: string, lastContact: string | null = null): string {
  switch (problem) {
    case "empty":
      return t("tokengate.enter_token");
    case "rejected":
      return t("tokengate.rejected", { "next": NEXT_STEP_REJECTED });
    case "unreachable": {
      const seen = lastContact && !Number.isNaN(new Date(lastContact).getTime()) ? t("tokengate.last_contact", { "time": fmtDateTime(lastContact) }) : "";
      return (
        t("tokengate.unreachable_part1") +
        t("tokengate.unreachable_part2", { "seen": seen })
      );
    }
    case "other":
      return t("tokengate.failed", { "detail": detail });
  }
}

const CONTACT_KEY = "ancientvoid.lastHubContact";
const CONTACT_EVERY_MS = 60_000;

export function lastHubContact(): string | null {
  try {
    return localStorage.getItem(CONTACT_KEY);
  } catch {
    return null;
  }
}

/** Merkt die letzte frische Hub-Antwort (höchstens einmal je Minute — der Abruf läuft alle 3 s). */
export function noteHubContact(now = new Date()): void {
  try {
    const prev = lastHubContact();
    if (prev && now.getTime() - new Date(prev).getTime() < CONTACT_EVERY_MS) return;
    localStorage.setItem(CONTACT_KEY, now.toISOString());
  } catch {
    // Gerätezustand, kein Muss.
  }
}

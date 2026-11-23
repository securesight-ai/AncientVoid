import { fmtDate } from "./format.ts";
import { t } from "./index.ts";

/**
 * Tagesabschnitt im Chat (Nutzerfund 23.11.2026: „im Chat stehen Uhrzeiten,
 * aber das Datum fehlt“). Der Schlüssel ist bewusst der **lokale** Kalendertag
 — Trenner wechseln dort, wo für den Menschen der Tag umbricht, nicht in UTC.
 */
export function dayKey(value: Date | number | string): string {
  const d = new Date(value);
  const zweistellig = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
}

/** Kurzlabel für einen Tag: Heute / Gestern / Fr., 21.11. / 03.01.2025. */
export function dayLabel(value: Date | number | string, now: Date = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return t("common.day_today");
  const gestern = new Date(now);
  gestern.setDate(gestern.getDate() - 1);
  if (key === dayKey(gestern)) return t("common.day_yesterday");
  // Gleiches Jahr: Wochentag + Datum reicht zum Einordnen; ältere Jahre zeigen das Jahr.
  const gleichesJahr = new Date(value).getFullYear() === now.getFullYear();
  return fmtDate(value, gleichesJahr ? { weekday: "short", day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Trenner vor einem Eintrag? Vor dem ersten sichtbaren Eintrag ja (sonst weiß
 * niemand, von wann der Verlauf stammt), danach nur bei Tageswechsel.
 */
export function needsDaySeparator(prevTs: string | null | undefined, ts: string): boolean {
  if (prevTs === null || prevTs === undefined) return true;
  return dayKey(prevTs) !== dayKey(ts);
}

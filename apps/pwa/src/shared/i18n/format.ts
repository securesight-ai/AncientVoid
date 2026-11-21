// EPIC-P61 (ADR-0101): zentrale Intl-Formatierer — die verstreuten
// toLocaleString("de-DE")-Aufrufe (46 Stellen, §3.1) wandern hierher und
// folgen der gewählten Sprache.
import { resolveLanguage, languageEntry } from "./index.ts";

function locale(): string {
  // Für Intl ist die Kanonische Locale der Katalogsprache maßgeblich.
  return languageEntry(resolveLanguage()).aliases[0] === "de" ? "de-DE" : "en-US";
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

function dateFmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const l = locale();
  const key = JSON.stringify(opts) + "|" + l;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(l, opts);
    dateFormatters.set(key, f);
  }
  return f;
}

function numberFmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const l = locale();
  const key = JSON.stringify(opts) + "|" + l;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(l, opts);
    numberFormatters.set(key, f);
  }
  return f;
}

/** Datum nach Intl-Konvention der gewählten Sprache. */
export function fmtDate(value: Date | number | string, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }): string {
  return dateFmt(opts).format(new Date(value));
}

/** Uhrzeit nach Intl-Konvention der gewählten Sprache. */
export function fmtTime(value: Date | number | string, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }): string {
  return dateFmt(opts).format(new Date(value));
}

/** Datum + Zeit nach Intl-Konvention der gewählten Sprache. */
export function fmtDateTime(value: Date | number | string): string {
  return dateFmt({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

/** Zahl nach Intl-Konvention der gewählten Sprache (Tausender etc.). */
export function fmtNumber(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return numberFmt(opts).format(value);
}

export { timeFormatters };

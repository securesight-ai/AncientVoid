import type { InferenceAsymptote, InferencePerf, InferencePerfRow, InferenceSizeRow } from "@ancientvoid/contracts";

/**
 * EPIC-P79 T79.2: Perzentile, die man glauben kann. Zwei Fehlerquellen sind
 * ausgeschlossen: (1) winzige Arbeitsmengen ergeben keine belastbare Rate,
 * (2) ein einzelner Ausreißer darf nicht als Spitze erscheinen. Perzentil-Methode:
 * lineare Interpolation (R6, „numpy-Standard“) — getestet.
 */

export type PerfSummary = {
  n: number;
  nRaw: number;
  usable: boolean;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  mean: number | null;
  peakRaw: number | null;
  /** größter Wert innerhalb des Tukey-Bands (Q3 + 1,5·IQR) */
  peakRobust: number | null;
  ausreisser: number;
  excluded: number;
  reasons: Record<string, number>;
  minSamples: number;
};

/** Unterhalb dieser Stichprobenzahl werden keine Perzentile ausgewiesen. */
export const MIN_SAMPLES = 8;

export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sortedAsc[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sortedAsc[lo]! + (h - lo) * (sortedAsc[hi]! - sortedAsc[lo]!);
}

export function summarize(
  values: (number | null | undefined)[],
  opts: { minSamples?: number; valid?: (v: number, i: number) => boolean } = {},
): PerfSummary {
  const minSamples = opts.minSamples ?? MIN_SAMPLES;
  const reasons: Record<string, number> = {};
  const kept: number[] = [];
  let excluded = 0;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v) || v <= 0) {
      reasons["kein Wert"] = (reasons["kein Wert"] ?? 0) + 1;
      excluded += 1;
      return;
    }
    if (opts.valid && !opts.valid(v, i)) {
      reasons["unplausibel"] = (reasons["unplausibel"] ?? 0) + 1;
      excluded += 1;
      return;
    }
    kept.push(v);
  });
  const asc = [...kept].sort((a, b) => a - b);
  const peak = asc.length ? (asc[asc.length - 1] as number) : null;
  const mean = kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : null;
  if (kept.length < minSamples) {
    reasons["zu wenige Stichproben"] = (reasons["zu wenige Stichproben"] ?? 0) + 1;
    return {
      n: kept.length, nRaw: values.length, usable: false,
      p10: null, p50: null, p90: null, mean, peakRaw: peak, peakRobust: null,
      ausreisser: 0, excluded, reasons, minSamples,
    };
  }
  const q1 = percentile(asc, 0.25);
  const q3 = percentile(asc, 0.75);
  const fence = q3 + 1.5 * (q3 - q1);
  const inside = asc.filter((v) => v <= fence);
  return {
    n: kept.length, nRaw: values.length, usable: true,
    p10: percentile(asc, 0.1), p50: percentile(asc, 0.5), p90: percentile(asc, 0.9),
    mean, peakRaw: peak, peakRobust: inside.length ? (inside[inside.length - 1] as number) : null,
    ausreisser: asc.length - inside.length, excluded, reasons, minSamples,
  };
}

/** Kleinste Arbeitsmengen, ab der eine Rate als Messung zählt. */
export const THRESHOLDS = {
  /** Vorbehandlung: gelesene Token (nicht Prompt-Token — Wiederverwendung kostet keine Arbeit). */
  minReadPrefill: 4_000,
  minOutDecode: 30,
  minDecodeS: 1,
  minSamples: MIN_SAMPLES,
  /** Alles über 120 s bis zum ersten Token ist Warteschlange, kein Tempo. */
  maxTtftS: 120,
};

/** Schichten gelesener Token — Vorbehandlung ist größenabhängig, keine Konstante. */
export const PREFILL_EDGES = [20, 100, 400, 1_200, 4_000, 12_000] as const;

export function linfit(pts: Array<[number, number]>): {
  n: number;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
} {
  const p = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = p.length;
  if (n < 3) return { n, slope: null, intercept: null, r2: null };
  const mx = p.reduce((a, [x]) => a + x, 0) / n;
  const my = p.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of p) {
    const dx = x - mx;
    const dy = y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { n, slope: null, intercept: null, r2: null };
  return { n, slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, r2: (sxy * sxy) / (sxx * syy) };
}

function row(bereich: string, s: PerfSummary): InferencePerfRow {
  return {
    bereich,
    n: s.n,
    p10: s.p10,
    p50: s.p50,
    p90: s.p90,
    mean: s.mean,
    peak: s.peakRaw,
    peakRobust: s.peakRobust,
    ausreisser: s.ausreisser,
  };
}

function schichtLabel(lo: number, hi: number | null): string {
  const g = (v: number) => v.toLocaleString("de-DE");
  return hi == null ? `≥ ${g(lo)}` : `${g(lo)}–${g(hi - 1)}`;
}

/** Eine abgeschlossene Anfrage in der für die Statistik nötigen Form. */
export type ReqStat = {
  read: number | null;
  output: number | null;
  /** Vorbehandlungszeit in Sekunden. */
  prefillS: number | null;
  decodeS: number | null;
  prefillTokS: number | null;
  decodeTokS: number | null;
  ttftS: number | null;
};

/**
 * `perfOf` baut die Verteilungs-Sicht: Perzentile pro Bereich, Vorbehandlung
 * nach Größe der gelesenen Token geschichtet, und als Headline die
 * Grenzlaufrate aus der Anpassung Zeit ≈ Vorlauf + gelesene Token / Durchsatz.
 */
export function perfOf(
  recs: ReqStat[],
  cfg: { fensterH: number; minReadPrefill?: number; minSamples?: number } = { fensterH: 72 },
): InferencePerf {
  const minReadPrefill = cfg.minReadPrefill ?? THRESHOLDS.minReadPrefill;
  const minSamples = cfg.minSamples ?? THRESHOLDS.minSamples;
  const opts = { minSamples };
  const decode = summarize(
    recs.map((r) => ((r.output ?? 0) >= THRESHOLDS.minOutDecode && (r.decodeS ?? 0) >= THRESHOLDS.minDecodeS ? r.decodeTokS : null)),
    opts,
  );
  const prefill = summarize(recs.map((r) => ((r.read ?? 0) >= minReadPrefill ? r.prefillTokS : null)), opts);
  const prefillAlle = summarize(recs.map((r) => ((r.read ?? 0) >= PREFILL_EDGES[0] ? r.prefillTokS : null)), opts);
  const ttft = summarize(
    recs.map((r) => (r.ttftS != null && r.ttftS < THRESHOLDS.maxTtftS ? r.ttftS : null)),
    opts,
  );

  const groessenSchichten: InferenceSizeRow[] = [];
  for (let i = 0; i < PREFILL_EDGES.length; i += 1) {
    const lo = PREFILL_EDGES[i] as number;
    const hi = (PREFILL_EDGES[i + 1] as number | undefined) ?? null;
    const werte = recs
      .filter((r) => (r.read ?? 0) >= lo && (hi == null || (r.read ?? 0) < hi) && r.prefillTokS != null)
      .map((r) => r.prefillTokS as number);
    if (werte.length === 0) {
      groessenSchichten.push({ label: schichtLabel(lo, hi), n: 0, p50: null, p90: null, peak: null });
      continue;
    }
    const asc = [...werte].sort((a, b) => a - b);
    groessenSchichten.push({
      label: schichtLabel(lo, hi),
      n: werte.length,
      p50: percentile(asc, 0.5),
      p90: percentile(asc, 0.9),
      peak: asc[asc.length - 1] ?? null,
    });
  }

  // Nur breite Streuung der Lesemenge trägt die Anpassung; Mini-Mengen dominieren sonst die Achse.
  const fit = linfit(
    recs
      .filter((r) => (r.read ?? 0) >= 200 && (r.prefillS ?? 0) > 0)
      .map((r) => [r.read as number, r.prefillS as number]),
  );
  const asymptote: InferenceAsymptote = {
    tokS: fit.slope && fit.slope > 0 ? 1 / fit.slope : null,
    overheadMs: fit.intercept == null ? null : fit.intercept * 1000,
    r2: fit.r2,
    n: fit.n,
  };

  return {
    fensterH: cfg.fensterH,
    schwelleGelesen: minReadPrefill,
    stichprobenMinimum: minSamples,
    decode: [row(`≥ ${THRESHOLDS.minOutDecode} Token, ≥ ${THRESHOLDS.minDecodeS} s`, decode)],
    prefill: [row(`≥ ${minReadPrefill.toLocaleString("de-DE")} gelesen`, prefill), row(`alle ≥ ${PREFILL_EDGES[0]} gelesen`, prefillAlle)],
    ttft: [row(`< ${THRESHOLDS.maxTtftS} s`, ttft)],
    groessenSchichten,
    asymptote,
    engineHinweis: null,
  };
}

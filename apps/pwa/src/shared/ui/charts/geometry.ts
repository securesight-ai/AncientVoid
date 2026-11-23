export type SeriesPoint = readonly [ts: number, value: number];

/** Lücken sind Lücken: ab 2,5 Schritten ohne Punkt beginnt eine neue Strecke. */
export function segments(points: readonly SeriesPoint[], stepMs: number): SeriesPoint[][] {
  const out: SeriesPoint[][] = [];
  let previous: SeriesPoint | null = null;
  for (const p of points) {
    if (previous === null || p[0] - previous[0] > stepMs * 2.5) out.push([]);
    out.at(-1)!.push(p);
    previous = p;
  }
  return out;
}

/** Runde Obergrenze für die Achse; nie 0, damit eine Nulllinie sichtbar bleibt. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((f) => f * power).find((v) => v >= max) ?? 10 * power;
}

export function nearestIndex(points: readonly SeriesPoint[], ts: number): number {
  let best = 0;
  points.forEach((p, i) => {
    if (Math.abs(p[0] - ts) < Math.abs(points[best]![0] - ts)) best = i;
  });
  return best;
}

/** Wert gegenüber dem Punkt, der mindestens `ageMs` alt ist; null ohne passenden Punkt. */
export function trend(points: readonly SeriesPoint[], ageMs: number): number | null {
  const last = points.at(-1);
  const before = last && [...points].reverse().find((p) => last[0] - p[0] >= ageMs && last[0] - p[0] < ageMs * 2);
  return last && before ? last[1] - before[1] : null;
}

/** Höchstens `max` Punkte; der Schritt wächst mit, damit Lücken Lücken bleiben. */
export function thin(points: readonly SeriesPoint[], max: number): { points: SeriesPoint[]; stride: number } {
  const stride = Math.max(1, Math.ceil(points.length / max));
  return { points: points.filter((_, i) => (points.length - 1 - i) % stride === 0), stride };
}

/** Zähler in Raten wandeln. Erster Wert, Rückwärtslauf ohne Bereich und Stillstand der Uhr ergeben null. */
export interface Rates {
  perSecond(key: string, value: number, nowMs: number, wrapAt?: number): number | null;
  /** Zuwachs seit dem letzten Aufruf, ohne Zeitbezug. */
  delta(key: string, value: number): number | null;
}

export function createRates(): Rates {
  const last = new Map<string, { value: number; at: number }>();
  return {
    perSecond(key, value, nowMs, wrapAt) {
      if (!Number.isFinite(value)) return null;
      const prev = last.get(key);
      last.set(key, { value, at: nowMs });
      if (!prev || nowMs <= prev.at) return null;
      let diff = value - prev.value;
      if (diff < 0) {
        if (!wrapAt) return null;
        diff += wrapAt;
        if (diff < 0) return null;
      }
      return diff / ((nowMs - prev.at) / 1000);
    },
    delta(key, value) {
      if (!Number.isFinite(value)) return null;
      const prev = last.get(key);
      last.set(key, { value, at: 0 });
      return prev && value >= prev.value ? value - prev.value : null;
    },
  };
}

/**
 * EPIC-P79 T79.2: Prometheus-Exposition lesen — eigener, bewusster Code
 * (Prometheus-Import bleibt verneint, ADR-0010). Anders als der P59-Parser
 * (`../aimetrics/prometheus.ts`, nur Familie → Werte) braucht diese Spur **Typ,
 * Labels und Histogramm-Buckets**: Raten entstehen aus Zähler-Deltas, und
 * Verteilungen aus `vllm:*`-artigen Histogrammen. Kein Prometheus-Abhängigkeit.
 */

type Sample = { name: string; labels: string; value: number };

export type MetricFamily = { name: string; type: string; help: string; samples: Sample[] };

/** Text → Familien. Fehlerhafte Zeilen werden ignoriert, aber gezählt (K9: nicht verschwinden lassen). */
export function parseProm(text: string): { families: Map<string, MetricFamily>; skipped: number } {
  const families = new Map<string, MetricFamily>();
  let skipped = 0;
  const ensure = (name: string): MetricFamily => {
    let f = families.get(name);
    if (!f) {
      f = { name, type: "untyped", help: "", samples: [] };
      families.set(name, f);
    }
    return f;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = /^#\s*(TYPE|HELP)\s+(\S+)\s*(.*)$/.exec(line);
      if (!m) {
        skipped += 1;
        continue;
      }
      const f = ensure(m[2] as string);
      if (m[1] === "TYPE") f.type = (m[3] ?? "").trim();
      else f.help = (m[3] ?? "").trim();
      continue;
    }
    // name{labels} value [timestamp] — Labels können Klammern enthalten, deshalb
    // Wert vom letzten Leerzeichen abschneiden und Klammerpaar unten suchen.
    const sp = line.lastIndexOf(" ");
    const value = Number(line.slice(sp + 1).trim());
    if (!Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    let head = line.slice(0, sp).trim();
    let labels = "";
    const open = head.indexOf("{");
    if (open >= 0 && head.endsWith("}")) {
      labels = head.slice(open + 1, head.length - 1);
      head = head.slice(0, open);
    }
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(head)) {
      skipped += 1;
      continue;
    }
    ensure(head).samples.push({ name: head, labels, value });
  }
  return { families, skipped };
}

/** Zählerwert, über alle Exemplare summiert (mehrere Modelle/Instanzen zusammen). */
export function counter(families: Map<string, MetricFamily>, name: string): number | null {
  const f = families.get(name);
  if (!f || f.samples.length === 0) return null;
  return f.samples.reduce((a, s) => a + s.value, 0);
}

/** Gauge: nur bei genau einem Sample eindeutig, sonst null statt geraten (ADR-0023). */
export function gauge(families: Map<string, MetricFamily>, name: string): number | null {
  const f = families.get(name);
  if (!f || f.samples.length === 0) return null;
  if (f.samples.length > 1) return null;
  return f.samples[0]!.value;
}

/** Quantil aus Histogramm-Buckets (lineare Interpolation im Bucket). */
export function histQuantil(families: Map<string, MetricFamily>, base: string, p: number): number | null {
  const f = families.get(`${base}_bucket`) ?? families.get(base);
  if (!f) return null;
  const buckets: { le: number; sum: number }[] = [];
  for (const s of f.samples) {
    const m = /(^|,)le="([^"]+)"/.exec(s.labels);
    if (!m) continue;
    const le = m[2] === "+Inf" ? Number.POSITIVE_INFINITY : Number(m[2]);
    if (Number.isFinite(le)) buckets.push({ le, sum: s.value });
    else buckets.push({ le: Number.POSITIVE_INFINITY, sum: s.value });
  }
  if (buckets.length === 0) return null;
  buckets.sort((a, b) => a.le - b.le);
  const total = buckets[buckets.length - 1]!.sum;
  if (!(total > 0)) return null;
  const target = p * total;
  let prevLe = 0;
  let prevSum = 0;
  for (const b of buckets) {
    if (b.sum >= target) {
      // offener oberster Bucket: Quantil nicht bestimmbar → null, kein Schätzwert
      if (!Number.isFinite(b.le)) return null;
      const span = b.sum - prevSum;
      if (span <= 0) return b.le;
      return prevLe + ((target - prevSum) / span) * (b.le - prevLe);
    }
    prevLe = b.le;
    prevSum = b.sum;
  }
  return null;
}

/** Deltas zweier Abrufe; negative Sprünge (Zähler-Reset) sind keine Raten. */
export type DeltaBook = { at: number; values: Record<string, number> };

export type Deltas = {
  seconds: number;
  values: Record<string, number>;
  /** true, wenn mindestens ein Delta negativ war (Reset oder inkonsistente Zähler). */
  inconsistent: boolean;
};

export function deltas(prev: DeltaBook | null, now: DeltaBook): Deltas | null {
  if (!prev) return null;
  const seconds = (now.at - prev.at) / 1000;
  if (!(seconds > 0)) return null;
  const values: Record<string, number> = {};
  let inconsistent = false;
  for (const [k, v] of Object.entries(now.values)) {
    const p = prev.values[k];
    if (p == null || !Number.isFinite(v)) continue;
    const d = v - p;
    if (d < 0) inconsistent = true;
    values[k] = Math.max(0, d);
  }
  return { seconds, values, inconsistent };
}

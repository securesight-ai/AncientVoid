import { z } from "zod";

/**
 * EPIC-P81 (ADR-0117): alle auslesbaren Werte eines Hosts als offene Liste von
 * Messpunkten. `group`, `unit` und `source` sind bewusst freie Strings: ein neuer
 * Sensor oder ein neuerer Peer darf den Report eines älteren Hubs nicht ungültig
 * machen. `value: null` heißt „nicht gemeldet“ und trägt einen Grund (ADR-0023).
 */
export const HOST_METRIC_GROUPS = ["cpu", "memory", "gpu", "temperature", "fan", "voltage", "clock", "power", "disk", "network", "system"] as const;
export type HostMetricGroup = (typeof HOST_METRIC_GROUPS)[number];

export const HostMetricPoint = z.object({
  /** Stabil über Neustarts: Gerät statt laufender hwmon-Nummer. */
  key: z.string().min(1).max(200),
  group: z.string().min(1).max(40),
  device: z.string().max(120),
  label: z.string().max(120),
  unit: z.string().max(20),
  value: z.number().nullable(),
  reason: z.string().max(200).nullable(),
  source: z.string().max(40),
  /**
   * Was die Leistung abdeckt. Punkte derselben Domäne messen dasselbe Bauteil
   * und werden nie addiert; null = nicht zuordenbar, zählt in keiner Summe.
   */
  powerDomain: z.string().max(120).nullable(),
});
export type HostMetricPoint = z.infer<typeof HostMetricPoint>;

/** Ein Sammel-Durchgang eines Hosts (K5: REST, kein Event-Payload). */
export const HostMetricsSample = z.object({
  ts: z.string(),
  points: z.array(HostMetricPoint).max(2_000),
  /** Quellen, die in diesem Durchgang ausfielen — nie still (K9). */
  errors: z.array(z.object({ source: z.string(), error: z.string().max(200) })).max(50),
});
export type HostMetricsSample = z.infer<typeof HostMetricsSample>;

const Status = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string().max(200) })]);
const Reading = z.object({ label: z.string(), value: z.number() });

/** Kurzform eines Hosts für die Übersicht; null = nicht gemeldet. */
export const HostMetricsSummary = z.object({
  cpuPercent: z.number().nullable(),
  memUsedBytes: z.number().nullable(),
  memTotalBytes: z.number().nullable(),
  gpuPercent: z.number().nullable(),
  hottest: Reading.nullable(),
  fullestDisk: Reading.nullable(),
  /** Summe gemessener Komponenten, kein Steckdosenwert (ADR-0117). */
  watts: z.number().nullable(),
  wattParts: z.array(Reading.extend({ domain: z.string() })).max(50),
  /** Bauteile ohne lesbaren Leistungswert, z. B. CPU ohne RAPL-Recht. */
  wattMissing: z.array(z.string()).max(50),
});
export type HostMetricsSummary = z.infer<typeof HostMetricsSummary>;

export const HostMetricsDay = z.object({
  /** Kalendertag in der Zeitzone des messenden Hubs, YYYY-MM-DD. */
  day: z.string(),
  wh: z.number(),
  /** Gemessene Zeit; Lücken werden nicht hochgerechnet. */
  coveredSec: z.number(),
});
export type HostMetricsDay = z.infer<typeof HostMetricsDay>;

export const HostMetricsHost = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  status: Status,
  /** Zeit des letzten Werts; bleibt beim Ausfall stehen (K10). */
  ts: z.string().nullable(),
  intervalSec: z.number(),
  summary: HostMetricsSummary.nullable(),
  /** Komponenten-Watt der letzten Stunde, Minutenmittel [ms, W]. */
  spark: z.array(z.tuple([z.number(), z.number()])).max(120),
  today: HostMetricsDay.nullable(),
});
export type HostMetricsHost = z.infer<typeof HostMetricsHost>;

/** `GET /api/hostmetrics` */
export const HostMetricsReport = z.object({ generatedAt: z.string(), hosts: z.array(HostMetricsHost).max(64) });
export type HostMetricsReport = z.infer<typeof HostMetricsReport>;

/** `GET /api/hostmetrics/host?id=` */
export const HostMetricsDetail = z.object({ host: HostMetricsHost, sample: HostMetricsSample.nullable() });
export type HostMetricsDetail = z.infer<typeof HostMetricsDetail>;

export const HOST_METRIC_RANGES = ["1h", "24h", "7d", "90d"] as const;
export type HostMetricRange = (typeof HOST_METRIC_RANGES)[number];

/** `GET /api/hostmetrics/history?id=&range=&key=` — höchstens 720 Punkte je Reihe. */
export const HostMetricsHistory = z.object({
  key: z.string(),
  range: z.string(),
  stepSec: z.number(),
  /** [ms, Mittel, Minimum, Maximum]; fehlende Schritte sind Lücken. */
  points: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).max(721),
  days: z.array(HostMetricsDay).max(90),
});
export type HostMetricsHistory = z.infer<typeof HostMetricsHistory>;

/** Schlüssel der Summenreihe im Verlauf. */
export const COMPONENT_POWER_KEY = "power:components";

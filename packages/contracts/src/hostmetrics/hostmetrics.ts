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

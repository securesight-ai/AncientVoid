import { COMPONENT_POWER_KEY } from "@ancientvoid/contracts";
import { setTimeout as delay } from "node:timers/promises";

export async function checkEnergy(api, host) {
  const { host: status } = await api(`/api/hostmetrics/host?id=${encodeURIComponent(host)}`);
  if (!status?.status?.ok || !(status.summary?.watts > 0 || status.spark.some(([, watts]) => watts > 0))) {
    throw new Error(`P81 does not report positive component power for ${host}`);
  }
}

export function integrateEnergy({ points, stepSec }, start, end) {
  if (!Number.isFinite(stepSec) || stepSec <= 0 || end <= start) throw new Error("Invalid P81 measurement interval");
  let covered = 0;
  let wattMs = 0;
  for (const [ts, watts] of points) {
    const overlap = Math.min(ts + stepSec * 1000, end) - Math.max(ts, start);
    if (overlap <= 0) continue;
    if (!Number.isFinite(watts) || watts <= 0) throw new Error("Missing positive P81 watts");
    covered += overlap;
    wattMs += overlap * watts;
  }
  if (covered !== end - start || wattMs <= 0) throw new Error("P81 history does not cover the complete phase");
  return wattMs / 3_600_000_000;
}

export async function phaseBilling(api, billing, start, end) {
  if (billing.kind === "cloud") return billing;
  const path = `/api/hostmetrics/history?range=1h&key=${COMPONENT_POWER_KEY}&id=${encodeURIComponent(billing.host)}`;
  const initial = await api(path);
  await delay(Math.max(0, Math.ceil(end / (initial.stepSec * 1000)) * initial.stepSec * 1000 - Date.now()) + 10_000);
  const history = await api(path);
  return { ...billing, source: "p81:power:components", kwh: integrateEnergy(history, start, end) };
}

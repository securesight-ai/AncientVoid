import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkEnergy, phaseBilling } from "./energy.mjs";
import { OUTAGES } from "./protocol.mjs";

export function connectHub(base, token) {
  if (!token) throw new Error("ANCIENTVOID_TOKEN for the isolated evaluation hub is required");
  const url = new URL(base ?? "http://127.0.0.1:7373");
  if (url.username || url.password || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) {
    throw new Error("Use a loopback HTTP or HTTPS evaluation hub origin");
  }
  return async (path, body, status = 200, timeoutMs = 30_000) => {
    const response = await globalThis.fetch(new URL(path, url), {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(timeoutMs),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (response.status !== status) throw new Error(`${path}: HTTP ${response.status} ${payload.error ?? payload.detail ?? ""}`);
    return payload;
  };
}

export async function probeHealth(url, fetcher = globalThis.fetch) {
  const response = await fetcher(url, { signal: globalThis.AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`health probe ${url}: HTTP ${response.status}`);
}

/** Waits for a recovering engine; a dead one stays an infrastructure failure, never a task failure. */
export async function awaitHealthy(url, { fetcher, waitMs = 60_000, stepMs = 5_000 } = {}) {
  const end = performance.now() + waitMs;
  for (;;) {
    try {
      return await probeHealth(url, fetcher);
    } catch (error) {
      if (performance.now() + stepMs > end) throw new Error(`health check failed: ${error.message}`, { cause: error });
      await delay(stepMs);
    }
  }
}

export async function preflight(api, config, fetcher, energyApi = api) {
  const adapters = await api("/api/adapters");
  const catalogues = new Map();
  const checks = await Promise.allSettled(config.cells.map(async (cell) => {
    if (!adapters.some(({ id }) => id === cell.adapter)) throw new Error(`Missing hub adapter ${cell.adapter}`);
    if (!catalogues.has(cell.adapter)) catalogues.set(cell.adapter, api(`/api/adapters/${encodeURIComponent(cell.adapter)}/models`));
    const { models } = await catalogues.get(cell.adapter);
    if (!models?.some((model) => model.id === cell.model)) {
      throw new Error(`${cell.adapter}: model ${cell.model} missing from the configured catalogue`);
    }
    if (cell.billing.kind === "local") await checkEnergy(energyApi, cell.billing.host);
    if (cell.healthUrl) await probeHealth(cell.healthUrl, fetcher);
  }));
  const failures = checks.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "P84 preflight failed before any session was started");
}

async function assertNoOutage(api, sessionId) {
  for (let after = 0; ;) {
    const page = await api(`/api/sessions/${sessionId}/events?afterSeq=${after}&limit=2000`);
    if (!page.length) return;
    const cut = page.find(({ payload }) => payload?.kind === "provider.error" && OUTAGES.includes(payload.category));
    if (cut) throw new Error(`${sessionId}: provider ${cut.payload.category} during turn`);
    after = page.at(-1).seq;
  }
}

async function waitForTurn(api, sessionId, timeoutMs) {
  const end = performance.now() + timeoutMs;
  const path = `/api/sessions/${sessionId}`;
  while (performance.now() < end) {
    const [{ status }, { turns }] = await Promise.all([api(path), api(`${path}/turns`)]);
    if (turns.length && ["idle", "error", "stopped", "parked"].includes(status)) {
      if (turns.some((turn) => turn.outcome === "error")) await assertNoOutage(api, sessionId);
      return status;
    }
    if (["error", "stopped", "parked", "interrupted", "waiting_approval"].includes(status)) {
      throw new Error(`${sessionId}: ${status} before completed turn telemetry`);
    }
    await delay(250);
  }
  throw new Error(`${sessionId}: timed out waiting for a finished turn`);
}

async function stopPhase(api, path) {
  const { ok } = await api(`${path}/stop`, {});
  if (!ok) throw new Error(`${path}: hub did not confirm stop`);
}

export async function runPhase(api, phase, candidate, project, prompt, timeoutMs, energyApi = api) {
  const start = Date.now();
  const timer = performance.now();
  const record = await api("/api/sessions", {
    adapter: candidate.adapter, model: candidate.model, project, workspaceMode: "direct", prompt,
    ...(candidate.budgetUsd ? { budgetUsd: candidate.budgetUsd } : {}),
  }, 201);
  if (!record.id) throw new Error("The hub did not acknowledge the session with an ID");
  const path = `/api/sessions/${record.id}`;
  let status;
  let wallMs;
  let end;
  let aborted;
  try {
    if (record.model !== candidate.model || record.adapter !== candidate.adapter) throw new Error("Hub selected a different adapter or model");
    try {
      status = await waitForTurn(api, record.id, timeoutMs);
    } catch (error) {
      // ADR-0128: Zeitlimit und offene Rückfrage sind Ergebnisse des Laufs, kein
      // Infrastrukturausfall — runPhase liefert sie als `aborted` zurück.
      if (/: waiting_approval before completed turn telemetry$/.test(error.message)) aborted = "approval";
      else if (/: timed out waiting for a finished turn$/.test(error.message)) aborted = "timeout";
      else throw error;
    }
    wallMs = Math.max(performance.now() - timer, 0.001);
    end = Math.max(Date.now(), start + 1);
  } finally {
    if (status !== "stopped") {
      await stopPhase(api, path);
    }
  }
  return {
    sessionId: record.id, phase, harnessVersion: candidate.harnessVersion, modelFingerprint: candidate.fingerprint,
    wallMs, billing: await phaseBilling(energyApi, candidate.billing, start, end),
    ...(aborted ? { aborted } : {}),
  };
}

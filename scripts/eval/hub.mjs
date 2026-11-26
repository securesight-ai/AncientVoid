import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkEnergy, phaseBilling } from "./energy.mjs";

export function connectHub(base, token) {
  if (!token) throw new Error("ANCIENTVOID_TOKEN for the isolated evaluation hub is required");
  const url = new URL(base ?? "http://127.0.0.1:7373");
  if (url.username || url.password || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) {
    throw new Error("Use a loopback HTTP or HTTPS evaluation hub origin");
  }
  return async (path, body, status = 200) => {
    const response = await globalThis.fetch(new URL(path, url), {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (response.status !== status) throw new Error(`${path}: HTTP ${response.status} ${payload.error ?? payload.detail ?? ""}`);
    return payload;
  };
}

export async function preflight(api, config) {
  const adapters = await api("/api/adapters");
  const checks = await Promise.allSettled(Object.values(config.harnesses).map(async (harness) => {
    if (!adapters.some(({ id }) => id === harness.adapter)) throw new Error(`Missing hub adapter ${harness.adapter}`);
    const { models } = await api(`/api/adapters/${encodeURIComponent(harness.adapter)}/models`);
    for (const candidate of [harness.local, harness.cloud]) {
      if (!models?.some((model) => model.id === candidate.model)) {
        throw new Error(`${harness.adapter}: model ${candidate.model} missing from the configured catalogue`);
      }
    }
    await checkEnergy(api, harness.local.billing.host);
  }));
  const failures = checks.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "P84 preflight failed before any session was started");
}

async function waitForTurn(api, sessionId, timeoutMs) {
  const end = performance.now() + timeoutMs;
  const path = `/api/sessions/${sessionId}`;
  while (performance.now() < end) {
    const [{ status }, { turns }] = await Promise.all([api(path), api(`${path}/turns`)]);
    if (turns.length && ["idle", "error", "stopped", "parked"].includes(status)) return status;
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

export async function runPhase(api, phase, candidate, project, prompt, timeoutMs) {
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
  try {
    if (record.model !== candidate.model || record.adapter !== candidate.adapter) throw new Error("Hub selected a different adapter or model");
    status = await waitForTurn(api, record.id, timeoutMs);
    wallMs = Math.max(performance.now() - timer, 0.001);
    end = Math.max(Date.now(), start + 1);
  } finally {
    if (status !== "stopped") {
      await stopPhase(api, path);
    }
  }
  return {
    sessionId: record.id, phase, harnessVersion: candidate.harnessVersion, modelFingerprint: candidate.fingerprint,
    wallMs, billing: await phaseBilling(api, candidate.billing, start, end),
  };
}

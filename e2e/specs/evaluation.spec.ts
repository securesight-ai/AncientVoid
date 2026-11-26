import type { EvalResult, TurnMetric } from "@ancientvoid/contracts";
import { test, expect } from "../support/fixtures.ts";

test("P84 speichert Abnahme und Richtungstokens an der Sitzung und behält sie beim Neustart", async ({ hub }) => {
  const id = await hub.createSession({ adapter: "opencode", model: "e2e/fake-model", prompt: "Lies README.md" });
  await hub.until(async () => {
    const response = await hub.api<{ turns: TurnMetric[] }>(`/api/sessions/${id}/turns`);
    return response.body.turns.length > 0;
  }, "one OpenCode turn with usage");
  expect((await hub.api(`/api/sessions/${id}/stop`, { body: {} })).status).toBe(200);
  const hash = "a".repeat(64);
  const path = `/api/sessions/${id}/evaluation`;
  const saved = await hub.api<EvalResult>(path, {
    body: {
      series: "e2e", arm: "opencode-cloud-plain", task: "readme", repetition: 1,
      corpusHash: hash, protocolHash: hash, rulesHash: hash, skillHash: null,
      skills: false, acceptance: true, lint: true, typecheck: true, baseline: 1,
      phases: [{
        sessionId: id, phase: "build", harnessVersion: "1.2.3-e2e", modelFingerprint: "fixture-v1", wallMs: 500,
        billing: { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 2, outputUsdPerMillion: 4 },
      }],
    },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.phases[0]).toMatchObject({ inputTokens: 300, outputTokens: 21, costUsd: 0.000684 });
  await hub.restart();
  const restored = await hub.api(path);
  expect(restored.status).toBe(200);
  expect(restored.body).toEqual(saved.body);
});

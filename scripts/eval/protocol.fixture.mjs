const cloudBilling = { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 1, cacheInputUsdPerMillion: 0.1, outputUsdPerMillion: 2 };
const localBilling = { kind: "local", date: "2026-11-25", host: "fixture", usdPerKwh: 0.2 };
const cells = ["pi", "claude", "opencode"].flatMap((id) => [
  { id: `${id}-local`, harness: id, adapter: id, version: "1.0.0", configurationFingerprint: "test", model: "fixture/local",
    fingerprint: "shared-local", provider: "local", billing: localBilling },
  { id: `${id}-cloud`, harness: id, adapter: id, version: "1.0.0", configurationFingerprint: "test", model: "fixture/cloud",
    fingerprint: "shared-cloud", provider: "fixture", billing: cloudBilling, budgetUsd: 0.5 },
]);

export const testProtocol = {
  version: 2,
  fixturePolicy: "isolated-hub",
  repetitions: 5,
  timeoutMs: 60_000,
  parallelCloudRuns: 2,
  setup: "unit fixture",
  providerBudgetUsd: { fixture: 20 },
  cells,
  splits: [
    { id: "split-local-cloud", plan: "pi-local", build: "pi-cloud" },
    { id: "split-cloud-local", plan: "pi-cloud", build: "pi-local" },
    { id: "split-cloud-cloud", plan: "pi-cloud", build: "pi-cloud" },
  ],
};

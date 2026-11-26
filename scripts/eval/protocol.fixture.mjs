export const testProtocol = {
  version: 1,
  fixturePolicy: "isolated-hub",
  repetitions: 5,
  timeoutMs: 60_000,
  parallelCloudRuns: 2,
  setup: "unit fixture",
  splitHarness: "pi",
  harnesses: Object.fromEntries(["pi", "claude", "opencode"].map((id) => [id, {
    adapter: id,
    version: "1.0.0",
    configurationFingerprint: "test",
    local: {
      model: "fixture/local",
      fingerprint: "shared-local",
      billing: { kind: "local", date: "2026-11-25", host: "fixture", usdPerKwh: 0.2 },
    },
    cloud: {
      model: "fixture/cloud",
      fingerprint: "shared-cloud",
      budgetUsd: 0.50,
      billing: { kind: "cloud", date: "2026-11-25", source: "https://example.com/prices", inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
    },
  }])),
};

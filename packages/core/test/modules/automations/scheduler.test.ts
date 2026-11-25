import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationDefinition } from "@ancientvoid/contracts";
import { automationClaimKey } from "@ancientvoid/contracts";
import { AutomationStore } from "../../../src/modules/automations/store.ts";
import { AutomationsScheduler, type DispatchResult, type PrecheckResult } from "../../../src/modules/automations/scheduler.ts";

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "av-automations-test-"));
  return root;
}

const TARGET = { kind: "session" as const, harness: "pi", workdir: "worktree" as const, project: "/srv/repo", promptBlobSha256: "b".repeat(64) };

function definition(over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "aut-1",
    label: "Testlauf",
    generation: 1,
    enabled: true,
    hostId: "host-a",
    schedule: { kind: "cron", cron: "0 12 * * *", timezone: "Europe/Berlin" },
    target: TARGET,
    grant: { maxParallel: 1, missedGraceMs: 0 },
    precheckDeadlineMs: 60_000,
    createdAtUtc: "2026-01-05T10:55:00.000Z",
    ...over,
  };
}

interface Harness {
  store: AutomationStore;
  scheduler: AutomationsScheduler;
  dispatches: { claimKey: string; kind: string }[];
  prechecks: { n: number };
  now: { value: number };
}

async function harness(dispatchFn?: (claimKey: string, kind: string) => DispatchResult, precheckFn?: () => PrecheckResult): Promise<Harness> {
  const root = await tempRoot();
  const store = new AutomationStore(root);
  const now = { value: Date.parse("2026-01-05T11:00:30.000Z") };
  const dispatches: { claimKey: string; kind: string }[] = [];
  const prechecks = { n: 0 };
  const scheduler = new AutomationsScheduler({
    store,
    hostId: "host-a",
    now: () => now.value,
    async precheck() {
      prechecks.n += 1;
      return precheckFn ? precheckFn() : "ok";
    },
    async dispatch(_def, claimKey, _occ, kind) {
      dispatches.push({ claimKey, kind });
      return dispatchFn ? dispatchFn(claimKey, kind) : { ok: true, sessionId: `s-${dispatches.length}` };
    },
  });
  return { store, scheduler, dispatches, prechecks: prechecks, now };
}

describe("automations scheduler (T41.3)", () => {
  it("fires a due occurrence once and never again on the next tick (Dedupe)", async () => {
    const h = await harness();
    h.store.upsertDefinition(definition(), new Date(h.now.value).toISOString());
    await h.scheduler.tick();
    expect(h.dispatches).toHaveLength(1);
    expect(h.dispatches[0]!.kind).toBe("due");
    // 12:00 Lokal Winterzeit = 11:00 UTC; der Schlüssel liegt als UTC vor.
    expect(h.store.hasClaim(automationClaimKey("aut-1", 1, "2026-01-05T11:00:00.000Z"))).toBe(true);
    await h.scheduler.tick();
    expect(h.dispatches).toHaveLength(1);
    expect(h.store.claimsFor("aut-1")[0]!.state).toBe("dispatched");
  });

  it("a claim without dispatch stays unclear after restart — no blind replay", async () => {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    const now = () => Date.parse("2026-01-05T12:00:30.000Z");
    store.upsertDefinition(definition(), new Date(now()).toISOString());
    const key = automationClaimKey("aut-1", 1, "2026-01-05T11:00:00.000Z");
    store.claim("aut-1", 1, "2026-01-05T11:00:00.000Z", new Date(now()).toISOString()); // Crash nach Claim, vor Dispatch
    const dispatches: string[] = [];
    const scheduler = new AutomationsScheduler({
      store: new AutomationStore(root), // Neustart: alles aus Journal/Snapshot
      hostId: "host-a",
      now,
      async precheck() {
        return "ok";
      },
      async dispatch(_d, claimKey) {
        dispatches.push(claimKey);
        return { ok: true };
      },
    });
    await scheduler.tick();
    expect(dispatches).toEqual([]);
    expect(new AutomationStore(root).claimsFor("aut-1")[0]!.state).toBe("claimed"); // Unklarheit bleibt dokumentiert
    expect(key).toBeTruthy();
  });

  it("missed outside grace is skipped_missed; inside grace it catches up at most once", async () => {
    const h0 = await harness();
    h0.store.upsertDefinition(definition({ grant: { maxParallel: 1, missedGraceMs: 0 } }), "2026-01-05T10:55:00.000Z");
    h0.now.value = Date.parse("2026-01-05T13:00:30.000Z"); // Verzug 2 h > Grace 0
    await h0.scheduler.tick();
    expect(h0.dispatches).toHaveLength(0);
    expect(h0.store.claimsFor("aut-1")[0]!.state).toBe("skipped");
    expect(h0.store.claimsFor("aut-1")[0]!.reason).toBe("missed");

    // Grace 90 min, ein Termin im Fenster: genau einmal nachholen.
    const h1 = await harness();
    h1.store.upsertDefinition(definition({ grant: { maxParallel: 1, missedGraceMs: 90 * 60_000 } }), "2026-01-05T10:55:00.000Z");
    h1.now.value = Date.parse("2026-01-05T12:20:30.000Z");
    await h1.scheduler.tick();
    expect(h1.dispatches).toHaveLength(1);
    expect(h1.dispatches[0]!.kind).toBe("catchup");

    const h2 = await harness();
    h2.store.upsertDefinition(definition({ schedule: { kind: "cron", cron: "*/30 12 * * *", timezone: "Europe/Berlin" }, grant: { maxParallel: 1, missedGraceMs: 120 * 60_000 } }), "2026-01-05T10:55:00.000Z");
    h2.now.value = Date.parse("2026-01-05T13:00:30.000Z");
    await h2.scheduler.tick();
    const claims = h2.store.claimsFor("aut-1").sort((a, b) => a.occurrenceUtc.localeCompare(b.occurrenceUtc));
    expect(claims.map((c) => [c.occurrenceUtc, c.state === "skipped" ? c.reason : c.state])).toEqual([
      ["2026-01-05T11:00:00.000Z", "missed"],
      ["2026-01-05T11:30:00.000Z", "dispatched"],
    ]);
  });

  it("overlap skips instead of queueing (grant.maxParallel)", async () => {
    const h = await harness((_key, kind) => (kind === "due" ? { ok: true, sessionId: "still-running" } : { ok: true }));
    h.store.upsertDefinition(definition({ schedule: { kind: "cron", cron: "* * * * *", timezone: "Europe/Berlin" } }), "2026-01-05T10:59:00.000Z");
    await h.scheduler.tick(); // 11:00Z fällig -> dispatcht, bleibt offen (inFlight)
    h.now.value = Date.parse("2026-01-05T11:01:30.000Z");
    await h.scheduler.tick(); // 11:01Z -> Claim, aber Überlappung
    const claims = h.store.claimsFor("aut-1");
    const first = claims.find((c) => c.occurrenceUtc === "2026-01-05T11:00:00.000Z")!;
    const second = claims.find((c) => c.occurrenceUtc === "2026-01-05T11:01:00.000Z")!;
    expect(first.state).toBe("dispatched");
    expect(second.state).toBe("skipped");
    expect(second.reason).toBe("overlap");
    expect(h.dispatches).toHaveLength(1);
  });

  it("precheck verdicts and dispatch failures land as separate skip reasons", async () => {
    const h = await harness(undefined, () => "precheck_exit");
    h.store.upsertDefinition(definition({ precheckActionId: "gate-check", precheckDeadlineMs: 60_000 }), new Date(h.now.value).toISOString());
    await h.scheduler.tick();
    expect(h.prechecks.n).toBe(1);
    expect(h.dispatches).toHaveLength(0);
    expect(h.store.claimsFor("aut-1")[0]!.reason).toBe("precheck_exit");

    const h2 = await harness(() => ({ ok: false, reason: "auth" as const }));
    h2.store.upsertDefinition(definition(), new Date(h2.now.value).toISOString());
    await h2.scheduler.tick();
    expect(h2.store.claimsFor("aut-1")[0]!.reason).toBe("auth");
  });

  it("disabled definitions do nothing; run-now runs the precheck by default", async () => {
    const h = await harness();
    h.store.upsertDefinition(definition({ enabled: false, precheckActionId: "gate-check" }), new Date(h.now.value).toISOString());
    await h.scheduler.tick();
    expect(h.dispatches).toHaveLength(0);
    const claim = await h.scheduler.runNow("aut-1");
    expect(claim).not.toBeNull();
    expect(h.prechecks.n).toBe(1); // §3.3: ein definierter Precheck läuft bei run-now standardmäßig
    expect(h.dispatches).toHaveLength(1);
    expect(h.dispatches[0]!.kind).toBe("run_now");
  });

  it("K7: a fresh store on the same directory replays definitions and claims from disk", async () => {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    store.upsertDefinition(definition(), "2026-01-05T11:50:00.000Z");
    const claim = store.claim("aut-1", 1, "2026-01-05T11:00:00.000Z", "2026-01-05T12:00:30.000Z");
    store.updateClaim(claim!.claimKey, { state: "settled", outcome: "succeeded", swarmId: "run-9" }, "2026-01-05T12:05:00.000Z");
    store.saveSnapshot();
    store.claim("aut-1", 1, "2026-01-06T11:00:00.000Z", "2026-01-06T12:00:30.000Z"); // Journal-Zeile nach dem Snapshot
    const reopened = new AutomationStore(root);
    expect(reopened.definition("aut-1")?.label).toBe("Testlauf");
    const claims = reopened.claimsFor("aut-1").sort((a, b) => a.occurrenceUtc.localeCompare(b.occurrenceUtc));
    expect(claims).toHaveLength(2);
    expect(claims[0]!.state).toBe("settled");
    expect(claims[0]!.outcome).toBe("succeeded");
    expect(claims[1]!.state).toBe("claimed");
  });

  it("fake clock: start() fires on the interval without manual ticks", async () => {
    vi.useFakeTimers();
    try {
      const root = await tempRoot();
      const store = new AutomationStore(root);
      const now = { value: Date.parse("2026-01-05T10:59:30.000Z") };
      vi.setSystemTime(new Date(now.value));
      const dispatches: string[] = [];
      const scheduler = new AutomationsScheduler({
        store,
        hostId: "host-a",
        now: () => Date.now(),
        async precheck() {
          return "ok";
        },
        async dispatch() {
          dispatches.push("x");
          return { ok: true };
        },
      });
      store.upsertDefinition(definition(), new Date(now.value).toISOString());
      scheduler.start();
      await vi.advanceTimersByTimeAsync(65_000); // über die Minute hinaus -> 11:00Z (12:00 lokal) ist fällig
      expect(dispatches).toHaveLength(1);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("precheck deadline race: a slow precheck resolves as precheck_timeout, not as a late verdict", async () => {
    vi.useFakeTimers();
    try {
      const root = await tempRoot();
      const store = new AutomationStore(root);
      const now = { value: Date.parse("2026-01-05T11:00:30.000Z") };
      const dispatches: string[] = [];
      const scheduler = new AutomationsScheduler({
        store,
        hostId: "host-a",
        now: () => now.value,
        precheck: () => new Promise<PrecheckResult>(() => undefined), // meldet sich nie — nur die Frist kann entscheiden
        async dispatch(_def, claimKey) {
          dispatches.push(claimKey);
          return { ok: true };
        },
      });
      store.upsertDefinition(definition({ precheckActionId: "slow-gate", precheckDeadlineMs: 60_000 }), new Date(now.value).toISOString());
      const tick = scheduler.tick();
      await vi.advanceTimersByTimeAsync(61_000);
      await tick;
      expect(dispatches).toHaveLength(0);
      expect(store.claimsFor("aut-1")[0]!.state).toBe("skipped");
      expect(store.claimsFor("aut-1")[0]!.reason).toBe("precheck_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("host_down stays a separate reason on another host's definition", async () => {
    const h = await harness();
    h.store.upsertDefinition(definition({ hostId: "host-b" }), new Date(h.now.value).toISOString());
    const claim = await h.scheduler.runNow("aut-1");
    expect(claim).not.toBeNull();
    expect(claim!.state).toBe("skipped");
    expect(claim!.reason).toBe("host_down");
    expect(h.dispatches).toHaveLength(0);
  });
});

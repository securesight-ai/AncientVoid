import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

/** EPIC-P41 T41.5: hubctl automations gegen einen Fake-Hub — list/show/enable/run-now/create. */

const INFO = {
  automations: [
    {
      definition: {
        id: "auto-1", label: "Morgen-Briefing", generation: 1, enabled: false, hostId: "host-a",
        schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
        target: { kind: "session", harness: "dummy", project: "/tmp/repo", workdir: "worktree" },
        precheckDeadlineMs: 60_000, grant: { maxParallel: 1, missedGraceMs: 0 },
        createdAtUtc: "2026-11-12T07:00:00.000Z",
      },
      nextOccurrences: [{ utc: "2026-11-13T07:30:00.000Z", local: "2026-11-13 08:30" }],
      lastOccurrence: { utc: "2026-11-12T07:30:00.000Z", state: "skipped", reason: "precheck" },
    },
  ],
};

function fakeHub(): Promise<{ url: string; close: () => Promise<void>; requests: { method: string; url: string }[] }> {
  const requests: { method: string; url: string }[] = [];
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    requests.push({ method: req.method ?? "GET", url: req.url ?? "" });
    if (req.url === "/api/automations") {
      res.end(JSON.stringify(INFO));
      return;
    }
    if (req.url === "/api/automations/auto-1/history") {
      res.end(JSON.stringify({ automationId: "auto-1", history: [
        { claimKey: "auto-1:1:2026-11-12T07:30:00.000Z", automationId: "auto-1", generation: 1, occurrenceUtc: "2026-11-12T07:30:00.000Z", state: "skipped", reason: "precheck", at: "2026-11-12T07:30:02.000Z" },
      ] }));
      return;
    }
    if (req.url === "/api/automations/auto-1/enable") {
      res.end(JSON.stringify({ ...INFO.automations[0]!.definition, enabled: true }));
      return;
    }
    if (req.url === "/api/automations/auto-1/run-now") {
      res.statusCode = 202;
      res.end(JSON.stringify({ claimKey: "auto-1:1:run", automationId: "auto-1", generation: 1, occurrenceUtc: "2026-11-12T09:00:00.000Z", state: "dispatched", sessionId: "sess-9", at: "2026-11-12T09:00:01.000Z" }));
      return;
    }
    if (req.url === "/api/automations/auto-1/resolve") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { claimKey: string; note: string };
        res.end(JSON.stringify({ claimKey: parsed.claimKey, automationId: "auto-1", generation: 1, occurrenceUtc: "2026-11-12T09:00:00.000Z", state: "settled", outcome: "abandoned", detail: `manuell aufgegeben: ${parsed.note}`, at: "2026-11-12T10:00:00.000Z" }));
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/automations") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { definition: { id: string; target: { promptBlobSha256: string } } };
        res.statusCode = 201;
        res.end(JSON.stringify({ ...parsed.definition, id: parsed.definition.id || "neu-1", promptSha: parsed.definition.target.promptBlobSha256 }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "unbekannt" }));
  });
  return new Promise((ready) => {
    server.listen(0, "127.0.0.1", () => {
      ready({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        close: () => new Promise<void>((done, fail) => server.close(err => err ? fail(err) : done())),
        requests,
      });
    });
  });
}

it("P41: automations list/show drucken Plan, Vorschau, Verlauf und Skip-Grund", async () => {
  const hub = await fakeHub();
  try {
    const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args], {
      env: { ...process.env, ANCIENTVOID_URL: hub.url, ANCIENTVOID_TOKEN: "" },
    });
    const list = await run(["automations", "list"]);
    expect(list.stdout).toContain("Morgen-Briefing");
    expect(list.stdout).toContain("aus");
    expect(list.stdout).toContain("30 8 * * *");
    expect(list.stdout).toContain("skipped/precheck");
    const show = await run(["automations", "show", "auto-1"]);
    expect(show.stdout).toContain('"label"');
    expect(show.stdout).toContain("precheck");
    expect(hub.requests.some((r) => r.url === "/api/automations/auto-1/history")).toBe(true);
  } finally {
    await hub.close();
  }
});

it("P41: enable und run-now rufen die Operationen mit ihren Routen auf", async () => {
  const hub = await fakeHub();
  try {
    const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args], {
      env: { ...process.env, ANCIENTVOID_URL: hub.url, ANCIENTVOID_TOKEN: "" },
    });
    const enable = await run(["automations", "enable", "auto-1"]);
    expect(enable.stdout).toContain("aktiviert");
    const runNow = await run(["automations", "run-now", "auto-1"]);
    expect(runNow.stdout).toContain("dispatched");
    expect(runNow.stdout).toContain("sess-9");
    expect(hub.requests.some((r) => r.method === "POST" && r.url === "/api/automations/auto-1/enable")).toBe(true);
    expect(hub.requests.some((r) => r.method === "POST" && r.url === "/api/automations/auto-1/run-now")).toBe(true);
  } finally {
    await hub.close();
  }
});

it("ADR-0072: resolve gibt einen unklaren Start mit Notiz auf und verweigert ihn ohne", async () => {
  const hub = await fakeHub();
  try {
    const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args], {
      env: { ...process.env, ANCIENTVOID_URL: hub.url, ANCIENTVOID_TOKEN: "" },
    });
    await expect(run(["automations", "resolve", "auto-1", "auto-1:1:run"])).rejects.toThrow(/--note/);
    const out = await run(["automations", "resolve", "auto-1", "auto-1:1:run", "--note", "Hub", "abgestürzt"]);
    expect(out.stdout).toContain("settled abandoned");
    expect(out.stdout).toContain("manuell aufgegeben: Hub abgestürzt");
  } finally {
    await hub.close();
  }
});

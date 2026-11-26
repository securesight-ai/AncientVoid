import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

/** EPIC-P80 (ADR-0118, D6): hubctl scan gegen einen Fake-Hub — dieselbe Route wie die PWA. */

function fakeHub(): Promise<{ url: string; close: () => Promise<void>; requests: { method: string; url: string; body: string }[] }> {
  const requests: { method: string; url: string; body: string }[] = [];
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ method: req.method ?? "GET", url: req.url ?? "", body });
      if (req.method === "POST" && req.url === "/api/pentest/scan") {
        const parsed = JSON.parse(body) as { target: string; profile: string };
        if (parsed.target !== "100.64.0.1") {
          // D5: Allowlisten-Abbruch bleibt sichtbar — nie still.
          res.statusCode = 422;
          res.end(JSON.stringify({ error: `Ziel „${parsed.target}" steht nicht auf der Allowliste (D5).` }));
          return;
        }
        res.statusCode = 202;
        res.end(JSON.stringify({ job: { id: "6f6a8f3e-1f5d-4c60-9b4c-7a2f3d1e0b12", target: parsed.target, profile: parsed.profile, state: "done", summary: { hosts: 2, hostsUp: 1, portsOpen: 3, truncated: false } } }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "unbekannt" }));
    });
  });
  return new Promise((ready) => {
    server.listen(0, "127.0.0.1", () => {
      ready({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        close: () => new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        requests,
      });
    });
  });
}

const run = (hubUrl: string, args: string[]) =>
  promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args], {
    env: { ...process.env, ANCIENTVOID_URL: hubUrl, ANCIENTVOID_TOKEN: "" },
  });

it("P80: hubctl scan ruft die Scan-Route mit Ziel und Profil auf und zeigt den Job", async () => {
  const hub = await fakeHub();
  try {
    const out = await run(hub.url, ["scan", "100.64.0.1", "--profile", "services"]);
    expect(out.stdout).toContain("done");
    expect(out.stdout).toContain("100.64.0.1");
    expect(out.stdout).toContain("services");
    expect(hub.requests.some((r) => r.method === "POST" && r.url === "/api/pentest/scan")).toBe(true);
  } finally {
    await hub.close();
  }
});

it("P80: Allowlisten-Abbruch bleibt sichtbar — Fehler, nie ein stiller Ausstieg (Fail loud)", async () => {
  const hub = await fakeHub();
  try {
    await expect(run(hub.url, ["scan", "10.0.0.9"])).rejects.toThrow(/422/);
  } finally {
    await hub.close();
  }
});

it("P80: ohne Ziel bleibt es bei der Benutzung-Zeile (Exit 1)", async () => {
  const hub = await fakeHub();
  try {
    await expect(run(hub.url, ["scan"])).rejects.toThrow(/Command failed/);
    expect(hub.requests.some((r) => r.url === "/api/pentest/scan")).toBe(false);
  } finally {
    await hub.close();
  }
});

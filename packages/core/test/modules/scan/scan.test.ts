import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCAN_EVENT_MAX_BYTES } from "@ancientvoid/contracts";
import { ScanService, type ScanServiceConfig } from "@ancientvoid/core";
import { ScanBackendError } from "@ancientvoid/core";

/**
 * EPIC-P80 T80.5 (ADR-0118): Kerntests am echten Seam — Deck-Antworten kommen
 * von einer injizierten fetch (gemessene Fixtures), die Dateibaum ist ein
 * echtes temp-Verzeichnis (K7-Ernst). Kein Port, keine Wanduhr-Trickserei.
 */

const quickFixture = {
  code: 0,
  parsed: { hosts: [{ ip: "127.0.0.1", hostname: null, status: "Up", ports: ["22/tcp:closed"] }] },
  output: "Nmap done: 1 IP address (1 host up) scanned in 0.01 seconds\n",
};

/** Gemessen 25.11.2026: der Parser liefert Doppel-Einträge mit Statuszeilen-Artefakten. */
const servicesFixture = {
  code: 0,
  parsed: {
    hosts: [
      { ip: "100.113.133.42", hostname: null, status: "Status:", ports: [] },
      { ip: "100.113.133.42", hostname: null, status: "Ports:", ports: ["22/tcp:open", "631/tcp:open"] },
    ],
  },
  output: "x".repeat(8_000),
};

let dir: string;
let calls: { path: string; init?: RequestInit }[];

function deps() {
  return {
    readFile: async (path: string) => readFile(path, "utf8").catch(() => null),
    appendFile: async (path: string, data: string) => {
      await appendFile(path, data, "utf8");
    },
    writeFile: async (path: string, data: string) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, data, "utf8");
    },
    now: () => new Date(),
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ path: url, ...(init ? { init } : {}) });
      if (url.endsWith("/api/health")) return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      if (url.endsWith("/api/scan")) return { ok: true, status: 200, json: async () => servicesFixture } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    },
  };
}

function config(over: Partial<ScanServiceConfig> = {}): ScanServiceConfig {
  return {
    backendUrl: "http://deck.invalid",
    credentialsFile: null,
    enabled: true,
    probeIntervalMs: 30_000,
    timeoutMs: 310_000,
    windowHours: 720,
    targets: [{ label: "Kopf", target: "100.113.133.42", kind: "frei" }],
    tools: [{ tool: "nmap", risky: false }],
    ...over,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scan-test-"));
  calls = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("AC-P80-K5: Volltext als Blob, Zeile klein", () => {
  it("lagert den Output als Blob und hält die Journal-Zeile unter 4 KB", async () => {
    const service = new ScanService(config(), deps(), dir);
    const res = await service.scanNow({ target: "100.113.133.42", profile: "services" }, null);
    if (!res.ok) throw new Error(res.error);
    expect(res.job.blob).not.toBeNull();
    expect(res.job.summary?.portsOpen).toBe(2);
    const lines = (await readFile(join(dir, "journal.jsonl"), "utf8")).trim().split("\n");
    const letzte = lines[lines.length - 1]!;
    expect(Buffer.byteLength(letzte, "utf8")).toBeLessThanOrEqual(SCAN_EVENT_MAX_BYTES);
    expect(existsSync(join(dir, "blobs", `${res.job.blob!.hash}.json`))).toBe(true);
  });
});

describe("AC-P80-K7: Zustand aus Journal rekonstruierbar", () => {
  it("ein zweiter Dienst auf demselben Verzeichnis kennt Job und Detail", async () => {
    const a = new ScanService(config(), deps(), dir);
    const res = await a.scanNow({ target: "100.113.133.42", profile: "services" }, null);
    if (!res.ok) throw new Error(res.error);
    const b = new ScanService(config(), deps(), dir);
    await b.load();
    expect(b.jobs().map((j) => j.id)).toContain(res.job.id);
    const detail = await b.detail(res.job.id);
    expect(detail?.job.state).toBe("done");
    expect(detail?.parsed?.parsed?.hosts?.length ?? 0).toBeGreaterThan(0);
  });

  it("Läufe aus einem früheren Prozess sterben bei der Aufarbeitung sichtbar", async () => {
    await mkdir(join(dir), { recursive: true });
    await appendFile(join(dir, "journal.jsonl"), `${JSON.stringify({ id: "0f9f9a3f-9a3f-4a2a-8a3a-1a2b3c4d5e6f", target: "x", profile: "quick", tool: "nmap", state: "running", sourceRef: null, approvalId: null, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null, error: null, summary: null, blob: null })}\n`, "utf8");
    const service = new ScanService(config(), deps(), dir);
    await service.load();
    const job = service.jobs()[0];
    expect(job?.state).toBe("failed");
    expect(job?.error).toMatch(/neu gestartet/);
  });
});

describe("AC-P80-K9/K10: Backend-Ausfall sichtbar", () => {
  it("ohne Backend: Grund statt null", async () => {
    const service = new ScanService(config({ backendUrl: null }), deps(), dir);
    const s = service.status();
    expect(s.configured).toBe(false);
    expect(s.state).toBe("config");
    expect(s.detail).toMatch(/backendUrl|credentialsFile/i);
  });

  it("unreachable wird als Zustand sichtbar gemeldet", async () => {
    const d = deps();
    d.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const service = new ScanService(config(), d, dir);
    const s = await service.probe();
    expect(s.state).toBe("unreachable");
    expect(s.checkedAt).not.toBeNull();
  });

  it("ein Timeout stirbt sichtbar als Job-Zustand (Premortem 3)", async () => {
    const d = deps();
    d.fetch = async (url, init) => {
      if (url.endsWith("/api/health")) return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      });
      throw new Error("nie erreicht");
    };
    const service = new ScanService(config({ timeoutMs: 30 }), d, dir);
    const res = await service.scanNow({ target: "100.113.133.42", profile: "quick" }, null);
    expect(res.ok).toBe(false);
    expect(service.jobs()[0]?.state).toBe("timeout");
  });
});

describe("D5: Ziel-Allowliste ist die Sicherheitsgrenze", () => {
  it("Ziel außerhalb der Liste bricht sichtbar ab, bevor das Backend fragt", async () => {
    const service = new ScanService(config(), deps(), dir);
    const res = await service.scanNow({ target: "10.9.9.9" }, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Allowliste/);
    expect(calls.length).toBe(0);
    expect(service.jobs()).toHaveLength(0);
  });
});

describe("D4: riskante Tools über den Approval-Weg", () => {
  it("direkter Aufruf eines riskanten Tools ohne Freigabe bleibt sichtbar hängen", async () => {
    const service = new ScanService(config({ tools: [{ tool: "nmap", risky: false }] }), deps(), dir);
    const res = await service.scanNow({ target: "100.113.133.42", tool: "nuclei" }, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Freigabe/);
  });
});

describe("Kopfprobe und Detail", () => {
  it("Parade: quick auf gelistetes Ziel → done mit geparstern Hosts", async () => {
    const d = deps();
    const orig = d.fetch;
    d.fetch = async (url, init) => {
      const r = await orig(url, init);
      if (url.endsWith("/api/scan")) return { ok: true, status: 200, json: async () => quickFixture } as Response;
      return r;
    };
    const service = new ScanService(config(), d, dir);
    const res = await service.scanNow({ target: "100.113.133.42" }, null);
    if (!res.ok) throw new Error(res.error);
    expect(res.job.state).toBe("done");
    expect(res.job.summary?.hosts).toBe(1);
    const detail = await service.detail(res.job.id);
    expect(detail?.parsed?.parsed.hosts[0]?.ip).toBe("127.0.0.1");
  });

  it("unbekannte Antwortform wird als Protocol-Fehler sichtbar, nie geraten", async () => {
    const d = deps();
    d.fetch = async (url) => {
      if (url.endsWith("/api/health")) return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      return { ok: true, status: 200, json: async () => ({ code: 0, parsed: { hosts: [{ ip: 42 }] } }) } as Response;
    };
    const service = new ScanService(config(), d, dir);
    const res = await service.scanNow({ target: "100.113.133.42" }, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ungültig|bekannt/);
  });
});

describe("ScanBackendError", () => {
  it("trägt den Zustand für den Statusweg", () => {
    expect(new ScanBackendError("unauthorized", "test").state).toBe("unauthorized");
  });
});

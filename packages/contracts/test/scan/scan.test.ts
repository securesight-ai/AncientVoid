import { describe, expect, it } from "vitest";
import {
  PentestScanJob,
  PentestScanRequest,
  PentestStatus,
  SCAN_EVENT_MAX_BYTES,
  SCAN_TARGET_PATTERN,
  ScanBackendResponse,
  ScanTargetEntry,
  ScanTool,
} from "@ancientvoid/contracts";

/**
 * EPIC-P80 T80.5 (ADR-0118): Contract-Unit an Fixture-Deck-Antworten — die
 * fixtures sind die gemessenen echten Antworten des Backends (Live-Test
 * 22.11.2026, anonymisiert, secret-gescannt). Unbekannte Formen werden
 * abgewiesen, nicht durchgereicht (fail loud, PRD §8.5).
 */

// Gemessene quick-Antwort (localhost) — klein, aber in voller Form.
const quickFixture = {
  code: 0,
  parsed: { hosts: [{ ip: "127.0.0.1", hostname: null, status: "Up", ports: ["22/tcp:closed"] }] },
  output: "Starting Nmap 7.95 ( https://nmap.org )\nNmap scan report for localhost (127.0.0.1)\nHost is up (0.00012s latency).\n",
};

// Gemessene services-Antwort — Output nahe der Backend-Kappe, response > 4 KB (K5-Messung im ADR).
const servicesFixture = {
  code: 0,
  parsed: {
    hosts: [
      { ip: "100.113.133.42", hostname: null, status: "Up", ports: ["22/tcp:open", "631/tcp:open", "3020/tcp:filtered"] },
      { ip: "100.64.0.0", hostname: null, status: null, ports: [] },
    ],
  },
  output: "x".repeat(8_000),
};

describe("Deck-Antworten (gemessene Fixtures)", () => {
  it("liest die gemessene quick-Antwort verlustfrei", () => {
    const parsed = ScanBackendResponse.parse(quickFixture);
    expect(parsed.parsed.hosts[0]?.ip).toBe("127.0.0.1");
    expect(parsed.parsed.hosts[0]?.hostname).toBeNull();
  });

  it("liest die services-Antwort bis an die Output-Kappe", () => {
    const parsed = ScanBackendResponse.parse(servicesFixture);
    expect(parsed.parsed.hosts).toHaveLength(2);
    expect(parsed.output).toHaveLength(8_000);
    expect(JSON.stringify(parsed).length).toBeGreaterThan(SCAN_EVENT_MAX_BYTES); // die K5-Messgröße, ADR-0118
  });

  it("weist formfremde Antworten ab statt sie zu raten", () => {
    expect(ScanBackendResponse.safeParse({ code: 0, parsed: {}, output: null }).success).toBe(false);
    expect(ScanBackendResponse.safeParse({ code: 0, parsed: { hosts: [{ ip: 1 }] }, output: null }).success).toBe(false);
    expect(ScanBackendResponse.safeParse({ code: "0", parsed: { hosts: [] }, output: null }).success).toBe(false);
  });
});

describe("Ziele und Tools (D4/D5)", () => {
  it("lässt den Zielzeichensatz des Backends, keinen Shell-Quatsch", () => {
    expect(SCAN_TARGET_PATTERN.test("100.113.133.42")).toBe(true);
    expect(SCAN_TARGET_PATTERN.test("10.0.0.0/24")).toBe(true);
    expect(SCAN_TARGET_PATTERN.test("beispiel.example")).toBe(true);
    expect(SCAN_TARGET_PATTERN.test("fe80::1")).toBe(true);
    expect(SCAN_TARGET_PATTERN.test("localhost; rm -rf /")).toBe(false);
    expect(SCAN_TARGET_PATTERN.test("$(whoami)")).toBe(false);
  });

  it("Target-Entry nimmt nur known targets (Allowliste) und deklariert Tools mit Risiko", () => {
    expect(ScanTargetEntry.safeParse({ label: "Kopf", target: "100.113.133.42", kind: "inventar" }).success).toBe(true);
    expect(ScanTool.safeParse("nmap").success).toBe(true);
    expect(ScanTool.safeParse("nuclei").success).toBe(true);
    expect(ScanTool.safeParse("bash").success).toBe(false);
  });
});

describe("POST /api/pentest/scan", () => {
  it("füllt Profil und Tool mit den unkritischenDefaults", () => {
    const req = PentestScanRequest.parse({ target: "127.0.0.1" });
    expect(req.profile).toBe("quick");
    expect(req.tool).toBe("nmap");
  });

  it("weist ein Ziel außerhalb des Zeichensatzes ab (D5: sichtbarer Abbruch, kein stiller Drop)", () => {
    expect(PentestScanRequest.safeParse({ target: "127.0.0.1; nc evil 9" }).success).toBe(false);
  });
});

describe("Journal-Zeile (K5: Zusammenfassung + Blob-Referenz)", () => {
  it("hält die K5-Grenze, wenn der Output als Blob ausgelagert ist", () => {
    const zeile = {
      id: "9a1d4f66-2d3e-4a41-b2b7-1f2c3d4e5f60",
      target: "100.113.133.42",
      profile: "services",
      tool: "nmap",
      state: "done",
      sourceRef: "deck-scan-4711",
      approvalId: null,
      createdAt: "2026-11-22T10:00:00.000Z",
      startedAt: "2026-11-22T10:00:01.000Z",
      finishedAt: "2026-11-22T10:02:03.000Z",
      error: null,
      summary: { hosts: 2, hostsUp: 1, portsOpen: 2, truncated: false },
      blob: { hash: "a".repeat(64), bytes: 8_312 },
    };
    expect(JSON.stringify(zeile).length).toBeLessThanOrEqual(SCAN_EVENT_MAX_BYTES);
    expect(PentestScanJob.parse(zeile).state).toBe("done");
  });

  it("kennt den sichtbaren Timeout-Zustand (Premortem 3: der Job stirbt sichtbar)", () => {
    const zeile = { id: "9a1d4f66-2d3e-4a41-b2b7-1f2c3d4e5f60", target: "a.example", profile: "quick", tool: "nmap", state: "timeout", createdAt: "", sourceRef: null, approvalId: null, startedAt: null, finishedAt: null, error: "Backend antwortete nicht bis zur Zeitgrenze", summary: null, blob: null };
    expect(PentestScanJob.parse(zeile).state).toBe("timeout");
    expect(PentestScanJob.safeParse({ ...zeile, state: "zerfallen" }).success).toBe(false);
  });
});

describe("Statusweg (K9/K10)", () => {
  it("meldet die Konfigurationslosigkeit als Grund statt null", () => {
    const s = PentestStatus.parse({ configured: false, state: "config", detail: "pentest-Block fehlt in der Konfiguration", checkedAt: null, probeIntervalMs: 30_000 });
    expect(s.state).toBe("config");
  });
});

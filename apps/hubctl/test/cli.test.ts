import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildWsUrl, formatHealth } from "../src/cli.ts";

// usage-Assertions erwarten Englisch (Default) — Umgebungssprache nicht durchgreifen lassen (EPIC-P61 T61.8).
process.env.AV_LANG = "en";

/**
 * BUG-0005: `followWs()` built its WS URL with `BASE.replace(/^https?/, "")`
 * — that regex strips "http(s)" but not the trailing ":", so
 * "http://127.0.0.1:7373" became "ws:://127.0.0.1:7373" (invalid URL).
 * hubctl had no tests at all before this, which is exactly how a CLI whose
 * README quick-start literally demonstrates `hubctl tail -f` shipped with
 * that path permanently broken.
 */
describe("buildWsUrl", () => {
  it("maps http:// to ws:// without a double colon", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "", "sess-1");
    expect(url).toBe("ws://127.0.0.1:7373/api/events/sess-1/tail");
  });

  it("maps https:// to wss://", () => {
    const url = buildWsUrl("https://hub.tailnet.ts.net", "", "sess-1");
    expect(url).toBe("wss://hub.tailnet.ts.net/api/events/sess-1/tail");
  });

  it("appends the token as an encoded query param when present", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "a b/c", "sess-1");
    expect(url).toBe("ws://127.0.0.1:7373/api/events/sess-1/tail?token=a%20b%2Fc");
  });

  it("omits the query string entirely when there is no token", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "", "sess-1");
    expect(url).not.toContain("?");
  });

  it("produces a URL the WHATWG URL parser accepts", () => {
    expect(() => new URL(buildWsUrl("http://127.0.0.1:7373", "tok", "sess-1"))).not.toThrow();
  });
});

describe("formatHealth (T4.5-6)", () => {
  it("prints status, session counts and checks when present", () => {
    expect(
      formatHealth({
        ok: true,
        status: "ok",
        adapters: [{ id: "dummy", version: "0.1.0" }],
        checks: { database: { ok: true }, eventStore: { ok: true } },
        sessions: { live: 1, total: 2 },
      }),
    ).toEqual([
      "ok: true  status=ok",
      "  sessions live=1 total=2",
      "  checks db=ok store=ok",
      "  adapter dummy@0.1.0",
    ]);
  });

  it("still works with the pre-P4.5 {ok, adapters} payload", () => {
    expect(formatHealth({ ok: true, adapters: [] })).toEqual(["ok: true"]);
  });
});

describe("token issue label validation (BUG-0108)", () => {
  const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args]);

  // EPIC-P43 T43.10 (ADR-0066): die Antwort-Fähigkeit gibt es nur für ein Display.
  it("--answer-questions is refused without --display and listed with it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-hubctl-"));
    const db = join(dir, "hub.db");
    try {
      const err = await run(["token", "issue", "pixel", "--answer-questions", "--db", db]).catch((e: unknown) => e as { code?: number });
      expect((err as { code?: number }).code).toBe(1);
      const issued = await run(["token", "issue", "kiosk", "--display", "--answer-questions", "--db", db]);
      expect(issued.stdout).toContain('token for "display:kiosk" (may answer option questions)');
      await run(["token", "issue", "nyx", "--display", "--db", db]);
      const list = (await run(["token", "list", "--db", db])).stdout.split("\n");
      expect(list.find((l) => l.startsWith("display:kiosk"))).toContain("capabilities=display.answer_questions");
      expect(list.find((l) => l.startsWith("display:nyx"))).not.toContain("capabilities=");
      expect(list.some((l) => l.startsWith("pixel"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an empty label with usage/exit 1 — the CLI must not mint tokens the API would refuse", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-hubctl-"));
    try {
      const err = await run(["token", "issue", "", "--db", join(dir, "hub.db")]).catch((e: unknown) => e as { code?: number; stdout?: string });
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: number }).code).toBe(1);
      expect(((err as { stdout?: string }).stdout ?? "")).toContain("Usage:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still issues a token for a real label (guard against over-blocking)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-hubctl-"));
    try {
      const out = await run(["token", "issue", "cli-test", "--db", join(dir, "hub.db")]);
      expect(out.stdout).toContain("token for \"cli-test\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

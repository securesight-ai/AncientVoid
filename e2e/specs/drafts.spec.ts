import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test, expect, dockGo } from "../support/fixtures.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

test.describe("Entwürfe (T8.4, AC-P8-4)", () => {
  test("ein Entwurf übersteht Navigation und Neuladen und erscheint auf dem zweiten Gerät — ohne gesendet zu werden", async ({ app, hub, browser }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.fill("Bitte noch die Randfälle");
    await expect.poll(async () => (await hub.api<{ text: string }>(`/api/sessions/${id}/draft`)).body.text).toBe("Bitte noch die Randfälle");
    await app.getByLabel("Zur Übersicht").click();
    await app.locator(".session-open").first().click();
    await expect(field).toHaveValue("Bitte noch die Randfälle");
    await app.reload();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Bitte noch die Randfälle");

    const other = await (await browser.newContext()).newPage();
    await other.addInitScript((t) => localStorage.setItem("ancientvoid.token", t), hub.token);
    await other.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(other.getByPlaceholder("Antworten…")).toHaveValue("Bitte noch die Randfälle");
    // Only typing — no turn was started by either device.
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);

    // Sent from the second device: gone everywhere.
    await other.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await expect(other.getByPlaceholder("Antworten…")).toHaveValue("");
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("", { timeout: 10_000 });
  });

  test("zwei Geräte ändern gleichzeitig: Konflikt zur Wahl, keine stille Überschreibung", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Version vom Handy");
    await expect.poll(async () => (await hub.api<{ text: string }>(`/api/sessions/${id}/draft`)).body.text).toBe("Version vom Handy");
    // The PC goes offline in thought: it edits on top of the same revision, the phone saves first.
    const d = (await hub.api<{ revision: number }>(`/api/sessions/${id}/draft`)).body;
    const res = await fetch(`${hub.origin}/api/sessions/${id}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${hub.token}` },
      body: JSON.stringify({ text: "Version vom PC", attachmentIds: [], baseRevision: d.revision }),
    });
    expect(res.status).toBe(200);
    await app.getByPlaceholder("Antworten…").fill("Version vom Handy, ergänzt");
    const conflict = app.locator(".draft-conflict");
    await expect(conflict).toContainText("Version vom PC");
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Version vom Handy, ergänzt");
    await conflict.getByRole("button", { name: "Meinen behalten" }).click();
    await expect(conflict).toHaveCount(0);
    await expect.poll(async () => (await hub.api<{ text: string }>(`/api/sessions/${id}/draft`)).body.text).toBe("Version vom Handy, ergänzt");
  });

  test("Antwort kopieren", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();

    const answer = app.locator(".tail-scroll .event.assistant").first();
    await answer.getByRole("button", { name: "Kopieren" }).click();
    await expect(answer.getByRole("button", { name: "kopiert" })).toBeVisible();
    const copied = await app.evaluate(() => (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText());
    expect(copied).toMatch(/^Antwort auf: Start/);
  });

  test("Neue Session merkt sich Harness und Projekt und hält den Start-Prompt als Entwurf", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Halb geschrieben");
    await app.reload();
    await expect(app.getByPlaceholder("Refactore den Auth-Flow…")).toHaveValue("Halb geschrieben");
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app.locator(".session-topbar")).toContainText("opencode");
    await app.getByLabel("Zur Übersicht").click();
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Adapter")).toHaveValue("opencode");
    await expect(app.getByPlaceholder("Refactore den Auth-Flow…")).toHaveValue("");
    expect((await hub.sessions()).length).toBe(1);
  });

  test("AC-P8-4: ein anderes Gerätetoken sieht keine Entwürfe und gespeicherten Stände des vorherigen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Privater Entwurf");
    await expect.poll(async () => (await hub.api<{ text: string }>(`/api/sessions/${id}/draft`)).body.text).toBe("Privater Entwurf");
    await app.waitForTimeout(1200);
    const before = await app.evaluate(() => Object.keys((globalThis as unknown as { localStorage: Record<string, unknown> }).localStorage).filter((k) => k.startsWith("ancientvoid.draft.") || k.startsWith("ancientvoid.tail.")));
    expect(before.length).toBeGreaterThan(0);
    const other = execFileSync(process.execPath, [join(repoRoot, "apps/hubctl/src/cli.ts"), "token", "issue", "zweites-geraet", "--db", join(hub.dataDir, "hub.db")], { encoding: "utf8" })
      .split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"))!;
    await app.getByLabel("Zur Übersicht").click();
    await dockGo(app, "Einstellungen");
    await app.getByRole("button", { name: "Geräte-Token wechseln" }).click();
    await app.getByPlaceholder(/z\. B\./).fill(other);
    const checkStartedAt = Date.now();
    const authCheck = app.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/adapters",
    { timeout: 30_000 });
    let releaseFleetHello: (() => void) | undefined;
    let fleetHelloStarted!: () => void;
    let fleetHelloFinished!: () => void;
    const fleetHelloRequest = new Promise<void>((resolve) => { fleetHelloStarted = resolve; });
    const fleetHelloHandled = new Promise<void>((resolve) => { fleetHelloFinished = resolve; });
    await app.route("**/api/fleet/hello", async (route) => {
      fleetHelloStarted();
      try {
        await new Promise<void>((resolve) => { releaseFleetHello = resolve; });
        await route.continue();
      } finally {
        fleetHelloFinished();
      }
    });
    try {
      await app.getByRole("button", { name: "Verbinden" }).click();
      const authResponse = await authCheck;
      expect(authResponse.status()).toBe(200);
      const authLatencyMs = Date.now() - checkStartedAt;
      if (authLatencyMs > 5_000) test.info().annotations.push({ type: "slow auth check", description: `/api/adapters took ${authLatencyMs} ms` });
      await fleetHelloRequest;
      // Token acceptance must expose the app even while this discovery call is held.
      await expect(app.getByRole("button", { name: "Verbinden", exact: true })).toHaveCount(0);
    } finally {
      if (releaseFleetHello) {
        releaseFleetHello();
        await fleetHelloHandled;
      }
      await app.unroute("**/api/fleet/hello");
    }
    const after = await app.evaluate(() => Object.keys((globalThis as unknown as { localStorage: Record<string, unknown> }).localStorage).filter((k) => k.startsWith("ancientvoid.draft.") || k.startsWith("ancientvoid.tail.")));
    expect(after).toEqual([]);
  });
});

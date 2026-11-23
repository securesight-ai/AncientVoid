import { test, expect, sessionTab, hostedRunner, dockGo } from "../support/fixtures.ts";

test("Presets: speichern, offline importieren, unsichere Daten ablehnen und zurücksetzen @desktop", async ({ app, hub, context }, info) => {
  await app.goto(`${hub.origin}/#/einstellungen`);
  const section = app.locator(".settings-section").filter({ has: app.getByRole("heading", { name: "Darstellungs- und Layout-Presets" }) });
  const coarse = await app.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect((await app.getByLabel("Codegröße", { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(coarse ? 44 : 30);
  await app.getByLabel("Dichte", { exact: true }).selectOption("compact");
  await app.getByLabel("Chatbreite", { exact: true }).selectOption("readable");
  await app.getByLabel("Preset-Name", { exact: true }).fill("Lesen");
  await app.getByRole("button", { name: "Darstellung und Layout speichern", exact: true }).click();
  await app.getByRole("button", { name: "Preset exportieren", exact: true }).click();
  const json = app.getByLabel("Preset-JSON", { exact: true });
  const exported = await json.inputValue();
  expect(JSON.parse(exported)).toMatchObject({ version: 1, density: "compact", chatWidth: "readable" });
  expect(exported).not.toContain(hub.token);
  await app.reload();
  await app.getByRole("button", { name: "Preset anwenden: Lesen", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-density", "compact");
  await context.setOffline(true);
  await json.fill(exported);
  await app.getByRole("button", { name: "Preset importieren", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-chat-width", "readable");
  for (const patch of [{ version: 99 }, { css: "body{display:none}" }, { ok: "#fff" }, { background: "https://example.com/a.png" }, { surface: "#ffffff" }]) {
    await json.fill(JSON.stringify({ ...JSON.parse(exported), ...patch }));
    await app.getByRole("button", { name: "Preset importieren", exact: true }).click();
    await expect(section.getByRole("status", { name: "Preset-Status" })).not.toHaveText("Gespeichert — nur auf diesem Gerät.");
    await expect(app.locator("html")).toHaveAttribute("data-density", "compact");
  }
  await app.getByRole("button", { name: "Darstellung zurücksetzen", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-density", "comfortable");
  await expect(app.locator("html")).toHaveAttribute("data-chat-width", "full");
  await context.setOffline(false);
  await app.screenshot({ path: info.outputPath("p43.5-presets-dark.png"), fullPage: true });
  await section.getByRole("button", { name: "Hell", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(app.getByRole("group", { name: "Erscheinungsbild", exact: true }).getByRole("button", { name: "Hell", exact: true })).toHaveAttribute("aria-pressed", "true");
  await app.screenshot({ path: info.outputPath("p43.5-presets-light.png"), fullPage: true });
});

test("Layout und Handy-Fenstergröße überleben Reload und kleine Anzeige @desktop", async ({ app, hub }) => {
  await app.goto(`${hub.origin}/#/einstellungen`);
  await app.getByRole("button", { name: "Browser-Fenster-Preset Handy", exact: true }).click();
  await app.getByLabel("Preset-Name", { exact: true }).fill("Handy");
  await app.getByRole("button", { name: "Darstellung und Layout speichern", exact: true }).click();
  await app.setViewportSize({ width: 390, height: 844 });
  await app.reload();
  await app.getByRole("button", { name: "Preset anwenden: Handy", exact: true }).click();
  await app.getByRole("button", { name: "Preset exportieren", exact: true }).click();
  const p = JSON.parse(await app.getByLabel("Preset-JSON", { exact: true }).inputValue());
  expect(p.layout.window).toMatchObject({ width: 390, height: 844 });
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe("P43.5 K2 Messlauf", () => {
  test.skip(hostedRunner, "BUG-0163: Frame-Budget-Messlatte misst lokale Hardware, nicht gemietete Runner");
  test.use({ hubOptions: { dummyAutoStop: 0, dummyEventsPerSecond: 30 } });
  test("30 Events/s mit kompaktem Lesepreset ohne Frame-Lag über 200 ms @desktop", async ({ app, hub }, info) => {
    await app.goto(`${hub.origin}/#/einstellungen`);
    await app.getByLabel("Dichte", { exact: true }).selectOption("compact");
    await app.getByLabel("Chatbreite", { exact: true }).selectOption("readable");
    const id = await hub.createSession({ adapter: "dummy", prompt: "K2 bei 30 Events/s" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll")).toBeVisible();
    await sessionTab(app, "Verlauf");
    await app.getByRole("button", { name: "Debuggen", exact: true }).click();
    await app.evaluate(() => {
      const times: Record<string, number> = {};
      (window as unknown as { k2Rendered: Record<string, number> }).k2Rendered = times;
      const root = document.querySelector(".tail-scroll")!;
      let scheduled = false;
      new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          const now = Date.now();
          root.querySelectorAll<HTMLElement>(".event[data-seq]").forEach(node => { times[node.dataset.seq!] ??= now; });
        });
      }).observe(root, { childList: true, subtree: true });
    });
    const rounds: { max: number; p95: number; frames: number; events: number; renderMax: number; renderP95: number; rendered: number }[] = [];
    for (let round = 0; round < 3; round++) {
      const before = (await hub.events(id)).length;
      const measurementStart = Date.now();
      const frames = await app.evaluate(async () => new Promise<number[]>(resolve => {
        const out: number[] = [];
        let previous = performance.now();
        const start = previous;
        const tick = (now: number) => {
          out.push(now - previous);
          previous = now;
          if (now - start >= 2100) resolve(out); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      const events = (await hub.events(id)).length - before;
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const renderedAt = await app.evaluate(() => (window as unknown as { k2Rendered: Record<string, number> }).k2Rendered);
      const journal = (await hub.api<{ seq: number; ts: string }[]>(`/api/sessions/${id}/events?limit=2000`)).body;
      const lags = journal.filter(e => Date.parse(e.ts) >= measurementStart && renderedAt[e.seq] !== undefined).map(e => renderedAt[e.seq]! - Date.parse(e.ts)).sort((a, b) => a - b);
      expect(lags.length).toBeGreaterThanOrEqual(45);
      const result = { renderMax: Math.max(...lags), renderP95: lags[Math.floor(lags.length * 0.95)]!, rendered: lags.length, max: Math.max(...sorted), p95: sorted[Math.floor(sorted.length * 0.95)]!, frames: sorted.length, events };
      rounds.push(result);
      expect(events).toBeGreaterThanOrEqual(45);
      expect(result.max).toBeLessThan(200);
      expect(result.renderMax).toBeLessThan(200);
    }
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    console.log("P43.5 K2", JSON.stringify(rounds));
    await info.attach("k2-p43.5.json", { body: JSON.stringify({ date: new Date().toISOString(), node: process.version, browser: app.context().browser()?.version(), rounds }), contentType: "application/json" });
    await app.screenshot({ path: info.outputPath("p43.5-chat.png") });
  });
});

test("Freigabe bleibt im kompakten Preset einhändig erreichbar und Ack unter 5 s @desktop @tablet", async ({ app, hub }, info) => {
  await app.goto(`${hub.origin}/#/einstellungen`);
  await app.getByLabel("Dichte", { exact: true }).selectOption("compact");
  const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
  await app.goto(`${hub.origin}/#/`);
  const approve = app.locator(".session-card").filter({ hasText: "WERKZEUG" }).getByRole("button", { name: "Erlauben", exact: true });
  await expect(approve).toBeVisible();
  const box = (await approve.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(30);
  const viewport = app.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  const start = performance.now();
  await approve.click();
  await hub.until(async () => (await hub.api<{ sessionId: string; status: string }[]>("/api/approvals")).body.some(a => a.sessionId === id && a.status === "approved"), "approved");
  const ackMs = performance.now() - start;
  expect(ackMs).toBeLessThan(5000);
  await info.attach("approval-latency.json", { body: JSON.stringify({ ackMs, scope: "UI tap to hub ack; excludes push and biometrics" }), contentType: "application/json" });
});

test("Benanntes Kachel-Layout stellt Größen wieder her und behält Sessions @desktop", async ({ app, hub }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  const id = await hub.createSession({ adapter: "opencode", prompt: "Layout behalten" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await app.getByRole("button", { name: "Zwei nebeneinander", exact: true }).click();
  await dockGo(app, "Einstellungen");
  await app.getByLabel("Preset-Name", { exact: true }).fill("Zwei Spalten");
  await app.getByRole("button", { name: "Darstellung und Layout speichern", exact: true }).click();
  await expect(app.getByRole("button", { name: "Preset anwenden: Zwei Spalten", exact: true })).toBeVisible();
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await app.getByRole("button", { name: "Eine Kachel", exact: true }).click();
  await dockGo(app, "Einstellungen");
  await app.getByRole("button", { name: "Preset anwenden: Zwei Spalten", exact: true }).click();
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await expect(app.getByRole("button", { name: "Zwei nebeneinander", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(app.locator(".tile")).toHaveCount(2);
  await app.reload();
  await expect(app.locator(".tile")).toHaveCount(2);
  await expect(app.locator(".tile.focused")).toContainText("Layout behalten");
});

test("Lokales Rasterbild im Preset wird offline verwendet und per Reset entfernt @desktop", async ({ app, hub, context }) => {
  await app.goto(`${hub.origin}/#/einstellungen`);
  await app.getByLabel("Lokales Hintergrundbild", { exact: true }).setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1L8AAAAASUVORK5CYII=", "base64") });
  await expect.poll(() => app.evaluate(() => getComputedStyle(document.body).backgroundImage)).toContain("data:image/png;base64,");
  await app.getByRole("button", { name: "Preset exportieren", exact: true }).click();
  const json = await app.getByLabel("Preset-JSON", { exact: true }).inputValue();
  expect(JSON.parse(json).background).toMatch(/^data:image\/png;base64,/);
  await context.setOffline(true);
  await app.getByRole("button", { name: "Bild entfernen", exact: true }).click();
  await expect.poll(() => app.evaluate(() => getComputedStyle(document.body).backgroundImage)).toBe("none");
  await app.getByLabel("Preset-JSON", { exact: true }).fill(json);
  await app.getByRole("button", { name: "Preset importieren", exact: true }).click();
  await expect.poll(() => app.evaluate(() => getComputedStyle(document.body).backgroundImage)).toContain("data:image/png;base64,");
  await context.setOffline(false);
});

test("Benanntes Fenster-Layout öffnet das gespeicherte Ziel nach Reload wieder @desktop", async ({ app, hub, context }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await app.goto(`${hub.origin}/#/einstellungen`);
  const child = await context.newPage();
  await child.goto(`${hub.origin}/?window=1#/einstellungen`);
  await expect(child.getByLabel("Dichte", { exact: true })).toBeVisible();
  await expect(app.getByRole("status", { name: "Statusleiste" })).toContainText("1 Fenster");
  await app.getByLabel("Preset-Name", { exact: true }).fill("Mit Einstellungen");
  await app.getByRole("button", { name: "Darstellung und Layout speichern", exact: true }).click();
  await child.close();
  await app.reload();
  await app.getByRole("button", { name: "Preset anwenden: Mit Einstellungen", exact: true }).click();
  const opened = context.waitForEvent("page");
  await app.getByRole("button", { name: "Fenster 1 wiederherstellen (tool)", exact: true }).click();
  const restored = await opened;
  await expect(restored.getByLabel("Dichte", { exact: true })).toBeVisible();
  await restored.close();
});

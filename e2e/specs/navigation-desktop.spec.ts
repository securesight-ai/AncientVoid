import { test, expect } from "../support/fixtures.ts";

test.describe("Desktop-Navigation (EPIC-P23)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC-P23-1: Klick auf AncientVoid führt in die Übersicht, die zuletzt aktive Session ist markiert und bleibt es nach Reload @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");
    // von einer anderen Seite aus: Einstellungen, dann AncientVoid
    await app.locator(".split-list .dock-item[data-tip=\"Einstellungen\"]").click();
    await expect(app).toHaveURL(/#\/einstellungen/);
    await app.getByRole("button", { name: "AncientVoid", exact: true }).click();
    await expect(app).toHaveURL(/#\/$|#$|#\/uebersicht/);
    const marked = app.locator(".split-list .session-card[aria-current]");
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText("Erste Aufgabe");
    // wer eine andere Session fokussiert, ändert die Markierung
    await app.locator(".split-list .session-card").filter({ hasText: "Zweite Aufgabe" }).locator(".session-open").click();
    await expect(app.getByRole("status", { name: "Statusleiste" })).toContainText("Zweite Aufgabe · opencode");
    await app.getByRole("button", { name: "AncientVoid", exact: true }).click();
    await expect(app.locator(".split-list .session-card[aria-current]")).toContainText("Zweite Aufgabe");
    await app.reload();
    await expect(app.locator(".split-list .session-card[aria-current]")).toContainText("Zweite Aufgabe");
  });

  test("AC-P23-2: die Statusleiste zeigt Verbindung, Flotte, Session-Zähler und die fokussierte Session @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    const bar = app.getByRole("status", { name: "Statusleiste" });
    await expect(bar).toContainText("verbunden");
    await expect(bar).toContainText("lokal");
    await expect(bar).toContainText(/\d+ läuft · \d+ wartet · \d+ Fehler · \d+ bereit/);
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(bar).toContainText("Erste Aufgabe · opencode");
    // sitzt unten, über die ganze Breite, und das Fenster scrollt weiter nie
    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(899);
    expect(box!.width).toBeGreaterThanOrEqual(1430);
    expect(await app.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  });

  test("AC-P23-3: die Statusleiste gibt es nur am Desktop, am Handy bleibt alles wie es war", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    await app.reload();
    await expect(app.locator(".status-bar")).toHaveCount(0);
    await expect(app.locator(".dock")).toBeVisible();
  });
});

import { test, expect, enableAutoTiling } from "../support/fixtures.ts";

/** PC und Tablet nutzen ab 700 px denselben Grid-Arbeitsplatz; darunter bleibt der Handy-Ablauf. */
test.describe("Tablet", () => {
  test("Portrait (800 px): Grid und dauerhafte Sidebar, Session per Tap @tablet", async ({ app, hub }) => {
    await app.setViewportSize({ width: 800, height: 1280 });
    await hub.createSession({ adapter: "opencode", prompt: "Tablet-Aufgabe" });
    await expect(app.locator(".split")).toBeVisible();
    await expect(app.getByRole("navigation", { name: "Sidebar", exact: true })).toBeVisible();
    await app.locator(".split-list .session-card").filter({ hasText: "Tablet-Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".session-top-title")).toHaveText("Tablet-Aufgabe");
  });

  test("Sessionliste und vorhandene Karten bleiben hochkant wie quer erhalten @tablet", async ({ app, hub }) => {
    const first = await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await app.setViewportSize({ width: 800, height: 1280 });
    await app.goto(`${hub.origin}/#/sessions/${first}`);
    await expect(app.locator('.tile[data-tile="1"] .session-top-title')).toHaveText("Erste Aufgabe");
    await enableAutoTiling(app);
    await app.locator(".split-list .session-card").filter({ hasText: "Zweite Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".tile")).toHaveCount(2);
    for (const width of [800, 1024, 1280]) {
      await app.setViewportSize({ width, height: 900 });
      const [list, detail] = await Promise.all([app.locator(".split-list").boundingBox(), app.locator(".split-detail").boundingBox()]);
      expect(list!.x + list!.width).toBeLessThanOrEqual(detail!.x);
      await expect(app.locator('.tile[data-tile="1"] .session-top-title')).toHaveText("Erste Aufgabe");
      await expect(app.locator('.tile[data-tile="2"] .session-top-title')).toHaveText("Zweite Aufgabe");
      expect(await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }
  });

  test("Am Handy gibt es keinen Streifen", async ({ app, hub }, info) => {
    test.skip(info.project.name !== "mobile", "Handy-Breite");
    const id = await hub.createSession({ adapter: "opencode", prompt: "Handy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title")).toHaveText("Handy");
    await expect(app.getByRole("navigation", { name: "Sessions" })).toHaveCount(0);
  });

  test("Querformat (1280 px, Touch): Split-Arbeitsplatz, Karte per Tap öffnen @tablet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await app.setViewportSize({ width: 1280, height: 800 });
    await app.goto(hub.origin);
    await expect(app.locator(".split")).toBeVisible();
    await expect(app.locator(".tile-empty")).toContainText("Session links wählen");
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");
    // P21-Invariante gilt auch auf dem Tablet: das Fenster selbst scrollt nie.
    const overflow = await app.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Die 700-px-Grenze schaltet live: 699 Handy, 700 Grid @tablet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Grenze" });
    await app.setViewportSize({ width: 699, height: 800 });
    await expect(app.locator(".split")).toHaveCount(0);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await app.setViewportSize({ width: 700, height: 800 });
    await expect(app.locator(".split")).toBeVisible();
  });
});

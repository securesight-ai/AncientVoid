import { test, expect, enableAutoTiling } from "../support/fixtures.ts";

const gridTags = "@desktop @tablet";
test(`Inhalte bleiben als eigene Karten erhalten, auch nach Reload ${gridTags}`, async ({ app, hub }, info) => {
  test.skip(info.project.name === "mobile", "PC-/Tablet-Grid");
  await hub.createSession({ adapter: "opencode", prompt: "Karte bleibt" });
  await app.locator(".split-list .session-card").filter({ hasText: "Karte bleibt" }).locator(".session-open").click();
  await enableAutoTiling(app);
  const first = app.locator('.tile[data-tile="1"]');
  await expect(first.locator(".session-top-title")).toHaveText("Karte bleibt");
  await first.getByPlaceholder("Antworten…").fill("Entwurf bleibt erhalten");
  const sidebar = app.getByRole("navigation", { name: "Sidebar", exact: true });
  for (const [i, label] of ["Einstellungen", "Medien", "Statistik", "Terminal"].entries()) {
    await sidebar.getByRole("button", { name: label, exact: true }).click();
    await expect(app.locator(".tile")).toHaveCount(i + 2);
    await expect(first.locator(".session-top-title")).toHaveText("Karte bleibt");
    if (await first.getByRole("button", { name: "Steuerung einblenden" }).isVisible()) await first.getByRole("button", { name: "Steuerung einblenden" }).click();
    await expect(first.getByPlaceholder("Antworten…")).toHaveValue("Entwurf bleibt erhalten");
  }
  await app.reload();
  await expect(app.locator(".tile")).toHaveCount(5);
  await expect(first.locator(".session-top-title")).toHaveText("Karte bleibt");
  await expect(app.locator(".tile .tool-pane")).toHaveCount(4);
  await app.getByRole("button", { name: "Liste einklappen", exact: false }).click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: "Sidebar minimieren", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "Sidebar ausklappen", exact: true })).toBeVisible();
});

test(`Session, Graph und Datei öffnen eigene Karten ${gridTags}`, async ({ app, hub }, info) => {
  test.skip(info.project.name === "mobile", "PC-/Tablet-Grid");
  const id = await hub.createSession({ adapter: "opencode", prompt: "Ansichten bleiben" });
  await app.locator(".split-list .session-card").filter({ hasText: "Ansichten bleiben" }).locator(".session-open").click();
  await enableAutoTiling(app);
  const first = app.locator('.tile[data-tile="1"]');
  const originalTab = await first.locator(".session-live").getAttribute("data-tab");
  await first.locator(".subtabs-more-wrap > button").click();
  await first.getByRole("menuitem", { name: "Graph", exact: true }).click();
  await expect(app.locator(".tile")).toHaveCount(2);
  await expect(first.locator(".session-live")).toHaveAttribute("data-tab", originalTab!);
  await app.evaluate((sessionId) => { location.hash = `#/sessions/${sessionId}/datei/README.md`; }, id);
  await expect(app.locator(".tile")).toHaveCount(3);
  await expect(app.locator('.tile[data-tile="2"] .session-live')).toHaveAttribute("data-tab", "graph");
  await expect(app.locator('.tile[data-tile="3"] .session-live')).toHaveAttribute("data-tab", "datei");
  await app.reload();
  await expect(first.locator(".session-live")).toHaveAttribute("data-tab", originalTab!);
  await expect(app.locator('.tile[data-tile="2"] .session-live')).toHaveAttribute("data-tab", "graph");
  await expect(app.locator('.tile[data-tile="3"] .session-live')).toHaveAttribute("data-tab", "datei");
});

test(`Projektansicht bleibt außerhalb, Sidebar-Einstellungen bleiben gespeichert ${gridTags}`, async ({ app }, info) => {
  test.skip(info.project.name === "mobile", "PC-/Tablet-Sidebar");
  const sidebar = app.getByRole("navigation", { name: "Sidebar", exact: true });
  await expect(sidebar.locator("[data-sidebar-id]").evaluateAll((buttons) => buttons.slice(0, 4).map((b) => b.getAttribute("data-sidebar-id")))).resolves.toEqual(["dashboard", "search", "projects", "new"]);
  await sidebar.getByRole("button", { name: "Projektansicht", exact: true }).click();
  await expect(app.getByTestId("files-sidebar")).toBeVisible();
  expect(await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(app.locator(".tile")).toHaveCount(1);
  await app.getByLabel("Dateiquelle").selectOption({ label: "Projekt: alpha" });
  await app.getByTestId("files-sidebar").locator('[data-path="README.md"]').click();
  await expect(app.locator(".tile .file-card")).toHaveCount(1);
  await expect(app.locator(".tile .file-card")).toContainText("Das Handbuch beschreibt den Handoff");
  await expect(app.getByTestId("files-sidebar")).toBeVisible();
  await app.getByRole("button", { name: "Dateien schließen", exact: true }).click();
  await sidebar.getByRole("button", { name: "Einstellungen", exact: true }).click();
  const options = app.getByTestId("sidebar-settings");
  await options.getByRole("button", { name: "Projektansicht nach oben", exact: true }).click();
  await options.getByRole("switch", { name: "Medien anzeigen", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "Medien", exact: true })).toHaveCount(0);
  await app.reload();
  await expect(sidebar.locator("[data-sidebar-id]").evaluateAll((buttons) => buttons.slice(0, 4).map((b) => b.getAttribute("data-sidebar-id")))).resolves.toEqual(["dashboard", "projects", "search", "new"]);
  await expect(sidebar.getByRole("button", { name: "Medien", exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Sidebar minimieren", exact: true }).click();
  await app.reload();
  await expect(sidebar.getByRole("button", { name: "Sidebar ausklappen", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Sidebar konfigurieren", exact: true })).toBeVisible();
  const switches = app.getByTestId("sidebar-settings").getByRole("switch");
  for (const control of await switches.all()) if (await control.isChecked()) await control.click();
  await app.reload();
  await expect(sidebar.locator("[data-sidebar-id]")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Sidebar konfigurieren", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Sidebar ausklappen", exact: true })).toBeVisible();
});

test("Smartphone behält den Seitenwechsel", async ({ app }, info) => {
  test.skip(info.project.name !== "mobile", "Smartphone-Regression");
  await app.getByRole("button", { name: "Mehr", exact: true }).click();
  await app.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await expect(app.locator(".settings-page")).toBeVisible();
  await expect(app.locator(".tile-workspace")).toHaveCount(0);
  await expect(app.getByRole("navigation", { name: "Sidebar", exact: true })).toHaveCount(0);
});

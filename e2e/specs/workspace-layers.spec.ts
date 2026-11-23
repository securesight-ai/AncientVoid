import { test, expect, enableAutoTiling } from "../support/fixtures.ts";

test("Browser und Geräte öffnen Karten mit festem Sessionbezug @desktop @tablet", async ({ app, hub }, info) => {
  test.skip(info.project.name === "mobile", "PC-/Tablet-Grid");
  const id = await hub.createSession({ adapter: "opencode", prompt: "Gebundene Werkzeuge" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await enableAutoTiling(app);
  const first = app.locator('.tile[data-tile="1"]');
  await expect(first.locator(".session-top-title")).toHaveText("Gebundene Werkzeuge");
  for (const [i, name] of ["Browser", "Geräte"].entries()) {
    await first.locator(".subtabs-more-wrap > button").click();
    await first.getByRole("menuitem", { name, exact: true }).click();
    await expect(app.locator(".tile")).toHaveCount(i + 2);
  }
  await expect(app.locator(".tile").getByTestId("browser-panel")).toHaveCount(1);
  await expect(app.locator(".tile").getByTestId("device-panel")).toHaveCount(1);
  await hub.createSession({ adapter: "opencode", prompt: "Andere Session" });
  await app.locator(".split-list .session-card").filter({ hasText: "Andere Session" }).locator(".session-open").click();
  await expect(app.locator(".tile")).toHaveCount(4);
  await expect(app.getByTestId("browser-context")).toContainText(id.slice(0, 8));
  await app.reload();
  await expect(app.locator(".tile")).toHaveCount(4);
  await expect(app.getByTestId("browser-context")).toContainText(id.slice(0, 8));
});

test("Suchen bleibt als Karte erhalten, wenn ein Treffer geöffnet wird @desktop @tablet", async ({ app, hub }, info) => {
  test.skip(info.project.name === "mobile", "PC-/Tablet-Grid");
  const id = await hub.createSession({ adapter: "opencode", prompt: "Suche verdrängt nichts" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await enableAutoTiling(app);
  await expect(app.locator('.tile[data-tile="1"] .session-top-title')).toHaveText("Suche verdrängt nichts");
  await app.getByRole("navigation", { name: "Sidebar", exact: true }).getByRole("button", { name: "Suchen", exact: true }).click();
  const search = app.locator(".tile .command-card");
  await expect(search).toBeVisible();
  await search.getByRole("combobox", { name: "Auftrag", exact: true }).fill("Einstellungen");
  await search.getByRole("option", { name: "Werkzeug Einstellungen öffnen", exact: true }).click();
  await expect(app.locator(".tile")).toHaveCount(3);
  await expect(search.getByRole("combobox", { name: "Auftrag", exact: true })).toHaveValue("Einstellungen");
  await expect(app.locator(".tile .settings-page")).toBeVisible();
  await expect(app.locator('.tile[data-tile="1"] .session-top-title')).toHaveText("Suche verdrängt nichts");
});

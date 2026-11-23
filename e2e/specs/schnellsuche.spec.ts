import { test, expect, openQuiet, seeAll, enableAutoTiling } from "../support/fixtures.ts";

/**
 * EPIC-P43 T43.6: die Schnellsuche im bestehenden Befehlsfeld (Strg+K bzw. Dock „Suchen“) springt zu Sessions,
 * Projekten, Dateien, Werkzeugen und Befehlen; darunter bleibt „Auftrag in Worten“. Kein zweites Kürzel.
 */
test.describe("Schnellsuche (EPIC-P43 T43.6)", () => {
  test("springt zu einer Session, einem Werkzeug und in „Neue Session“ mit Projekt @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Login reparieren" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
    await seeAll(app, hub);
    await openQuiet(app);
    const grid = await app.locator(".tile-workspace").count() > 0;
    if (grid) await enableAutoTiling(app);
    await app.getByLabel("Auftrag in Worten (Strg+K)").click();
    const field = app.getByLabel("Auftrag", { exact: true });
    await field.fill("login");
    const jumps = app.getByRole("listbox", { name: "Springen zu" });
    await expect(jumps.getByRole("option").first()).toContainText("Login reparieren");
    await jumps.getByRole("option").first().click();
    await expect(app.locator(".command-sheet")).toHaveCount(grid ? 1 : 0);
    await expect(app.locator(".session-top-title").first()).toHaveText("Login reparieren");

    // Werkzeug per Tastatur: Pfeil wählt, Enter springt. In der Session steht „in den Dateien suchen“ davor.
    await app.keyboard.press("Control+k");
    await field.fill("einstell");
    await expect(jumps.getByRole("option").nth(0)).toContainText("in den Dateien suchen");
    await field.press("ArrowDown");
    await field.press("ArrowDown");
    await expect(jumps.getByRole("option", { selected: true })).toContainText("Einstellungen");
    await field.press("Enter");
    await expect(app.locator(".command-sheet")).toHaveCount(grid ? 1 : 0);
    expect(app.url()).toContain("#/einstellungen");

    // Projekt: „Neue Session“ mit dem Projekt vorgewählt.
    await app.keyboard.press("Control+k");
    await field.fill("beta");
    await jumps.getByRole("option").filter({ hasText: "Projekt" }).first().click();
    await expect(app.getByLabel("Adapter")).toBeVisible();
    await expect(app.getByRole("combobox", { name: "Projekt", exact: true })).toHaveValue(hub.beta);
  });

  test("ohne gewählten Treffer bleibt Enter ein Auftrag; Befehle tragen sich ein", async ({ app }) => {
    await app.getByRole("button", { name: "Suchen" }).first().click();
    const field = app.getByLabel("Auftrag", { exact: true });
    await field.fill("antworte");
    await app.getByRole("option").filter({ hasText: "Antworte dort" }).click();
    await expect(field).toHaveValue("Antworte dort: ");
    await field.fill("Zeig wartende Sessions");
    await field.press("Enter");
    await expect(app.locator(".command-sheet")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "nur wartende ✕" })).toBeVisible();
  });

  test("in einer Session sucht „Dateien“ in ihrem Code", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Code ansehen" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title").first()).toBeVisible();
    await app.keyboard.press("Control+k");
    await app.getByLabel("Auftrag", { exact: true }).fill("README");
    await app.getByRole("option").filter({ hasText: "in den Dateien suchen" }).click();
    await expect(app.locator(".session-live[data-tab=code]")).toBeVisible();
  });
});

import { test, expect, dockGo, sessionTab } from "../support/fixtures.ts";

/** Navigations-Historie (shared/nav-history.ts): Eine überlagernde Ansicht —
 * z. B. die Notizen-Seite, die im fixierten Raster die Session-Kachel ersetzt —
 * muss beim Schließen exakt die zuvor sichtbare Ansicht wiederherstellen:
 * gleiche Kachel, gleicher Reiter, gleicher Hash. */
test.describe("Navigations-Historie für überlagernde Ansichten", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Notizen über der Session-Kachel: Schließen stellt Session, Reiter und Hash exakt wieder her", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Navigation Historie" });
    await app.locator(".split-list .session-card").filter({ hasText: "Navigation Historie" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toContainText("Navigation Historie");
    // Tiefenansicht als Ansicht davor: der Git-Reiter trägt einen eigenen Hash.
    await sessionTab(app.locator(".tile").first(), "Git");
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}/git$`));

    // Notizen öffnen — im fixierten 1er-Raster überlagert die Seite die Session-Kachel.
    await dockGo(app, "Notizen");
    await expect(app.getByRole("region", { name: "Notizen" })).toBeVisible();
    await expect(app.locator(".tile").locator(".session-top-title")).toHaveCount(0);
    await expect(app).toHaveURL(/#\/notizen$/);

    // Schließen: exakt die Ansicht von davor — Session-Kachel, Git-Reiter, Hash.
    await app.locator(".tool-pane-close").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}/git$`));
    await expect(app.locator(".split-detail .session-top-title")).toContainText("Navigation Historie");
    await expect(app.locator(".tile").locator(".subtabs-wrap").getByRole("button", { name: /^Git/ })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Navigations-Historie am Handy", () => {
  // BUG-0282: Der Knopf ist kein Historie-Rücksprung mehr, sondern führt
  // deterministisch in die Übersicht — popView pendelte zwischen Sessions,
  // statt heimzukehren. Der Ping-Pong-Fall liegt in session.spec.ts.
  test("Zurück-Knopf der Session führt immer in die Übersicht", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Zurueck Historie" });
    await app.locator(".session-card").filter({ hasText: "Zurueck Historie" }).locator(".session-open").click();
    await expect(app.locator(".session-top-title")).toContainText("Zurueck Historie");
    await app.locator(".back-btn").click();
    await expect(app).toHaveURL(/#\/$/);
    await expect(app.locator(".session-card").filter({ hasText: "Zurueck Historie" })).toBeVisible();
  });
});

import { test, expect } from "../support/fixtures.ts";

/**
 * Übergabe aus der Karte (ADR-0039, Nutzerwunsch 2026-11-28): dasselbe
 * zentrierte Modal wie „Neue Session“ (BUG-0291) mit Titel + ✕ und dem
 * Hub-Entwurf schon im Textfeld. Vorher war die Übergabe ein Blatt im
 * Karten-DOM: Die Tiefenebene (T86.3) gibt .app-page einen Transform,
 * damit saß das Blatt in .app-pages Stapelzusammenhang UNTER dem Dock —
 * Klicks auf „Abbrechen“/„Übergeben“ trafen den Dock, die Hinterlegung
 * deckte nur die App-Spalte. Das Modal hängt deshalb als Body-Portal
 * (Muster Anhang-Ansicht) über allem.
 */
test.describe("Übergabe-Modal aus der Karte", () => {
  // Endlos laufende Quelle: das Modal muss auch bei einlaufenden Events
  // klickbar und ruhig bleiben (Nutzerfund: „flackert alles“).
  test.use({ hubOptions: { dummyEventsPerSecond: 10, dummyAutoStop: 0 } });

  test("sieht aus wie „Neue Session“, Entwurf steht im Textfeld, Knöpfe sind klickbar", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Kartenübergabe Wanderstab" });
    const card = app.locator(".session-card").filter({ hasText: "Kartenübergabe" }).first();
    await expect(card).toBeVisible();
    await card.locator(".row-menu-btn").click();
    await card.getByRole("menuitem", { name: "Übergeben…" }).click();

    const modal = app.getByRole("dialog", { name: "Session übergeben" });
    await expect(modal).toBeVisible();
    // Dasselbe Aussehen wie das Neue-Session-Modal: zentriert, Kopf mit Titel und ✕.
    await expect(modal).toHaveClass(/ui-sheet--modal/);
    await expect(modal.locator(".new-session-modal-head h3")).toHaveText("Session übergeben");
    await expect(modal.getByRole("button", { name: "Schließen" })).toBeVisible();
    // Der Übergabetext steht schon im Textfeld — gesichtet und editierbar, nichts tippen.
    await expect(modal.getByLabel("Übergabetext")).toHaveValue(/Kartenübergabe Wanderstab/);
    // Die Hinterlegung deckt das ganze Fenster (vorher: nur die App-Spalte).
    const covered = await app.locator(".ui-sheet-backdrop").evaluate((b) => {
      const r = b.getBoundingClientRect();
      return r.left === 0 && r.top === 0 && Math.abs(r.width - window.innerWidth) < 1 && Math.abs(r.height - window.innerHeight) < 1;
    });
    expect(covered, "Hinterlegung deckt das ganze Fenster").toBe(true);

    // Ein echter Klick während laufender Events — vorher: Timeout, weil der
    // Dock („Mehr“) die Knopfleiste überdeckte. Klickbarkeit ist die Regression.
    await modal.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(modal).toBeHidden();
  });

  test("Esc und ✕ schließen das Modal, die Karte bleibt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "EscProbe Übergabe" });
    const card = app.locator(".session-card").filter({ hasText: "EscProbe" }).first();
    await expect(card).toBeVisible();
    await card.locator(".row-menu-btn").click();
    await card.getByRole("menuitem", { name: "Übergeben…" }).click();
    const modal = app.getByRole("dialog", { name: "Session übergeben" });
    await expect(modal).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    await card.locator(".row-menu-btn").click();
    await card.getByRole("menuitem", { name: "Übergeben…" }).click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Schließen" }).click();
    await expect(modal).toBeHidden();
    await expect(card).toBeVisible();
  });

  test("Übergeben wählt das Ziel, parkt die Quelle und öffnet die neue Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Wanderstab final" });
    const card = app.locator(".session-card").filter({ hasText: "Wanderstab final" }).first();
    await expect(card).toBeVisible();
    await card.locator(".row-menu-btn").click();
    await card.getByRole("menuitem", { name: "Übergeben…" }).click();

    const modal = app.getByRole("dialog", { name: "Session übergeben" });
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Übergabetext")).toHaveValue(/Wanderstab final/);
    await modal.getByLabel("Ziel-Provider").selectOption("opencode");
    await modal.getByRole("button", { name: "Übergeben", exact: true }).click();

    // Der Hub verzeichnet die Übergabe an der Quelle (und parkt sie).
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.handover_out"), "Übergabe verzeichnet");
    // Das Modal ist zu, die neue Session ist offen.
    await expect(modal).toBeHidden();
    await expect(app.locator(".session-live").first()).toBeVisible();
  });
});

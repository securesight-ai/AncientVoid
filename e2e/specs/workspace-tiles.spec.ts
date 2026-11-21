import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P18: up to four sessions as tiles on a wide screen. */
test.describe("Desktop-Workspace (EPIC-P18)", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  const card = (app: Page, text: string) => app.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");
  const tile = (app: Page, n: number) => app.locator(`.tile[data-tile="${n}"]`);

  test("Strg-Klick öffnet weitere Kacheln bis 2×2, jede Kachel zeigt ihre Session mit Token-Zeile (AC-P18-2)", async ({ app, hub }) => {
    for (const name of ["Eins", "Zwei", "Drei", "Vier"]) await hub.createSession({ adapter: "opencode", prompt: `Aufgabe ${name}` });
    await card(app, "Aufgabe Eins").click();
    // Default ist fixiert — zum Wachsen erst lösen.
    await app.getByRole("button", { name: "Layout lösen" }).click();
    await card(app, "Aufgabe Zwei").click({ modifiers: ["Control"] });
    await expect(app.getByRole("button", { name: "Zwei nebeneinander" })).toHaveAttribute("aria-pressed", "true");
    await card(app, "Aufgabe Drei").click({ modifiers: ["Control"] });
    await card(app, "Aufgabe Vier").click({ modifiers: ["Control"] });
    await expect(app.getByRole("button", { name: "Vier als Raster" })).toHaveAttribute("aria-pressed", "true");
    for (const [n, name] of ["Eins", "Zwei", "Drei", "Vier"].entries()) {
      await expect(tile(app, n + 1).locator(".session-top-title")).toHaveText(`Aufgabe ${name}`);
      // EPIC-P43 T43.4: die Statuszeile zeigt nur Gemessenes; die Attrappe meldet Tokens, kein Kontextfenster.
      await expect(tile(app, n + 1).locator(".run-tokens")).toContainText("Tokens");
    }
    await expect(tile(app, 4)).toHaveClass(/focused/);
    // Half-height tiles: every tile folds its controls, not only new ones.
    for (const n of [1, 2, 3, 4]) await expect(tile(app, n).getByRole("button", { name: "Steuerung einblenden" })).toBeVisible();
  });

  test("Layout „Drei nebeneinander“ zeigt drei Kacheln mit zwei ziehbaren Spaltengrenzen", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Drittel" });
    await card(app, "Aufgabe Drittel").click();
    await app.getByRole("button", { name: "Drei nebeneinander" }).click();
    await expect(app.getByRole("button", { name: "Drei nebeneinander" })).toHaveAttribute("aria-pressed", "true");
    await expect(app.locator(".tile")).toHaveCount(3);
    await expect(app.locator(".tile-grid .tile-divider.col")).toHaveCount(2);
    await app.reload();
    await expect(app.getByRole("button", { name: "Drei nebeneinander" })).toHaveAttribute("aria-pressed", "true");
  });

  test("eine Antwort in Kachel 3 geht nur an die Session in Kachel 3 (P18-Premortem 1)", async ({ app, hub }) => {
    const ids: string[] = [];
    for (const name of ["Eins", "Zwei", "Drei"]) ids.push(await hub.createSession({ adapter: "opencode", prompt: `Aufgabe ${name}` }));
    await card(app, "Aufgabe Eins").click();
    await app.getByRole("button", { name: "Layout lösen" }).click();
    await card(app, "Aufgabe Zwei").click({ modifiers: ["Control"] });
    await card(app, "Aufgabe Drei").click({ modifiers: ["Control"] });
    const third = tile(app, 3);
    // A half-height tile starts with its controls folded (P18 premortem 3).
    await third.getByRole("button", { name: "Steuerung einblenden" }).click();
    await third.getByPlaceholder("Antworten…").fill("Nur für Drei");
    await third.getByRole("button", { name: "Senden" }).click();
    await hub.until(async () => (await hub.events(ids[2]!)).some((e) => e.summary.includes("Nur für Drei")), "reply in session three");
    for (const id of ids.slice(0, 2)) expect((await hub.events(id)).some((e) => e.summary.includes("Nur für Drei"))).toBe(false);
  });

  test("Tastatur: Layout wechseln, Fokus, Tauschen, Schließen (AC-P18-3)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Links" });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Rechts" });
    await card(app, "Aufgabe Links").click();
    await app.getByRole("button", { name: "Zwei nebeneinander" }).click();
    await card(app, "Aufgabe Rechts").click({ modifiers: ["Control"] });
    await expect(tile(app, 2)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+1");
    await expect(tile(app, 1)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+Shift+2");
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Rechts");
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Links");
    await expect(tile(app, 2)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+L");
    await expect(app.getByRole("button", { name: "Drei nebeneinander" })).toHaveAttribute("aria-pressed", "true");
    await app.keyboard.press("Alt+W");
    // Default fixiert: Slot leer, Raster bleibt.
    await expect(app.locator(".tile")).toHaveCount(3);
    await expect(tile(app, 2).locator(".tile-empty")).toBeVisible();
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Rechts");
  });

  test("Layout ist default fixiert: Öffnen bleibt im Raster; schon offene Session springt hin", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Alpha" });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Beta" });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Gamma" });
    await card(app, "Aufgabe Alpha").click();
    await expect(app.getByRole("button", { name: "Layout lösen" })).toHaveAttribute("aria-pressed", "true");
    await app.getByRole("button", { name: "Zwei nebeneinander" }).click();
    await card(app, "Aufgabe Beta").click({ modifiers: ["Control"] });
    await expect(app.locator(".tile")).toHaveCount(2);
    await card(app, "Aufgabe Gamma").click({ modifiers: ["Control"] });
    await expect(app.locator(".tile")).toHaveCount(2);
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Gamma");
    await card(app, "Aufgabe Alpha").click();
    await expect(tile(app, 1)).toHaveClass(/focused/);
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Alpha");
    await expect(app.locator(".tile")).toHaveCount(2);
  });

  test("zwei Kürzel im selben Tick arbeiten auf dem Ergebnis des ersten (BUG-0071)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Links" });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Rechts" });
    await card(app, "Aufgabe Links").click();
    await app.getByRole("button", { name: "Zwei nebeneinander" }).click();
    await card(app, "Aufgabe Rechts").click({ modifiers: ["Control"] });
    await expect(tile(app, 2)).toHaveClass(/focused/);
    // Both keydowns before Preact renders in between — what a fast typist or a loaded machine produces.
    await app.evaluate(() => {
      const key = (code: string, shiftKey: boolean) => window.dispatchEvent(new KeyboardEvent("keydown", { code, altKey: true, shiftKey, bubbles: true, cancelable: true }));
      key("Digit1", false);
      key("Digit2", true);
    });
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Rechts");
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Links");
  });

  test("nach Reload sind Layout und Belegung gleich; eine gelöschte Session sagt es (AC-P18-3, Premortem 4)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Bleibt" });
    const gone = await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Geht" });
    await card(app, "Aufgabe Bleibt").click();
    await app.getByRole("button", { name: "Zwei übereinander" }).click();
    await card(app, "Aufgabe Geht").click({ modifiers: ["Control"] });
    await app.reload();
    await expect(app.getByRole("button", { name: "Zwei übereinander" })).toHaveAttribute("aria-pressed", "true");
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Bleibt");
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Geht");
    await hub.api(`/api/sessions/${gone}/stop`, { body: {} });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${gone}`)).body.status === "stopped", "stopped");
    expect((await hub.api(`/api/sessions/${gone}`, { method: "DELETE", body: {} })).status).toBeLessThan(300);
    await app.reload();
    await expect(tile(app, 2).locator("[data-testid=tile-missing]")).toContainText("gibt es nicht mehr");
    await tile(app, 2).getByRole("button", { name: "Kachel schließen" }).last().click();
    // Fixiert: leerer Slot bleibt, Raster 2h bleibt.
    await expect(app.locator(".tile")).toHaveCount(2);
    await expect(tile(app, 2).locator(".tile-empty")).toContainText("frei");
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Bleibt");
  });

  test("2560 px: volle Breite, mit eingeklappter Liste ≥ 90 % für die Kacheln (AC-P18-1)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Breit" });
    await card(app, "Aufgabe Breit").click();
    const split = await app.locator(".split").boundingBox();
    expect(split!.width).toBeGreaterThan(2560 * 0.95);
    await app.getByRole("button", { name: "Liste einklappen" }).click();
    await expect(app.locator(".split-list .dashboard")).toBeHidden();
    await expect(app.getByRole("navigation", { name: "Sidebar", exact: true })).toBeVisible();
    const grid = await app.locator(".tile-grid").boundingBox();
    expect(grid!.width).toBeGreaterThanOrEqual(2560 * 0.9);
    // One tile: the chat keeps a readable line length instead of 2,500 px lines.
    const row = await tile(app, 1).locator(".topbar").boundingBox();
    expect(row!.width).toBeLessThanOrEqual(1300);
    await app.reload();
    await expect(app.locator(".split-list .dashboard")).toBeHidden();
    await expect(app.getByRole("navigation", { name: "Sidebar", exact: true })).toBeVisible();
    await app.getByRole("button", { name: "Liste ausklappen" }).click();
    await expect(app.locator(".split-list")).toBeVisible();
  });

  test("unter 700 px gibt es keine Kacheln (Smartphone)", async ({ app, hub }) => {
    await app.setViewportSize({ width: 699, height: 900 });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Schmal" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title")).toHaveText("Schmal");
    await expect(app.locator(".tile-workspace")).toHaveCount(0);
  });

  test("Archivieren aus der Kachel heraus leert die Kachel; die Karte verschwindet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Adé" });
    await card(app, "Aufgabe Adé").click();
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Adé");
    await tile(app, 1).getByLabel("Weitere Aktionen").click();
    await tile(app, 1).locator(".session-menu").getByRole("button", { name: "Archivieren" }).click();
    await expect(tile(app, 1).locator(".tile-empty")).toContainText("Kachel 1 ist frei");
    await expect(app.locator(".split-list .session-card").filter({ hasText: "Aufgabe Adé" })).toHaveCount(0);
  });

  test("Von einem anderen Gerät archiviert (Handy): die Kachel räumt sich selbst ab", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Fernarchiv" });
    await card(app, "Aufgabe Fernarchiv").click();
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Fernarchiv");
    // Archivierung passiert außerhalb dieses Fensters — der 3-s-Poll der
    // Ansicht meldet den Übergang und die Kachel gibt die Session frei.
    await hub.api(`/api/sessions/${id}/archive`, { body: { archived: true } });
    await expect(tile(app, 1).locator(".tile-empty")).toContainText("Kachel 1 ist frei");
  });
});

test.describe("Desktop-Workspace: Kacheln ohne Fokus (EPIC-P18 T18.6)", () => {
  test.use({ viewport: { width: 2560, height: 1440 }, hubOptions: { dummyAutoStop: 220 } });

  test("eine Kachel ohne Fokus zeigt nur die neuesten Zeilen und sagt es; Fokus holt alle zurück", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).length >= 200, "200 events");
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Nachbar" });
    const cardOf = (text: string) => app.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");
    await app.evaluate(() => localStorage.setItem("ancientvoid.filter", "debuggen"));
    await app.reload();
    await app.locator(".split-list .session-card").first().waitFor();
    await app.locator(".split-list .session-card").filter({ hasNotText: "Aufgabe Nachbar" }).locator(".session-open").click();
    await app.getByRole("button", { name: "Zwei nebeneinander" }).click();
    await cardOf("Aufgabe Nachbar").click({ modifiers: ["Control"] });
    const first = app.locator('.tile[data-tile="1"]');
    await expect(first.locator("[data-testid=older-hidden]")).toContainText("ältere Einträge");
    await expect(first.locator(".event")).toHaveCount(150);
    await first.locator(".session-top-title").click();
    await expect(first.locator("[data-testid=older-hidden]")).toHaveCount(0);
    expect(await first.locator(".event").count()).toBeGreaterThan(150);
  });
});

import { test, expect, dockGo } from "../support/fixtures.ts";

test.describe("Navigation, Status und Einstellungen (P1.6)", () => {
  test("das Dock erreicht jede Seite und kommt zurück @desktop", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByRole("button", { name: "Starten" })).toBeVisible();
    await dockGo(app, "Einstellungen");
    await expect(app.getByText("Erscheinungsbild")).toBeVisible();
    await app.locator(".dock").getByRole("button", { name: "Start", exact: true }).click();
    await expect(app.getByRole("heading", { name: "Noch keine Sessions" })).toBeVisible();
  });

  test("die Status-Seite zeigt jeden Provider mit seinen Fähigkeiten", async ({ app }) => {
    await app.getByRole("button", { name: "Status" }).click();
    const opencode = app.locator(".provider-card").filter({ hasText: "opencode" });
    const dummy = app.locator(".provider-card").filter({ hasText: "dummy" });
    await expect(opencode).toContainText("v0.1.0");
    await expect(opencode.getByText("Kosten")).toBeVisible();
    // ADR-0018: functions one by one, and how tools are released.
    await expect(opencode.getByText("Folgeprompt")).toBeVisible();
    await expect(opencode.getByText("Modellwahl")).toBeVisible();
    await expect(opencode.locator(".tool-gate")).toHaveText("feste Tool-Liste, ohne Nachfrage");
    await expect(dummy.locator(".tool-gate")).toHaveText("keine Tools");
    await expect(dummy.getByText("Kosten")).toHaveCount(0);
    await expect(dummy).toContainText("Kein Kontingent-Signal");
  });

  test("das helle Design bleibt nach einem Reload", async ({ app }) => {
    await dockGo(app, "Einstellungen");
    await app.locator(".segmented").getByRole("button", { name: "Hell" }).click();
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
    await app.reload();
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("die Einstellungen nennen die gefundenen Projekte und den Passkey-Stand", async ({ app }) => {
    await dockGo(app, "Einstellungen");
    await expect(app.getByText("2 Projekte gefunden")).toBeVisible();
    await expect(app.getByText("•••• aktiv")).toBeVisible();
    await expect(app.getByRole("button", { name: "Passkey registrieren" })).toBeVisible();
  });

  // EPIC-P34 T34.1 (AC-P34-1): Voice außerhalb einer Session entfällt, Medien rückt ins Dock, PC in die Einstellungen.
  // Das Voice-Sheet in der Session deckt weiter workspace.spec.ts ab („Sprache“).
  test("AC-P34-1: das Dock führt Medien statt Voice, die Kopfzeile nur Befehl und Status @desktop", async ({ app, isMobile }) => {
    const tools = ["Medien", "Notizen", "Automationen", "Einstellungen", "Statistik", "Terminal", "Release-Notes"];
    const labels = isMobile
      ? ["Start", "Suchen", "Teams", "Mehr", ...tools, "Dateibaum"]
      : ["Start", "Suchen", "Projektansicht", "Session", "Teams", ...tools];
    await expect(app.locator(".dock .lb")).toHaveText(labels);
    await expect(app.locator(".dock").getByRole("button", { name: "Voice" })).toHaveCount(0);
    const head = app.locator(".topbar").first();
    await expect(head.getByRole("button", { name: "Medien" })).toHaveCount(0);
    await expect(head.getByRole("button", { name: "PC", exact: true })).toHaveCount(0);
    await expect(head.getByRole("button", { name: "Status" })).toBeVisible();
    await dockGo(app, "Medien");
    await expect(app).toHaveURL(/#\/medien$/);
    await expect(app.locator(".media-caps")).toBeVisible();
  });

  test("AC-P34-1: die Direktlinks #/pc und #/medien funktionieren weiter", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/pc`);
    await expect(app.locator("[data-testid=desktop-setup], .desktop-head").first()).toBeVisible();
    await app.goto(`${hub.origin}/#/medien`);
    await expect(app.locator(".media-caps")).toBeVisible();
  });
});

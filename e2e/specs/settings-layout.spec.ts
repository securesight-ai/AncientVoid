import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P34 T34.3: Einstellungen als feste Gruppen in einem symmetrischen Raster.
 * „Töne“ kam mit EPIC-P65, „Main-Synchronisation“ mit EPIC-P67, „Wissensquellen“ mit EPIC-P74 — die Liste
 * ist die Ordnung, die das Handy zeigt (DOM-Reihenfolge). */
const GROUPS = ["Darstellung", "Sidebar", "Schrift", "Darstellungs- und Layout-Presets", "Vorschau", "Benachrichtigungen", "Töne", "Spracheingabe", "Sprachausgabe", "Geräte", "Flotte", "Verbindungen", "Wissensquellen", "Main-Synchronisation", "Dienste", "Modell-Inferenz (manuelle Anbindung)", "Sicherheit & Verbindung"];

async function openSettings(app: Page): Promise<void> {
  await dockGo(app, "Einstellungen");
  await expect(app.locator(".settings-section").first()).toBeVisible();
}

const overflow = (app: Page) => app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("Einstellungen: Gruppen und Raster (EPIC-P34)", () => {
  test.describe("Desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("AC-P34-3: vollständige Gruppen in zwei gleich breiten Spalten, ohne Seitwärts-Scrollen @desktop", async ({ app }) => {
      await openSettings(app);
      await expect(app.locator(".settings-section > header h3")).toHaveText(GROUPS);
      const cols = await app.locator(".settings-col").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { x: number; width: number }));
      expect(cols).toHaveLength(2);
      expect(cols[1]!.x, "zweite Spalte steht rechts").toBeGreaterThan(cols[0]!.x + cols[0]!.width - 1);
      expect(Math.abs(cols[0]!.width - cols[1]!.width), "gleich breit").toBeLessThanOrEqual(1);
      expect(await overflow(app)).toBeLessThanOrEqual(0);
    });

    test("AC-P34-3: die Bedienelemente jeder Gruppe fluchten am rechten Rand @desktop", async ({ app }) => {
      await openSettings(app);
      for (const section of await app.locator(".settings-section").all()) {
        const rights = await section.locator(".setting-row > .setting-control").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
        if (rights.length < 2) continue;
        expect(Math.max(...rights) - Math.min(...rights), await section.locator("h3").first().innerText()).toBeLessThanOrEqual(1);
      }
    });
  });

  test("AC-P34-3: am Handy eine Spalte, nichts läuft über den Rand", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    await app.reload();
    await openSettings(app);
    await expect(app.locator(".settings-section > header h3")).toHaveText(GROUPS);
    const xs = await app.locator(".settings-col").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xs).size, "alle Gruppen untereinander").toBe(1);
    expect(await overflow(app)).toBeLessThanOrEqual(0);
  });

  test("Theme ist eine Auswahl mit Zustand, Schalter sind echte Schalter @desktop", async ({ app }) => {
    await openSettings(app);
    const seg = app.locator(".segmented");
    await expect(seg.getByRole("button", { name: "Dunkel" })).toHaveAttribute("aria-pressed", "true");
    await seg.getByRole("button", { name: "Hell" }).click();
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(seg.getByRole("button", { name: "Hell" })).toHaveAttribute("aria-pressed", "true");

    const shimmer = app.getByRole("switch", { name: "Bewegung", exact: true });
    await expect(shimmer).toBeChecked();
    await shimmer.click();
    await expect(shimmer).not.toBeChecked();
    await expect(app.locator("html")).toHaveAttribute("data-ctx-motion", "off");
    await expect(app.getByRole("switch", { name: "Pinch-Zoom" })).toBeChecked();
  });

  test("bestehende Funktionen bleiben erreichbar: Passkey, Token, Projekte, Flotte, Gemini, Push, PC-Eingabe @desktop", async ({ app }) => {
    await openSettings(app);
    await expect(app.getByRole("button", { name: "Passkey registrieren" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Geräte-Token wechseln" })).toBeVisible();
    await expect(app.getByText("2 Projekte gefunden")).toBeVisible();
    await expect(app.getByRole("button", { name: "Einladungscode erzeugen" })).toBeVisible();
    await expect(app.getByLabel("API-Schlüssel")).toBeVisible();
    await expect(app.getByLabel("Push auf diesem Hub erlauben")).toBeVisible();
    await expect(app.locator("summary", { hasText: "PC-Eingabe" })).toBeVisible();
  });
});

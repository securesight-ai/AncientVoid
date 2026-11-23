import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P64 T64.6: Der Glow der Glocke zeigt die höchste offene
 * Dringlichkeit — rot Fehler, blau Rückfrage, grün Lauf beendet
 * (Nutzerwunsch 2026-11-20: blau überall für Rückfragen, gelb nur für
 * Warnungen) — und verschwindet, wenn das Panel gelesen wurde. Reduzierte
 * Bewegung (System) ersetzt den Puls durch einen statischen Ring. */
test.describe("Glocken-Glow nach Dringlichkeit (EPIC-P64)", () => {
  async function bellClass(app: Page): Promise<string> {
    return (await app.locator(".notif-bell").getAttribute("class")) ?? "";
  }

  test("ungelesener Fehler glüht rot (urgency-error)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-error/, { timeout: 15_000 });
    const anim = await app.locator(".notif-bell").evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toContain("notif-glow-pulse");
  });

  test("fertiger Zug glüht grün (urgency-done), ohne Toast (T8.6 unverändert)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-done/, { timeout: 15_000 });
    await expect(app.locator(".toast")).toHaveCount(0);
  });

  test("offene Frage glüht blau (urgency-action, Nutzerwunsch 2026-11-20)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-action/, { timeout: 30_000 });
  });

  /** Nutzerwunsch 2026-11-20 — Farbvertrag der Benachrichtigungen: blau ist
   * überall die Farbe für Rückfragen/Entscheidungs-Pflicht (Glocken-Glow,
   * Rückfrage-Sektion, Rückfrage-Toast, Freigabe-Banner), gelb bleibt
   * Warnungen/Sonstiges vorbehalten. Prüft die Token-Zuordnung im gebauten
   * Stylesheet — ein Return zu --warn fiele hier rot auf. */
  test("Farbvertrag: Rückfragen blau (--info), gelb nur Warnungen", async ({ app }) => {
    const css = await app.evaluate(() => {
      let text = "";
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) text += `${rule.cssText}\n`;
        } catch {
          // fremde Origin (nicht relevant, PWA dient alles gleich-originale aus)
        }
      }
      return text;
    });
    expect(css).toMatch(/\.notif-bell\.urgency-action\s*{[^}]*--notif-urgency:\s*var\(--info\)/);
    expect(css).toMatch(/\.notif-section\.questions\s*{[^}]*--notif-section:\s*var\(--info\)/);
    expect(css).toMatch(/\.notif-section\.rest\s*{[^}]*--notif-section:\s*var\(--warn\)/);
    expect(css).toMatch(/\.toast\.question\s*{[^}]*border-left-color:\s*var\(--info\)/);
    expect(css).toMatch(/\.approval-banner\s*{[^}]*border:\s*1px solid var\(--info\)/);
  });

  test("Fehler schlägt Frage und Lauf (Priorität der Klassen)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-error/, { timeout: 30_000 });
    await expect(await bellClass(app)).not.toMatch(/urgency-(action|done)/);
  });

  test("Panel öffnen liest den Bestand — done-Glow erlischt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-done/, { timeout: 15_000 });
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(app.locator(".notif-panel")).toBeVisible();
    await app.locator(".notif-panel-head").getByRole("button", { name: "✕" }).click();
    await expect(app.locator(".notif-bell")).not.toHaveClass(/urgency-done/, { timeout: 10_000 });
  });

  test("reduzierte Bewegung: statischer Ring statt Puls", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await expect(app.locator(".notif-bell")).toHaveClass(/urgency-error/, { timeout: 15_000 });
    await app.emulateMedia({ reducedMotion: "reduce" });
    const bell0 = app.locator(".notif-bell");
    await expect
      .poll(async () => bell0.evaluate((el) => getComputedStyle(el).animationName), { timeout: 5_000 })
      .toBe("none");
    const shadow = await bell0.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow, "statischer Ring bleibt sichtbar").not.toBe("none");
  });
});

test.describe("Tablet-Split: Panel folgt der Glocke an den Fensterrand (EPIC-P64 T64.5) @tablet", () => {
  test("Glocke und Panel stehen rechts am Fenster, nicht mitten im Bild", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    // @tablet läuft zusätzlich im mobile-Projekt — Viewport wie tablet-layout.spec erzwingen.
    await app.setViewportSize({ width: 800, height: 1280 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".split")).toBeVisible();
    await expect(app.locator(".notif-bell")).toBeVisible();
    const vw = await app.evaluate(() => window.innerWidth);
    const bell = (await app.locator(".notif-bell").boundingBox())!;
    expect(vw - (bell.x + bell.width), "Glocke am Fensterrand").toBeLessThanOrEqual(14);
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = app.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(vw - (box.x + box.width), "Panel am Fensterrand — nicht mittig").toBeLessThanOrEqual(14);
    expect(box.x, "Panel links im Bild").toBeGreaterThanOrEqual(-0.5);
  });
});

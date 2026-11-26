import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P86 T86.1–T86.3: die Tiefenebene. Geprüft wird über die computed
 * animation-name (deterministisch, kein Timing-Fenster): Overlays tragen
 * mit 3D an eine Perspektiv-Animation, mit 3D aus keine. Die drei
 * Schalterflächen — „Mehr“-Blatt (Handy), Sidebar (PC), Einstellungen —
 * zeigen denselben Stand, und der überlebt den Reload.
 */
test.describe("3D-Tiefe", () => {
  test("T86.3: Blatt fliegt mit Perspektive auf; der Schalter im „Mehr“-Blatt stellt ab und überlebt Reload", async ({ app }) => {
    const attr = () => app.evaluate(() => document.documentElement.getAttribute("data-ctx-3d"));

    // T86.1: Standard an, vor dem ersten Paint gesetzt (main.tsx).
    await expect.poll(attr).toBe("on");

    await app.getByRole("button", { name: "Mehr", exact: true }).click();
    const sheet = app.getByRole("dialog", { name: "Mehr" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("animation-name", "depth3d-rise");

    // T86.2: Schalter im offenen Blatt — sofort wirksam, ohne Reload.
    await sheet.getByRole("button", { name: "3D-Tiefe" }).click();
    await expect.poll(attr).toBe("off");
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.depth3d"))).toBe("0");

    await sheet.getByRole("button", { name: "Einstellungen" }).click();
    await app.getByRole("button", { name: "Mehr", exact: true }).click();
    const again = app.getByRole("dialog", { name: "Mehr" });
    await expect(again).toBeVisible();
    await expect(again).toHaveCSS("animation-name", "none");
    await again.getByRole("button", { name: "Einstellungen" }).click();

    // T86.1: Ablage überlebt den Reload (Muster ctxMotion).
    await app.reload();
    await expect.poll(attr).toBe("off");

    // Zurück auf an — auch das überlebt den Reload.
    await app.getByRole("button", { name: "Mehr", exact: true }).click();
    await app.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name: "3D-Tiefe" }).click();
    await expect.poll(attr).toBe("on");
    await app.reload();
    await expect.poll(attr).toBe("on");
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.depth3d"))).toBeNull();
  });

  test("T86.2: Sidebar und Einstellungen zeigen denselben Stand und schalten gegenseitig @desktop", async ({ app }) => {
    const sidebar = app.getByRole("button", { name: "3D an/aus", exact: true });
    await app.setViewportSize({ width: 1280, height: 800 });
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-pressed", "true");

    await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-pressed", "false");

    // Einstellungen → Darstellung: derselbe Stand, zurück schaltet die Sidebar live.
    await app.getByRole("button", { name: "Einstellungen", exact: true }).click();
    const toggle = app.getByRole("switch", { name: "3D-Tiefe", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(sidebar).toHaveAttribute("aria-pressed", "true");
    expect(await app.evaluate(() => document.documentElement.getAttribute("data-ctx-3d"))).toBe("on");
  });
});

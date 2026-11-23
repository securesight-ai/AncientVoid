import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * Der globale Tooltip (shared/Tooltip.tsx): Hover/Fokus am Desktop,
 * Gedrückthalten auf Touch ohne Auslösung der Aktion. Ziele sind die echten
 * Composer-/Session-Buttons des aktuellen main (Text-„Senden”, Title-„Eingabe
 * groß machen” — `adoptTitle` macht aus title ein data-tip).
 */
async function openReply(app: Page, hub: { createSession: (o: { adapter: string; prompt: string }) => Promise<string>; origin: string }) {
  const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await app.getByRole("button", { name: "Chat" }).click();
  const field = app.getByPlaceholder("Antworten…");
  await expect(field).toBeVisible();
  return { id, field };
}

/** Echte Touch-Ereignisse über CDP (pointerType "touch"), mit Haltedauer in ms. */
async function touch(app: Page, target: ReturnType<Page["locator"]>, holdMs: number, moveBy = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await app.context().newCDPSession(app);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (moveBy) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + moveBy, y }] });
  await app.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("Tooltips", () => {
  test("Hover zeigt den Tooltip, Wegbewegen versteckt ihn @desktop", async ({ app, hub, isMobile }) => {
    test.skip(isMobile, "Hover gibt es nur mit Maus");
    const { field } = await openReply(app, hub);
    const senden = app.getByRole("button", { name: "Senden", exact: true });
    await field.fill("Hallo");
    await senden.hover();
    await expect(app.getByRole("tooltip")).toHaveText("Senden");
    await app.mouse.move(2, 2);
    await expect(app.getByRole("tooltip")).toHaveCount(0);
  });

  test("Tastaturfokus zeigt den Tooltip, Escape versteckt ihn @desktop", async ({ app, hub, isMobile }) => {
    test.skip(isMobile, "Hover gibt es nur mit Maus");
    const { field } = await openReply(app, hub);
    await field.fill("Hallo");
    const senden = app.getByRole("button", { name: "Senden", exact: true });
    await senden.focus();
    await app.keyboard.press("Shift+Tab");
    await app.keyboard.press("Tab");
    await expect(app.getByRole("tooltip")).toHaveText("Senden");
    await app.keyboard.press("Escape");
    await expect(app.getByRole("tooltip")).toHaveCount(0);
  });

  test("Gedrückthalten zeigt den Tooltip, ohne zu senden; ein kurzer Tap sendet", async ({ app, hub }) => {
    const { field } = await openReply(app, hub);
    await field.fill("Nur halten");
    const senden = app.getByRole("button", { name: "Senden", exact: true });

    await touch(app, senden, 800);
    await expect(app.getByRole("tooltip")).toHaveText("Senden");
    await app.waitForTimeout(700); // der nachgereichte Click darf nichts auslösen
    await expect(field).toHaveValue("Nur halten");
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nur halten/)).toHaveCount(0);

    await touch(app, senden, 60);
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nur halten/)).toBeVisible();
  });

  test("Wischen über dem Button zeigt keinen Tooltip", async ({ app, hub }) => {
    const { field } = await openReply(app, hub);
    await field.fill("Wischen");
    await touch(app, app.getByRole("button", { name: "Senden", exact: true }), 800, 40);
    await expect(app.getByRole("tooltip")).toHaveCount(0);
  });
});

test.describe("Tooltip-Geometrie am Tablet (BUG-0255)", () => {
  test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true });

  test("Icon-Leisten-Tooltip erscheint rechts neben dem Icon und bleibt im Viewport", async ({ app }) => {
    const item = app.locator('.sidebar .dock-item[data-sidebar-id="automationen"]');
    await expect(item).toBeVisible();
    const icon = (await item.boundingBox())!;
    await item.hover();
    const tip = app.getByRole("tooltip");
    await expect(tip).toHaveText("Automationen");
    const box = (await tip.boundingBox())!;
    expect(box.x, "beginnt rechts der Icon-Kante").toBeGreaterThan(icon.x + icon.width);
    expect(box.x, "nicht links abgeschnitten").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "rechts im Viewport").toBeLessThanOrEqual(app.viewportSize()!.width);
  });
});

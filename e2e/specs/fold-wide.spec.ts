import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0180: Galaxy Z Fold 7 ausgeklappt — das innere Display ist hoch und rund
 * 832 CSS-px breit. Die App hielt trotzdem an einer 680-px-Spalte fest: links und
 * rechts schwarze Balken, die Sitzungsliste als quer scrollbarer Streifen über der
 * Session. Ausgeklappt soll die Breite benutzt werden: Liste links, Session rechts,
 * nichts überragt den Rand. Am Handy (412 px) bleibt alles wie bisher.
 */
const FOLD = { width: 832, height: 1088 };
const PHONE = { width: 412, height: 915 };

/** Bedienelemente, die über den Rand hinausragen oder auserhalb des Viewports liegen. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const sel = ".session-topbar button, .composer button, .strip-item, .dock button, .files-tabs button";
    return [...document.querySelectorAll(sel)]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return r.width === 0 ? null : r.right > vw + 1 || r.left < -1 ? `${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}` : null;
      })
      .filter((x): x is string => x !== null);
  });
}

test.describe("Z Fold ausgeklappt (BUG-0180)", () => {
  test("Liste links, Session rechts — die Breite wird benutzt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" }); // eine zweite Session — die Liste soll zeigen, was sie hat
    const id = await hub.createSession({ adapter: "dummy" });
    await app.setViewportSize(FOLD);
    await app.goto(`${hub.origin}/#/sessions/${id}`);

    await expect(app.locator(".split")).toBeVisible();
    const boxes = await app.evaluate(() => {
      const list = document.querySelector(".split-list")!.getBoundingClientRect();
      const detail = document.querySelector(".split-detail")!.getBoundingClientRect();
      return { listWidth: list.width, listRight: list.right, detailLeft: detail.left, detailRight: detail.right, viewport: innerWidth };
    });
    expect(boxes.listWidth).toBeGreaterThanOrEqual(200);
    expect(boxes.listRight).toBeLessThanOrEqual(boxes.detailLeft + 1);
    expect(boxes.detailRight).toBeGreaterThanOrEqual(boxes.viewport - 28);
    expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(boxes.viewport);
    expect(await overflowing(app)).toEqual([]);

    const list = app.locator(".split-list");
    await expect(list.locator(".session-card")).toHaveCount(2);
    await expect(list.locator(".session-card[aria-current]")).toHaveCount(1);
    await expect(list.getByRole("button", { name: "Neue Session", exact: true })).toBeVisible();
  });

  test("am Handy bleibt es eine Spalte — und nichts ragt heraus", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.setViewportSize(PHONE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".split")).toHaveCount(0);
    await expect(app.locator(".session-topbar")).toBeVisible();
    expect(await overflowing(app)).toEqual([]);
  });
});

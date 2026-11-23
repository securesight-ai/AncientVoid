import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P43 T43.9: Tastatur- und Screenreader-Durchgang über die umgebauten Ansichten. Kein Ersatz für einen echten
 * Screenreader — geprüft wird, was er braucht: jede sichtbare Bedienung hat einen Namen, der Fokus ist sichtbar
 * und landet beim Öffnen und Schließen eines Blatts dort, wo man ihn erwartet.
 */

/** Sichtbare Bedienelemente ohne zugänglichen Namen — beschrieben, damit ein Fund lesbar ist. */
function unnamed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const nameOf = (el: Element): string => {
      const label = el.getAttribute("aria-label") ?? "";
      if (label.trim()) return label;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const own = [...(el.labels ?? [])].map((l) => l.textContent ?? "").join(" ");
        return own || (el as HTMLInputElement).placeholder || el.title;
      }
      return (el.textContent ?? "").trim() || el.getAttribute("title") || el.getAttribute("data-tip") || "";
    };
    return [...document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=menuitem], input:not([type=hidden]), textarea, select")]
      .filter(visible)
      .filter((el) => !nameOf(el).trim())
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
  });
}

async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const st = getComputedStyle(el);
    return (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
  });
}

test.describe("Tastatur und Screenreader (EPIC-P43 T43.9)", () => {
  test("Start, Session und Nyx-Blatt: jede sichtbare Bedienung hat einen Namen @tablet @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await hub.until(async () => (await hub.api<{ sessionId: string }[]>("/api/approvals?status=pending")).body.some((a) => a.sessionId === id), "Freigabe");
    await app.reload();
    await expect(app.locator(".card-decision").first()).toBeVisible();
    expect(await unnamed(app), "Start").toEqual([]);

    await app.locator(".topbar .nyx-button").click();
    await expect(app.getByRole("dialog", { name: "Nyx" })).toBeVisible();
    expect(await unnamed(app), "Nyx-Blatt").toEqual([]);
    await app.keyboard.press("Escape");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title").first()).toBeVisible();
    expect(await unnamed(app), "Session").toEqual([]);
  });

  test("per Tastatur: Nyx erreichen, Blatt öffnet mit Fokus darin, Esc gibt den Fokus zurück; Strg+K fokussiert das Feld @desktop", async ({ app }) => {
    const nyx = app.locator(".topbar .nyx-button");
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await app.keyboard.press("Tab");
      reached = await nyx.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "Nyx ist per Tab erreichbar").toBe(true);
    expect(await focusVisible(app), "Fokus auf Nyx ist sichtbar").toBe(true);

    await app.keyboard.press("Enter");
    const sheet = app.getByRole("dialog", { name: "Nyx" });
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await app.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement)), "Tab bleibt zuerst im Blatt").toBe(true);
    await app.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(nyx).toBeFocused();

    await app.keyboard.press("Control+k");
    await expect(app.getByLabel("Auftrag", { exact: true })).toBeFocused();
    await app.keyboard.press("Escape");
  });
});

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { test, expect } from "../support/fixtures.ts";

test.describe("Layout (T8.5, AC-P8-5)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("390×844 ohne Tastatur: mindestens die Hälfte der Höhe gehört dem Inhalt", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Hallo" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    const share = await app.evaluate(() => {
      const tail = document.querySelector(".tail-scroll")!.getBoundingClientRect();
      const dock = document.querySelector(".dock-stack")!.getBoundingClientRect();
      return (dock.top - tail.top) / innerHeight;
    });
    test.info().annotations.push({ type: "Inhaltsanteil", description: `${Math.round(share * 1000) / 10} %` });
    expect(share).toBeGreaterThanOrEqual(0.5);
  });

  test("Stop steht abseits von Senden, Zurück führt zur Übersicht, ⋯ hält den Rest", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const stop = app.locator(".session-topbar").getByRole("button", { name: "Stop" });
    await expect(stop).toBeVisible();
    await expect(app.locator(".composer-actions").getByRole("button", { name: "Stop" })).toHaveCount(0);
    await app.getByLabel("Weitere Aktionen").click();
    await app.locator(".session-menu").getByRole("button", { name: "Umbenennen" }).click();
    await app.getByLabel("Neuer Titel").fill("Langsamer Lauf");
    await app.getByRole("button", { name: "OK" }).click();
    await expect(app.locator(".session-top-title")).toHaveText("Langsamer Lauf");
    await app.getByLabel("Zur Übersicht").click();
    await expect(app.locator(".session-card .session-title")).toHaveText("Langsamer Lauf");
  });

  // BUG-0234: ab 700 px ist die Session-Liste dauerhaft sichtbar (TabletSplit/Split) —
  // der Übersicht-Knopf neben dem Titel gehört nur auf das Handy (BUG-0279: Icon statt Pfeil).
  test("Übersicht-Knopf nur unter 700 px — darüber ist die Liste der Weg zurück", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Zurück-Pfeil" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Zur Übersicht")).toBeVisible();
    await app.setViewportSize({ width: 900, height: 600 });
    await expect(app.getByLabel("Zur Übersicht")).toBeHidden();
  });

  test("Tipp-Ziele sind mindestens 40 px hoch", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Hallo" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    const small = await app.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".topbar button, .topbar summary, .composer-actions .btn, .subtabs-wrap button")]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 40)
        .map((el) => `${el.textContent?.trim() || el.getAttribute("aria-label")} ${Math.round(el.getBoundingClientRect().height)}`),
    );
    expect(small).toEqual([]);
  });

  test("per Tastatur bedienbar, jeder Knopf hat einen Namen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Tastaturtest" });
    await expect(app.locator(".session-card")).toHaveCount(1);
    for (let i = 0; i < 25; i++) {
      await app.keyboard.press("Tab");
      if (await app.evaluate(() => document.activeElement?.classList.contains("session-open") ?? false)) break;
    }
    await expect(app.locator(".session-open")).toBeFocused();
    const outline = await app.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
    await app.keyboard.press("Enter");
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    const unnamed = await app.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, summary, input, textarea")]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).placeholder || el.getAttribute("title") || el.getAttribute("data-tip")))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });
});

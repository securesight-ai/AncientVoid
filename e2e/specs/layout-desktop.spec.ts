import { test, expect, sessionTab } from "../support/fixtures.ts";

test.describe("Desktop (T8.5, AC-P8-6)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("ab 1280 px: Liste links, Session rechts — Wechsel ohne Seitenwechsel", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await expect(app.locator(".tile-empty")).toContainText("Session links wählen");
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");
    await expect(app.locator(".split-list .session-card")).toHaveCount(2);
    await app.locator(".split-list .session-card").filter({ hasText: "Zweite Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Zweite Aufgabe");
    const [list, detail] = await Promise.all([app.locator(".split-list").boundingBox(), app.locator(".split-detail").boundingBox()]);
    expect(list!.x + list!.width).toBeLessThanOrEqual(detail!.x);
    expect(detail!.width).toBeGreaterThan(600);
  });

  test("Icon-Leisten, klickbare Kürzel und kein Fenster-Scroll (P21)", async ({ app, hub }) => {
    // Mit einer geänderten Datei, damit „Änderungen“ in der Leiste steht (Kleinkram-Regel 2).
    const first = await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe: Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${first}`)).body.status === "idle", "Zug fertig");
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toContainText("Erste Aufgabe");

    // Das Fenster selbst scrollt nie.
    const overflow = await app.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);

    // Globale Navigation: schmale Leiste am linken Rand, Beschriftung nur als Tooltip/Name.
    const rail = await app.locator(".split-list .dock-stack").boundingBox();
    expect(rail!.width).toBeLessThanOrEqual(64);
    await expect(app.locator('.split-list .dock-item[data-shortcut="files.toggle"]')).toHaveAttribute("data-tip", "Dateibaum (Strg+Umschalt+E)");

    // EPIC-P43 T43.6: die Ansichten stehen im Kachelkopf (Griff, Titel, Zustand, Reiter, rechts Herauslösen) —
    // Chat, Änderungen, Befehle und „Mehr“ (Verlauf, Bericht, Datei, Graph, GitLab, Suche, Umgebung).
    const tabs = app.locator(".tile .session-topbar .tile-tabs");
    await expect(tabs.getByRole("button")).toHaveCount(4);
    const head = app.locator(".tile .session-topbar").first();
    const [tabBox, headBox, titleBox, detachBox] = await Promise.all([
      tabs.boundingBox(),
      head.boundingBox(),
      head.locator(".session-top-title").boundingBox(),
      head.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).boundingBox(),
    ]);
    expect(tabBox!.y).toBeLessThan(headBox!.y + headBox!.height);
    expect(tabBox!.x).toBeGreaterThan(titleBox!.x);
    expect(detachBox!.x).toBeGreaterThan(tabBox!.x + tabBox!.width - 1);
    await expect(app.locator(".tile-rail")).toHaveCount(0);
    await sessionTab(app.locator(".tile").first(), "Bericht");
    // Der Bericht gehört zu „Änderungen“: dort steht die Markierung, auch wenn er über „Mehr“ geöffnet wurde.
    await expect(tabs.getByRole("button", { name: /^Änderungen/ })).toHaveAttribute("aria-current", "page");
    await expect(app.locator(".tile .kv-list").first()).toContainText("Kontextfenster");

    // Kürzel als Knöpfe: Layout wechseln; mit gelöstem Raster schließt kompakt.
    await app.getByRole("group", { name: "Kachel-Aktionen" }).getByRole("button", { name: /Layout/ }).click();
    await expect(app.locator(".tile")).not.toHaveCount(1);
    await app.getByRole("button", { name: "Layout lösen" }).click();
    const tiles = await app.locator(".tile").count();
    await app.getByRole("button", { name: /Schließen/ }).click();
    expect(await app.locator(".tile").count()).toBeLessThan(tiles);
  });
});

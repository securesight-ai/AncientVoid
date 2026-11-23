import { test, expect, enableAutoTiling } from "../support/fixtures.ts";

/**
 * QoL 2026-10-29 (Nutzerwunsch): Eingaben ganz lesbar und Kacheln/Session-
 * Flächen in der Desktop-Ansicht frei größenziehbar. K2.
 */
test.describe("Eingabefeld (QoL 2026-10-29)", () => {
  test("wächst mit langem Text und bleibt manuell resize-bar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await expect(field).toBeVisible();
    // EPIC-P43 T43.4: einzeilig bis zum ersten Fokus, danach frei größenziehbar.
    await field.click();
    expect(await field.evaluate((el) => getComputedStyle(el).resize)).toBe("vertical");
    const before = (await field.boundingBox())!.height;
    await field.fill(Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1} mit etwas Text`).join("\n"));
    // BUG-0094-Nachtrag: Auto-Grow greift erst nach dem Re-Render — pollend
    // abwarten statt sofort messen (dasselbe Rennen wie im Maximieren-Test,
    // CI-Lauf 3036020478 machte es hier rot). Erst danach die Höhe entnehmen.
    await expect
      .poll(async () => (await field.boundingBox())!.height, { timeout: 5_000 })
      .toBeGreaterThan(before + 100);
    const after = (await field.boundingBox())!.height;
    // Leeren setzt die Höhe zurück — nach dem Blur, sonst gilt das Fokus-Minimum.
    await field.fill("");
    await field.evaluate((el) => el.blur());
    // BUG-0107-Nachtrag: dasselbe Rennen wie beim Wachsen darüber — auch das
    // Zurücksetzen greift erst nach dem Re-Render; unter CI-Last war die alte
    // Höhe noch nicht geschrumpft (erwartet <123, gemessen 223, Pipeline
    // 3042625158). Pollend abwarten statt sofort messen.
    await expect
      .poll(async () => (await field.boundingBox())!.height, { timeout: 5_000 })
      .toBeLessThan(after - 100);
  });

  test("Maximieren-Button macht das Feld groß und wieder klein", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    const vh = await app.evaluate(() => window.innerHeight);
    const idle = (await field.boundingBox())!.height;
    expect(idle).toBeLessThan(vh * 0.2); // im Ruhestand klein …

    await app.getByRole("button", { name: "Eingabe maximieren" }).click();
    const big = (await field.boundingBox())!.height;
    expect(big).toBeGreaterThanOrEqual(vh * 0.6); // … auf Tipp deutlich über 33 %
    await app.getByRole("button", { name: "Eingabe verkleinern" }).click();
    const back = (await field.boundingBox())!.height;
    expect(back).toBeLessThan(big - 150);
    // Und der Weg dazwischen bleibt: Text wächst ins Feld (Auto-Grow, MR !257).
    await field.fill(Array.from({ length: 8 }, (_, i) => `Zeile ${i + 1}`).join("\n"));
    // BUG-0094: Auto-Grow greift erst nach dem React-Re-Render — die Höhe
    // pollend abwarten statt sofort messen (CI-Timing schlug sonst zu).
    await expect
      .poll(async () => (await field.boundingBox())!.height, { timeout: 5_000 })
      .toBeGreaterThan(idle + 60);
  });
});

test.describe("Kachel-Trenner (QoL 2026-10-29)", () => {
  // Wie layout-desktop.spec.ts: Der Split braucht Breite — auch im mobile-Projekt wird der Viewport erzwungen.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Breite ändert sich und überlebt das Neuladen @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await enableAutoTiling(app);
    // Strg-Klick: zweite Session in einer eigenen Kachel (2v, T18.2).
    await app.locator(".split-list .session-card").filter({ hasText: "Zweite Aufgabe" }).locator(".session-open").click({ modifiers: ["Control"] });
    await expect(app.locator(".tile")).toHaveCount(2);
    const divider = app.locator(".tile-divider.col");
    await expect(divider).toBeVisible();
    const first = app.locator(".tile").nth(0);
    const second = app.locator(".tile").nth(1);
    const w1 = (await first.boundingBox())!.width;
    const w2 = (await second.boundingBox())!.width;
    expect(Math.abs(w1 - w2)).toBeLessThan(40); // Start: halbe/halbe

    const box = (await divider.boundingBox())!;
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.mouse.down();
    await app.mouse.move(box.x + 250, box.y + box.height / 2, { steps: 10 });
    await app.mouse.up();
    const w1n = (await first.boundingBox())!.width;
    const w2n = (await second.boundingBox())!.width;
    expect(w1n).toBeGreaterThan(w1 + 150);
    expect(w2n).toBeLessThan(w2 - 150);

    // Persistenz pro Gerät (P18 T18.5-Muster): nach dem Neuladen bleibt die gezogene Größe.
    await app.reload();
    await expect(app.locator(".tile")).toHaveCount(2);
    const w1r = (await app.locator(".tile").nth(0).boundingBox())!.width;
    expect(Math.abs(w1r - w1n)).toBeLessThan(6);
  });
});

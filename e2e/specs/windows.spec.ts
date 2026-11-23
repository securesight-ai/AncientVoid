import { test, expect, dockGo, clickClosing } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P34 T34.10 (AC-P34-9, AC-P34-10): Kacheln und Werkzeuge in eigenen Fenstern, Abstimmung über den Kanal. */
test.describe("Eigene Fenster (EPIC-P34)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Jede Seite (auch ein Fenster) protokolliert, was sie in den localStorage schreibt.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      const writes: string[] = [];
      (window as unknown as { __writes: string[] }).__writes = writes;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        writes.push(key);
        return set.call(this, key, value);
      };
    });
  });

  const card = (app: Page, text: string) => app.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");
  const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes);

  test("⧉ legt die Kachel in ein eigenes Fenster, die Liste zeigt das Abzeichen, ein Klick holt es nach vorn, „In die App zurück“ bringt sie heim @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Fenster Aufgabe" });
    await card(app, "Fenster Aufgabe").click();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();

    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await popup.waitForLoadState();
    expect(popup.url()).toContain("window=1");
    expect(popup.url()).not.toMatch(/token/i);
    await expect(popup.locator(".session-topbar")).toBeVisible();
    // Schlanke Hülle: weder Dock noch Liste noch Kachel-Tasten.
    await expect(popup.locator(".dock, .split-list, .tile-bar")).toHaveCount(0);
    // BUG-0103: ganze Fensterfläche, nicht die 680-px-Handyspalte.
    const width = await popup.evaluate(() => ({ app: document.getElementById("app")!.clientWidth, win: window.innerWidth }));
    expect(width.app).toBe(width.win);
    // BUG-0104: auch die Kachel selbst nutzt die Fläche — keine mitwachsende
    // Lesespalte (1200-px-Zentrierung), kein horizontaler Scroll.
    const geo = await popup.evaluate(() => {
      const tile = document.querySelector(".popout-tile")!;
      return { pad: parseFloat(getComputedStyle(tile).paddingLeft), scrollW: document.documentElement.scrollWidth, win: window.innerWidth };
    });
    expect(geo.pad).toBeLessThanOrEqual(12);
    expect(geo.scrollW).toBeLessThanOrEqual(geo.win);

    // Hauptfenster: Kachel frei, Abzeichen in der Liste, Stand gemerkt.
    await expect(app.locator('[data-tile="1"] .tile-empty')).toBeVisible();
    await expect(app.locator(".split-list .badge-window")).toHaveText("⧉ eigenes Fenster");
    const stored = JSON.parse((await app.evaluate(() => localStorage.getItem("ancientvoid.workspace")))!);
    expect(stored.detached).toHaveLength(1);

    // Klick auf die Session in der Liste: das Fenster kommt nach vorn, es entsteht keine zweite Ansicht.
    await card(app, "Fenster Aufgabe").click();
    await expect(popup.locator("html")).toHaveAttribute("data-focus-requests", "1");
    await expect(app.locator('[data-tile="1"] .session-topbar')).toHaveCount(0);

    // Das Fenster schreibt nie den Arbeitsbereich des Hauptfensters.
    expect(await writes(popup)).not.toContain("ancientvoid.workspace");
    expect(await writes(popup)).not.toContain("ancientvoid.lastSession");

    await clickClosing(popup, popup.getByRole("button", { name: "In die App zurück" }));
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    await expect(app.locator(".badge-window")).toHaveCount(0);
    expect(JSON.parse((await app.evaluate(() => localStorage.getItem("ancientvoid.workspace")))!).detached).toBeUndefined();
  });

  test("BUG-0112: das eigene Fenster scrollt nie — auch mit UI-Zoom füllt die Shell exakt das Fenster @desktop", async ({ app, hub, context }) => {
    await context.addInitScript((scale) => localStorage.setItem("ancientvoid.uiScale", scale), "1.3");
    await hub.createSession({ adapter: "dummy" });
    await app.locator(".split-list .session-card").first().locator(".session-open").click();
    await app.locator('[data-tile="1"] .session-topbar').waitFor();

    const popupP = context.waitForEvent("page");
    await app.locator(".tile-popout").first().click();
    const popup = await popupP;
    await popup.waitForLoadState();
    await expect(popup.locator(".session-topbar")).toBeVisible();

    // Fenster füllt das Fenster exakt: kein Seiten-Scroll (BUG-0112), Shell-
    // Unterkante == Fensterhöhe — unter html-zoom sind dvh Layout-Pixel und
    // müssen durch --ui-zoom geteilt werden (Muster BUG-0099).
    const geo = await popup.evaluate(() => {
      const se = document.scrollingElement!;
      const shell = document.querySelector(".popout-shell");
      return {
        pageScrollable: se.scrollHeight > se.clientHeight + 1,
        pageOverflow: se.scrollHeight - se.clientHeight,
        shellBottom: Math.round(shell?.getBoundingClientRect().bottom ?? -1),
        innerHeight: window.innerHeight,
      };
    });
    expect(geo.pageScrollable, `Seite scrollt um ${geo.pageOverflow}px`).toBe(false);
    expect(Math.abs(geo.shellBottom - geo.innerHeight)).toBeLessThanOrEqual(1);
    await popup.close();
  });

  test("ein Werkzeug (Einstellungen) wandert per ⧉ in ein eigenes Fenster; Esc schließt dort nichts @desktop", async ({ app, context }) => {
    await dockGo(app, "Einstellungen");
    const popupP = context.waitForEvent("page");
    // Auf die Werkzeugfläche begrenzt: seit T43.7 trägt auch die Warteschlange eine „… in eigenem Fenster öffnen“-Taste.
    await app.locator(".tool-pane").getByRole("button", { name: "In eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(popup.locator(".settings-page")).toBeVisible();
    await expect(popup.locator(".dock, .split-list")).toHaveCount(0);
    // Im Hauptfenster ist die Werkzeugfläche zu.
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await popup.keyboard.press("Escape");
    await expect(popup.locator(".settings-page")).toBeVisible();
    await clickClosing(popup, popup.getByRole("button", { name: "In die App zurück" }));
  });

  test("BUG-0262: die Notizen-Kachel löst sich als Notizen-Fenster, nicht als leeres Session-Fenster @desktop", async ({ app, context }) => {
    await dockGo(app, "Notizen");
    const popupP = context.waitForEvent("page");
    await app.locator(".tool-pane").getByRole("button", { name: "In eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await popup.waitForLoadState();
    // Vorher: /?window=1#/sessions/ — leeres Fenster „Dieses Fenster hat kein Ziel."
    expect(popup.url()).toContain("window=1#/notizen");
    // Der Testhub hat einen leeren Vault — die Seite zeigt ihren Ersteinrichtungs-
    // Zustand (Zielordner wählen). Hauptsache: es ist die Notizen-Seite, nicht die Leerstelle.
    await expect(popup.locator('[data-testid="vault-pane"], [data-testid="vault-picker"]')).toBeVisible();
    await expect(popup.getByText("Dieses Fenster hat kein Ziel.")).toHaveCount(0);
    // Hauptfenster: die Kachel ist abgelöst …
    await expect(app.locator('[data-tile="1"] .tile-empty')).toBeVisible();
    // … und „In die App zurück“ bringt die Seite als Kachel heim.
    await clickClosing(popup, popup.getByRole("button", { name: "In die App zurück" }));
    await expect(app.locator(".tool-pane")).toContainText("Notizen");
  });

  test("nach einem Neuladen des Hauptfensters melden sich offene Fenster wieder an @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Reload Aufgabe" });
    await card(app, "Reload Aufgabe").click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(app.locator(".badge-window")).toBeVisible();
    await app.reload();
    await expect(app.locator(".split-list .badge-window")).toBeVisible();
    await popup.close();
  });

  test("ein blockiertes Pop-up wird gemeldet, die Kachel bleibt unverändert @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Blockiert Aufgabe" });
    await card(app, "Blockiert Aufgabe").click();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    await app.evaluate(() => {
      window.open = () => null;
    });
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    await expect(app.getByRole("alert").filter({ hasText: "Pop-ups" })).toBeVisible({ timeout: 6000 });
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    expect(JSON.parse((await app.evaluate(() => localStorage.getItem("ancientvoid.workspace")))!).detached).toBeUndefined();
  });

  test("AC-P34-9: eine Kachel am Griff aus dem Fenster ziehen öffnet sie in einem eigenen Fenster @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Zieh Aufgabe" });
    await card(app, "Zieh Aufgabe").click();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    const grip = app.locator('[data-tile="1"] .tile-grip');
    const box = (await grip.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Innerhalb des Fensters losgelassen: nichts passiert.
    await app.mouse.move(from.x, from.y);
    await app.mouse.down();
    await app.mouse.move(from.x + 200, from.y + 100, { steps: 6 });
    await app.mouse.up();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    expect(JSON.parse((await app.evaluate(() => localStorage.getItem("ancientvoid.workspace")))!).detached).toBeUndefined();

    // Über den Fensterrand hinaus losgelassen: eigenes Fenster.
    const popupP = context.waitForEvent("page");
    await app.mouse.move(from.x, from.y);
    await app.mouse.down();
    await app.mouse.move(from.x - 40, from.y, { steps: 4 });
    await app.mouse.move(-60, from.y, { steps: 8 });
    await expect(app.locator('[data-tile="1"].drag-out')).toBeVisible();
    await app.mouse.up();
    const popup = await popupP;
    await expect(popup.locator(".session-topbar")).toBeVisible();
    await expect(app.locator('[data-tile="1"] .tile-empty')).toBeVisible();
    await popup.close();
  });

  test("AC-P34-11: Theme, Akzent und Schrift erreichen ein offenes Fenster ohne Neuladen @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Sync Aufgabe" });
    await card(app, "Sync Aufgabe").click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(popup.locator(".session-topbar")).toBeVisible();
    await expect(popup.locator("html")).toHaveAttribute("data-theme", "dark");

    await dockGo(app, "Einstellungen");
    await app.locator(".segmented").getByRole("button", { name: "Hell" }).click();
    await expect(popup.locator("html")).toHaveAttribute("data-theme", "light");
    await app.getByRole("radiogroup", { name: "Schriftart Oberfläche" }).getByRole("radio", { name: /Atkinson/ }).click();
    await expect.poll(() => popup.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-ui"))).toContain("Atkinson");
    await app.getByRole("button", { name: /Akzentfarbe wählen/ }).click();
    await app.getByRole("dialog", { name: /Akzentfarbe/ }).getByLabel("Hex", { exact: true }).fill("#33aaff");
    await app.getByRole("dialog", { name: /Akzentfarbe/ }).getByRole("button", { name: "Übernehmen" }).click();
    await expect.poll(() => popup.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#33aaff");
    await popup.close();
  });

  test("AC-P34-10 / BUG-0245: ein geschlossenes Fenster räumt detached auf — Session ist wieder in einer Kachel öffnbar @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Wieder Aufgabe" });
    await card(app, "Wieder Aufgabe").click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(app.locator(".badge-window")).toBeVisible();

    await popup.close();
    await expect(app.locator(".badge-window")).toHaveCount(0);
    // Grace nach bye: Reload würde hello senden und forget abbrechen; echtes Schließen vergisst detached.
    await expect.poll(async () => {
      const stored = JSON.parse((await app.evaluate(() => localStorage.getItem("ancientvoid.workspace")))!);
      return stored.detached;
    }).toBeUndefined();
    await expect(app.locator(".restore-bar")).toHaveCount(0);
    await card(app, "Wieder Aufgabe").click();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
  });

  test("AC-P34-10: ein hängendes Fenster (keine Herzschläge, kein bye) fällt nach der Frist aus dem Register @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Absturz Aufgabe" });
    await card(app, "Absturz Aufgabe").click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(app.locator(".badge-window")).toBeVisible();
    // Ein hängendes oder abgestürztes Fenster sendet weder Herzschläge noch `bye`: hier werden nur die Herzschläge verschluckt.
    await popup.evaluate(() => {
      const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (message: unknown) {
        if ((message as { type?: string })?.type === "heartbeat") return;
        return post.call(this, message);
      };
    });
    // Frist: 10 s ohne Herzschlag (Protokoll), plus Prüfintervall.
    await expect(app.locator(".badge-window")).toHaveCount(0, { timeout: 16_000 });
    await expect(app.locator(".restore-bar")).toContainText("1 Fenster");
    await card(app, "Absturz Aufgabe").click();
    await expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible();
    await expect(app.locator(".restore-bar")).toHaveCount(0);
  });

  test("Offline: das Fenster sagt es, statt still zu veralten @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Offline Aufgabe" });
    await card(app, "Offline Aufgabe").click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(popup.locator(".session-topbar")).toBeVisible();
    await context.setOffline(true);
    await expect(popup.locator(".popout-offline")).toBeVisible();
    await context.setOffline(false);
    await expect(popup.locator(".popout-offline")).toHaveCount(0);
    await popup.close();
  });
});

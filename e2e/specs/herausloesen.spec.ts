import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, sessionTab, clickClosing } from "../support/fixtures.ts";
import { manifestProject } from "../support/workspace-project.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P43 T43.7 (AC-P43-7, ADR-0068): jede Ansicht einer Session und die Warteschlange lassen sich am PC
 * herauslösen und zurückholen; die Kachel zeigt einen Platzhalter, die Statusleiste zählt die Fenster.
 */
test.describe("Herauslösen überall (EPIC-P43 T43.7)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openTile(app: Page, hub: TestHub, prompt: string) {
    await hub.createSession({ adapter: "opencode", prompt });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.locator(".split-list .session-card").filter({ hasText: prompt }).locator(".session-open").click();
    const tile = app.locator('[data-tile="1"]');
    await expect(tile.locator(".session-topbar")).toBeVisible();
    return tile;
  }

  async function detach(context: BrowserContext, app: Page, name: string): Promise<Page> {
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: `${name} in eigenem Fenster öffnen` }).click();
    const popup = await popupP;
    await popup.waitForLoadState();
    return popup;
  }

  test("„Änderungen“ als Fenster: nur die Ansicht, Platzhalter mit „Fenster zeigen“ und „Zurückholen“, Zählwerk @desktop", async ({ app, hub, context }) => {
    const tile = await openTile(app, hub, "Lege eine DATEI an");
    await sessionTab(tile, "Änderungen");
    await expect(tile.locator(".changes-head")).toContainText("1 Datei");
    // Herauslösen ist die letzte Taste im Kopf der Ansicht.
    await expect(tile.locator(".changes-head > *").last()).toHaveClass(/detach-wrap/);

    const popup = await detach(context, app, "Änderungen");
    expect(popup.url()).toContain("view=changes");
    expect(popup.url()).not.toMatch(/token/i);
    await expect(popup.locator(".changes-head")).toContainText("1 Datei");
    // Genau die Ansicht: keine Reiter, kein Antwortfeld, kein Session-Menü.
    await expect(popup.locator(".tile-tabs, .dock-stack, .session-menu")).toHaveCount(0);

    const placeholder = tile.locator(".detached-placeholder");
    await expect(placeholder).toContainText("Änderungen läuft in einem eigenen Fenster.");
    await expect(app.getByRole("status", { name: "Statusleiste" })).toContainText("⧉ 1 Fenster");

    await placeholder.getByRole("button", { name: "Fenster zeigen" }).click();
    await expect(popup.locator("html")).toHaveAttribute("data-focus-requests", "1");

    // Neuladen des Hauptfensters: das Fenster meldet sich auf `ping`, der Platzhalter steht wieder.
    await app.reload();
    await sessionTab(app.locator('[data-tile="1"]'), "Änderungen");
    await expect(app.locator('[data-tile="1"] .detached-placeholder')).toBeVisible();

    const closed = popup.waitForEvent("close");
    await app.locator('[data-tile="1"] .detached-placeholder').getByRole("button", { name: "Zurückholen" }).click();
    await closed;
    await expect(app.locator('[data-tile="1"] .changes-head')).toContainText("1 Datei");
    await expect(app.locator(".status-windows")).toHaveCount(0);
  });

  test("jede Ansicht hat die Taste und kommt mit „In die App zurück“ heim @desktop", async ({ app, hub, context }) => {
    const tile = await openTile(app, hub, "Lege eine DATEI an");
    for (const [tab, label, kind] of [
      ["Bericht", "Bericht", "report"],
      ["Befehle", "Befehle", "files"],
      ["GitLab", "GitLab", "forge"],
      ["Suche", "Suche", "search"],
    ] as const) {
      await sessionTab(tile, tab);
      const popup = await detach(context, app, label);
      expect(popup.url()).toContain(`view=${kind}`);
      await expect(popup.locator(".popout-title")).toContainText(label);
      await expect(tile.locator(".detached-placeholder")).toContainText(`${label} läuft in einem eigenen Fenster.`);
      await clickClosing(popup, popup.getByRole("button", { name: "In die App zurück" }));
      await expect(tile.locator(".detached-placeholder")).toHaveCount(0);
    }
  });

  test("Umgebung löst sich nur mit Workspace-Session heraus — ohne Workspace bleibt der Eintrag weg @desktop", async ({ app, hub, context }) => {
    // Ohne Manifest ist die Umgebung-Ansicht nicht mehr erreichbar (Kleinkram-Regel 2,
    // Umgebungs-Fix 2026-11-24) — das Herauslösen braucht eine Session mit Workspace-Events.
    const project = manifestProject(hub, "hl-umgebung", { schemaVersion: 1 });
    await hub.createSession({ adapter: "opencode", prompt: "Umgebung herauslösen", project });
    await app.locator(".split-list .session-card").filter({ hasText: "Umgebung herauslösen" }).locator(".session-open").click();
    const tile = app.locator('[data-tile="1"]');
    await sessionTab(tile, "Umgebung");
    const popup = await detach(context, app, "Umgebung");
    expect(popup.url()).toContain("view=environment");
    await expect(popup.locator(".popout-title")).toContainText("Umgebung");
    await expect(tile.locator(".detached-placeholder")).toContainText("Umgebung läuft in einem eigenen Fenster.");
    await clickClosing(popup, popup.getByRole("button", { name: "In die App zurück" }));
    await expect(tile.locator(".detached-placeholder")).toHaveCount(0);
  });

  test("die Warteschlange als Fenster — ohne Dock, Sessions öffnen dort ihr eigenes Fenster @desktop", async ({ app, hub, context }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Warteschlange" });
    await expect(app.locator(".split-list .session-card")).toHaveCount(1);
    const popup = await detach(context, app, "Warteschlange");
    expect(popup.url()).toContain("view=queue");
    await expect(popup.locator(".session-card")).toHaveCount(1);
    await expect(popup.locator(".dock")).toHaveCount(0);
    // Im Fenster selbst gibt es keine Taste zum Herauslösen.
    await expect(popup.getByRole("button", { name: /in eigenem Fenster öffnen/ })).toHaveCount(0);
    await popup.close();
  });

  test("am Handy und Tablet gibt es keine Taste zum Herauslösen", async ({ app, hub }, info) => {
    test.skip(info.project.name !== "mobile", "nur schmal");
    await app.setViewportSize({ width: 412, height: 915 });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Änderungen");
    await expect(app.locator(".changes-head")).toBeVisible();
    await expect(app.locator(".detach-btn")).toHaveCount(0);
  });

  test("AC-P43-7: Scrollposition einer herausgelösten Ansicht überlebt das Öffnen des Fensters @desktop", async ({ app, hub, context }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.locator(".split-list .session-card").filter({ hasText: "Lege eine DATEI an" }).locator(".session-open").click();
    const tile = app.locator('[data-tile="1"]');
    await sessionTab(tile, "Änderungen");
    await expect(tile.locator(".changes-head")).toBeVisible();
    expect(await tile.locator(".session-live").getAttribute("data-tab")).toBe("diff");

    // Init-Script: Popouts mit noopener starten frisch — Position vor dem Laden setzen,
    // und die Scrollfläche trotz React-`style=`-Prop scrollbar halten.
    await context.addInitScript((sessionId) => {
      localStorage.setItem(`ancientvoid.tailScroll.${sessionId}.diff`, "360");
      const keep = () => {
        const node = document.querySelector(".tail-scroll") as HTMLElement | null;
        if (!node) return;
        node.style.setProperty("max-height", "200px", "important");
        node.style.setProperty("padding-bottom", "1600px", "important");
      };
      const boot = () => {
        keep();
        new MutationObserver(keep).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      };
      if (document.documentElement) boot();
      else document.addEventListener("DOMContentLoaded", boot);
    }, id);

    const popup = await detach(context, app, "Änderungen");
    await expect(popup.locator(".changes-head")).toBeVisible();
    expect(await popup.evaluate((sessionId) => localStorage.getItem(`ancientvoid.tailScroll.${sessionId}.diff`), id)).toBe("360");
    await expect.poll(async () => popup.locator(".tail-scroll").evaluate((el) => (el as HTMLElement).scrollTop)).toBeGreaterThan(200);
    await popup.close();
  });
});

import type { Page } from "@playwright/test";
import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * BUG-0053: im Querformat (niedriges Fenster) füllte das Dock fast den ganzen Bildschirm; vom Verlauf
 * blieben ~120 von 368 px. Gemessen am echten Pixel 9 Pro XL: Dock 327 px, Verlauf 120 px.
 */
test.describe("Dock im Querformat", () => {
  const LANDSCAPE = { width: 900, height: 420 };

  const geometry = (app: Page) =>
    app.evaluate(`(() => {
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const tail = box(document.querySelector(".tail-scroll"));
      const dock = box(document.querySelector(".dock-stack"));
      return { height: innerHeight, tail: tail ? Math.round(tail.height) : 0, dock: dock ? Math.round(dock.height) : 0, tailBottom: tail ? Math.round(tail.bottom) : 0, dockTop: dock ? Math.round(dock.top) : 0 };
    })()`) as Promise<{ height: number; tail: number; dock: number; tailBottom: number; dockTop: number }>;

  test("BUG-0053: im Querformat bleibt dem Verlauf mindestens ein Drittel der Höhe", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize(LANDSCAPE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll")).toBeVisible();
    await app.waitForTimeout(1500);
    await expect.poll(async () => (await geometry(app)).tail).toBeGreaterThanOrEqual(LANDSCAPE.height / 3);
    const g = await geometry(app);
    expect(g.dock).toBeLessThanOrEqual(LANDSCAPE.height * 0.55); // das Dock darf nicht fast alles belegen
    expect(g.tailBottom).toBeLessThanOrEqual(g.dockTop + 1); // der Verlauf liegt über dem Dock, nicht darunter
  });

  test("Antwortfeld, Senden und die Tabs bleiben im Querformat erreichbar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize(LANDSCAPE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Steuerung einblenden")).toBeVisible();
    // Im Querformat startet die Steuerung eingeklappt; ein Tipp auf ▴ bringt sie zurück.
    await expect(app.getByRole("button", { name: "Senden" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Chat" })).toBeVisible();
    await app.getByLabel("Steuerung einblenden").click();
    await expect(app.getByRole("button", { name: "Senden" })).toBeVisible();
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Querformat-Test");
    await expect(app.getByRole("button", { name: "Senden" })).toBeEnabled();
  });

  test("im Hochformat bleibt alles wie es war (Modus/Modell sichtbar)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize({ width: 412, height: 915 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Modus")).toBeVisible();
  });
});

/** Maschinenlesbarer Höhen- und Lageplan der Sitzungsansicht. */
const layout = () => {
  const el = (s: string) => document.querySelector(s);
  const tail = el(".tail-scroll")!;
  const dock = el(".dock-stack")!;
  const tabRects = [...document.querySelectorAll(".subtabs-wrap button")].map((b) => b.getBoundingClientRect());
  const tailBox = tail.getBoundingClientRect();
  const dockBox = dock.getBoundingClientRect();
  const strip = el(".session-strip");
  const run = el(".run-strip");
  const input = el(".composer-input");
  return {
    chatHöhe: Math.round(Math.min(dockBox.top, tailBox.bottom) - tailBox.top),
    dockHöhe: Math.round(dockBox.height),
    streifen: strip ? getComputedStyle(strip).flexDirection : "kein Streifen",
    laufleiste: run ? getComputedStyle(run).display : "kein Element",
    eingabe: input ? Math.round(input.getBoundingClientRect().height) : 0,
    tabsImScreen: tabRects.length > 0 && tabRects.every((r) => r.height > 0 && r.bottom <= window.innerHeight + 1 && r.top >= -1),
    horizontalesScrollen: document.documentElement.scrollWidth - window.innerWidth,
  };
};

const QUER = { width: 915, height: 412 }; // Handy bzw. Fold-Außendisplay quer
const HOCH = { width: 412, height: 915 };

test.describe("Drehen und Querformat (BUG-0181)", () => {
  test("das Manifest erzwingt keine Hochformat-Sperre", async ({ hub }) => {
    const manifest = await hub.api<{ orientation?: string }>("/manifest.webmanifest");
    // "any" (oder kein Feld) heißt: das Gerät entscheidet, nicht die App.
    expect(manifest.body.orientation ?? "any").toBe("any");
  });

  test("Querformat: Chat behält Leshöhe, Bedienung bleibt im Screen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Dreh-Test" });
    await app.setViewportSize(QUER);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");

    const q = await app.evaluate(layout);
    // Vor dem Fix: Dock 278 von 412 px, Laufleiste 66 px, Chat 48 px.
    expect(q.dockHöhe, "der Dock darf ein niedriges Fenster nicht dominieren").toBeLessThanOrEqual(200);
    expect(q.chatHöhe, "der Chat muss im Querformat Zeilen behalten").toBeGreaterThanOrEqual(90);
    expect(q.tabsImScreen, "keine abgeschnittene Tab-Leiste").toBe(true);
    expect(q.horizontalesScrollen, "kein horizontales Scrollen").toBeLessThanOrEqual(0);
    expect(q.laufleiste, "Laufleiste ist im Querformat ausgeblendet").toBe("none");
    // Der Sitzungsstreifen steht als Spalte links statt quer obendrauf.
    expect(q.streifen).toBe("column");

    // BUG-0053: im niedrigen Fenster startet die Steuerung zugeklappt — ein Tipp
    // (▴) holt Eingabe und Warteschlange zurück, ohne den Chat zu verdrängen.
    await app.click(".dock-toggle");
    await expect.poll(async () => (await app.evaluate(layout)).eingabe, "Eingabe nach einem Tipp sichtbar").toBeGreaterThan(0);
    const offen = await app.evaluate(layout);
    expect(offen.chatHöhe, "auch mit offener Steuerung bleibt Lesehöhe").toBeGreaterThanOrEqual(90);
    expect(offen.tabsImScreen).toBe(true);
  });

  test("drehen ohne Neuladen baut um (hoch -> quer -> hoch)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Dreh-Test 2" });
    await app.setViewportSize(HOCH);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");

    const hoch = await app.evaluate(layout);
    expect(hoch.streifen, "im Handy-Hochformat gibt keinen Sitzungsstreifen").toBe("kein Streifen");
    expect(hoch.laufleiste, "Hochformat zeigt die Laufleiste weiter").not.toBe("none");
    expect(hoch.eingabe, "Hochformat zeigt die Eingabe").toBeGreaterThan(0);

    // Drehen wie am echten Gerät: nur die Viewport-Maße ändern, kein Reload.
    await app.setViewportSize(QUER);
    await expect
      .poll(async () => (await app.evaluate(layout)).laufleiste, "Laufleiste verschwindet im Querformat")
      .toBe("none");
    // Der Sitzungsstreifen kommt aus React (Media-Breakpoint), nicht aus CSS —
    // er darf nach dem Drehen nicht fehlen, bis neu geladen wird.
    await expect
      .poll(async () => (await app.evaluate(layout)).streifen, "Sitzungsstreifen erscheint als Spalte")
      .toBe("column");
    const quer = await app.evaluate(layout);
    expect(quer.streifen).toBe("column");
    expect(quer.chatHöhe).toBeGreaterThanOrEqual(90);
    expect(quer.dockHöhe).toBeLessThanOrEqual(200);
    expect(quer.tabsImScreen).toBe(true);
    expect(quer.horizontalesScrollen).toBeLessThanOrEqual(0);

    // Zurück ins Hochformat: dieselbe Seite, Laufleiste und Liste wieder da.
    await app.setViewportSize(HOCH);
    await expect
      .poll(async () => (await app.evaluate(layout)).laufleiste, "Laufleiste kommt zurück")
      .not.toBe("none");
    const zurueck = await app.evaluate(layout);
    expect(zurueck.laufleiste, "Laufleiste kommt zurück").not.toBe("none");
    // Der Streifen ist entweder weg oder wieder die Reihe obendrauf — beides ist
    // Hochformat; Spalte (column) wäre das Querformat-Layout.
    expect(["kein Streifen", "row"], `Streifen nach zurückdrehen: ${zurueck.streifen}`).toContain(zurueck.streifen);
  });
});

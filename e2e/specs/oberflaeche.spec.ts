import { test, expect, dockGo, sessionTab } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";
import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** EPIC-P20: Zoom, schimmernde Kontextleiste. EPIC-P47: Einstellungen nur im Dock. */

const scaleOf = (app: Page) => app.evaluate(() => Number(document.documentElement.style.zoom || "1"));

test.describe("Einstellungen ohne Zahnrad-Duplikat (EPIC-P47 T47.4)", () => {
  test("kein Einstellungen-Zahnrad neben der Glocke mehr", async ({ app }) => {
    await expect(app.locator(".notif-gear")).toHaveCount(0);
    await expect(app.locator(".notif-bell")).toBeVisible();
  });

  test("Einstellungen bleiben über das Dock erreichbar", async ({ app }) => {
    await dockGo(app, "Einstellungen");
    await expect(app).toHaveURL(/#\/einstellungen$/);
    await expect(app.getByText("Zoom der Oberfläche")).toBeVisible();
  });
});

test.describe("Zoom der Oberfläche (EPIC-P20 T20.2)", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("Strg + Plus/Minus/0 ändern die Stufe in 10-%-Schritten, Reload behält sie", async ({ app }) => {
    expect(await scaleOf(app)).toBe(1);
    await app.keyboard.press("Control+Equal");
    await app.keyboard.press("Control+Equal");
    expect(await scaleOf(app)).toBe(1.2);
    await app.reload();
    expect(await scaleOf(app)).toBe(1.2);
    await app.keyboard.press("Control+Minus");
    expect(await scaleOf(app)).toBe(1.1);
    await app.keyboard.press("Control+0");
    expect(await scaleOf(app)).toBe(1);
    await expect.poll(() => app.evaluate(() => localStorage.getItem("ancientvoid.uiScale"))).toBeNull();
  });

  test("Strg + Mausrad vergrößert und verkleinert, Grenzen 50 % und 200 %", async ({ app }) => {
    await app.keyboard.down("Control");
    for (let i = 0; i < 3; i++) await app.mouse.wheel(0, -120);
    await app.keyboard.up("Control");
    await expect.poll(() => scaleOf(app)).toBeGreaterThan(1);
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "0.5"));
    await app.reload();
    await app.keyboard.press("Control+Minus");
    expect(await scaleOf(app)).toBe(0.5);
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "2"));
    await app.reload();
    await app.keyboard.press("Control+Equal");
    expect(await scaleOf(app)).toBe(2);
  });

  test("Einstellungen: Regler zeigt die Stufe und folgt der Tastatur", async ({ app }) => {
    await app.goto(`${app.url().split("#")[0]}#/einstellungen`);
    const value = app.locator(".scale-value");
    await expect(value).toHaveText("100 %");
    await app.getByRole("button", { name: "Größer" }).click();
    await expect(value).toHaveText("110 %");
    await app.keyboard.press("Control+Minus");
    await app.keyboard.press("Control+Minus");
    await expect(value).toHaveText("90 %");
    await app.getByRole("button", { name: "100 %" }).click();
    await expect(value).toHaveText("100 %");
  });

  for (const scale of [0.7, 1.5]) {
    test(`bei ${Math.round(scale * 100)} % liegt die Oberfläche vollständig im Bild (kein Seiten-Scrollbalken, Antwortfeld sichtbar)`, async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Zoom" });
      await app.evaluate((s) => localStorage.setItem("ancientvoid.uiScale", String(s)), scale);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.reload();
      await expect(app.getByPlaceholder("Antworten…").first()).toBeVisible();
      const fit = await app.evaluate(() => {
        const doc = document.documentElement;
        const split = document.querySelector(".split")?.getBoundingClientRect();
        const field = document.querySelector<HTMLElement>("textarea[placeholder='Antworten…']")?.getBoundingClientRect();
        return {
          overflowY: doc.scrollHeight - innerHeight,
          overflowX: doc.scrollWidth - innerWidth,
          splitBottom: split ? split.bottom : null,
          innerHeight,
          fieldBottom: field ? field.bottom : null,
        };
      });
      expect(fit.overflowX).toBeLessThanOrEqual(1);
      expect(fit.overflowY).toBeLessThanOrEqual(1);
      expect(fit.fieldBottom).not.toBeNull();
      expect(fit.fieldBottom!).toBeLessThanOrEqual(fit.innerHeight + 1);
    });
  }
});

test.describe("Schimmernde Kontextleiste (EPIC-P20 T20.5)", () => {
  const bar = (app: Page) => app.locator(".run-strip .ctx-bar").first();

  test("pi mit Fenster: Leiste mit Prozent, Normal-Stufe, Text unverändert", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Wie viele Zeilen?" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(bar(app)).toHaveAttribute("role", "meter");
    await expect(bar(app)).toHaveAttribute("aria-valuenow", "1");
    await expect(bar(app)).toHaveClass(/ok/);
    await expect(bar(app)).toHaveAttribute("aria-valuetext", "Kontext 1 % · frei 129.962 von 131.072");
    await expect(app.locator(".run-strip .run-tokens")).toHaveText("70 Tokens erzeugt · 2.224 Tokens verarbeitet · Kontext 1 % · frei 129.962 von 131.072");
    // The filled part shimmers: an animation runs on the sweep.
    const animated = await bar(app).locator(".ctx-fill").evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(animated).toBe("ctx-shimmer");
  });

  test("ab 80 % Warnstufe, ab 95 % Fehlerstufe", async ({ app, hub }) => {
    const warn = await hub.createSession({ adapter: "pi", prompt: "KONTEXT-WARN" });
    const err = await hub.createSession({ adapter: "pi", prompt: "KONTEXT-FEHLER" });
    for (const id of [warn, err]) await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await app.goto(`${hub.origin}/#/sessions/${warn}`);
    await expect(bar(app)).toHaveClass(/warn/);
    await expect(bar(app)).toHaveAttribute("aria-valuenow", "84");
    await app.goto(`${hub.origin}/#/sessions/${err}`);
    await expect(bar(app)).toHaveClass(/err/);
    await expect(bar(app)).toHaveAttribute("aria-valuenow", "96");
  });

  // EPIC-P43 T43.4 (Kleinkram-Regel 1): ohne Meldung keine Leiste in der Statuszeile; laut bleibt der Bericht.
  test("ohne Meldung des Providers: keine Leiste, der Bericht nennt die fehlende Meldung", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-strip .ctx-bar")).toHaveCount(0);
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontextfenster" })).toContainText("keine Meldung");
  });

  test("Einstellung „Schimmer“ und Systemvorgabe stoppen die Bewegung", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Wie viele Zeilen?" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const anim = () => bar(app).locator(".ctx-fill").evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(await anim()).toBe("ctx-shimmer");
    await app.evaluate(() => (document.documentElement.dataset.ctxMotion = "off"));
    expect(await anim()).toBe("none");
    await app.evaluate(() => (document.documentElement.dataset.ctxMotion = "on"));
    await app.emulateMedia({ reducedMotion: "reduce" });
    expect(await anim()).toBe("none");
  });
});

test.describe("Diff in voller Breite (EPIC-P20 T20.1)", () => {
  async function sessionWithBigDiff(hub: TestHub): Promise<string> {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    const worktree = join(hub.dataDir, "worktrees", id);
    for (const n of [1, 2, 3]) {
      writeFileSync(join(worktree, `gross-${n}.txt`), Array.from({ length: 80 }, (_, i) => `Zeile ${i} von Datei ${n}, mit etwas mehr Text, damit die Zeile eine sinnvolle Länge hat`).join("\n") + "\n");
    }
    return id;
  }

  test.describe("Desktop 2560 × 1440", () => {
    test.use({ viewport: { width: 2560, height: 1440 } });

    test("Dateiliste neben dem Code, der Diff nutzt die Breite, das Dock klappt weg, ein Klick springt zur Datei", async ({ app, hub }) => {
      const id = await sessionWithBigDiff(hub);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Liste einklappen" }).click();
      await sessionTab(app, "Diff");
      const pane = app.locator(".diff-pane");
      await expect(pane.locator(".diff-file-row")).toHaveCount(4);
      const [tile, files, main] = await Promise.all([app.locator(".tile").boundingBox(), pane.locator(".diff-files").boundingBox(), pane.locator(".diff-main").boundingBox()]);
      // Beside, not above: the list ends before the code starts, both start at the same height.
      expect(files!.x + files!.width).toBeLessThanOrEqual(main!.x + 1);
      expect(Math.abs(files!.y - main!.y)).toBeLessThan(40);
      // The reading tab is not capped to the chat's line length any more.
      expect(files!.width + main!.width).toBeGreaterThan(tile!.width * 0.9);
      // New files exist on one side only: they use the whole width, unified, not half of it.
      const fresh = pane.locator(".hunk-card.one-sided").first();
      await expect(fresh.locator(".hunk-body-unified")).toBeVisible();
      await expect(fresh.locator(".hunk-body-split")).toBeHidden();
      expect((await fresh.boundingBox())!.width).toBeGreaterThan(main!.width * 0.95);
      // The composer folds away: the reply field is gone, the tab bar stays.
      await expect(app.getByPlaceholder("Antworten…")).toHaveCount(0);
      await expect(app.getByRole("button", { name: "Chat" })).toBeVisible();
      const scroll = await app.locator(".tile .tail-scroll").boundingBox();
      expect(scroll!.height).toBeGreaterThan(tile!.height * 0.75);
      // A click on a file jumps to its hunks.
      await pane.locator(".diff-file-row").filter({ hasText: "gross-3.txt" }).click();
      await expect(pane.locator(".diff-file-group").filter({ hasText: "gross-3.txt" }).locator(".diff-file-heading")).toBeInViewport();
      // One tap brings the composer back; leaving the tab folds it again next time.
      await app.getByRole("button", { name: "Steuerung einblenden" }).click();
      await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
      await app.getByRole("button", { name: "Chat" }).click();
      await sessionTab(app, "Diff");
      await expect(app.getByPlaceholder("Antworten…")).toHaveCount(0);
    });
  });

  test.describe("Handy 390 × 844", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("bleibt gestapelt: die Dateiliste steht über dem Code, das Dock unverändert", async ({ app, hub }) => {
      const id = await sessionWithBigDiff(hub);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await sessionTab(app, "Diff");
      const [files, main] = await Promise.all([app.locator(".diff-pane > .diff-files").boundingBox(), app.locator(".diff-pane > .diff-main").boundingBox()]);
      expect(files!.y + files!.height).toBeLessThanOrEqual(main!.y + 1);
      expect(Math.abs(files!.x - main!.x)).toBeLessThan(2);
      await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    });
  });
});

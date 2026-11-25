import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { TestHub, type HubOptions } from "./hub.ts";
import { openPhoneTab, phone } from "./phone.ts";

export { expect };

/**
 * BUG-0163: Streng getaktete Specs (~Sekunden-Fenster) laufen auf GitHub-
 * gehosteten Runnern (2 vCPU, ~5× langsamer als lokal) nicht aussagekräftig.
 * `AV_HOSTED_RUNNER=1` setzt die ci.yml; betroffene Tests skippen dort
 * sichtbar via `test.skipIf(hostedRunner)` und bleiben lokal Pflicht.
 */
export const hostedRunner = process.env.AV_HOSTED_RUNNER === "1";

interface Fixtures {
  hubOptions: HubOptions;
  hub: TestHub;
  /** A page that already holds the device token and shows the overview. */
  app: Page;
}

export const test = base.extend<Fixtures>({
  hubOptions: [{}, { option: true }],

  hub: async ({ hubOptions }, use, testInfo) => {
    const hub = await TestHub.start(hubOptions);
    try {
      await use(hub);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("hub.log", { body: readFileSync(hub.logPath), contentType: "text/plain" }).catch(() => undefined);
      }
      await hub.stop();
    }
  },

  // Every test fails on an uncaught exception in the PWA — a crash that
  // happens to leave the asserted text on screen is still a crash.
  page: async ({ page, hub }, use) => {
    // Mit ANCIENTVOID_E2E_CDP (scripts/phone-e2e.mjs) ist der Browser das echte Handy statt des Playwright-Browsers.
    const tab = phone.active ? await openPhoneTab(hub.port) : null;
    const target = tab ? tab.page : page;
    const errors: string[] = [];
    target.on("pageerror", (err) => errors.push(err.message));
    try {
      await use(target);
      expect(errors, "uncaught PWA exceptions").toEqual([]);
    } finally {
      await tab?.close();
    }
  },

  app: async ({ page, hub }, use) => {
    await signIn(page, hub);
    await page.goto(hub.origin);
    await expect(page.getByRole("heading", { name: "AncientVoid", exact: true })).toBeVisible();
    await use(page);
  },
});

export async function signIn(page: Page, hub: TestHub): Promise<void> {
  // Always replace. On the phone, Chrome keeps localStorage per 127.0.0.1 port.
  // A recycled port still holds the previous hub's token, and the gate then
  // stays up with that token filled (BUG-0054).
  // Top frame only: this init script runs in EVERY frame — a sandboxed
  // preview iframe (EPIC-P29, opaque origin) would throw on localStorage
  // and surface as an uncaught page error that belongs to nobody.
  await page.addInitScript((token) => {
    if (window.top === window) {
      localStorage.setItem("ancientvoid.token", token);
      // EPIC-P61 (Premortem 2): Sprach-Standard Deutsch — die bestehenden Specs
      // suchen deutsche Strings; der Runner-Host darf nicht die Sprache wählen.
      // Set-default: Das Sprach-Spec schreibt den Wert selbst und behält ihn
      // über Reloads (addInitScript läuft vor jeder Navigation).
      if (!localStorage.getItem("ancientvoid.language")) localStorage.setItem("ancientvoid.language", "de");
    }
  }, hub.token);
}

/** Opens a session through the overview, the way a user does. */
export async function openFromOverview(page: Page, adapter: string): Promise<void> {
  await page.locator(".dock").getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".session-card").filter({ hasText: adapter }).first().locator(".session-open").click();
}

export function statusPill(page: Page) {
  return page.locator(".topbar .status");
}

/**
 * EPIC-P43 T43.3: ein Ziel der globalen Navigation öffnen. Am PC steht jedes Ziel in der Leiste,
 * am Handy und Tablet liegen Entdeckt, Medien, Notizen, Automationen und Einstellungen unter „Mehr“.
 */
export async function dockGo(page: Page, name: string): Promise<void> {
  const dock = page.locator(".dock");
  const label = name === "Dateibaum" && await page.getByRole("navigation", { name: "Sidebar", exact: true }).count() ? "Projektansicht" : name;
  const target = dock.getByRole("button", { name: label, exact: true });
  const more = dock.getByRole("button", { name: "Mehr", exact: true });
  // Nach einem Reload steht das Dock nicht sofort — erst dann ist „nicht sichtbar“ eine Aussage.
  await expect(target.or(more).first()).toBeVisible();
  if (await target.isVisible()) return target.click();
  await more.click();
  await page.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name, exact: true }).click();
}

/** Enable the workspace mode that adds a tile when a new target opens. */
export async function enableAutoTiling(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Layout lösen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Layout fixieren", exact: true })).toBeVisible();
}

/**
 * EPIC-P43 T43.3: die Freigabe-Warteschlange von Start aus öffnen — über „n Freigaben · alle zeigen“
 * bei „Du bist dran“, oder über das Banner, wenn die Freigabe an keiner Karte hängt.
 */
export async function openApprovals(page: Page): Promise<void> {
  await page.locator(".approval-link, .approval-banner").first().click();
}

/**
 * T8.6: dieses Gerät hat alles Vorhandene gesehen (Lesezeiger auf dem jetzigen
 * Stand) — fertige Sessions stehen danach unter „Ruhig“ statt unter „Du bist dran“.
 */
export async function seeAll(page: Page, hub: TestHub): Promise<void> {
  await hub.until(async () => (await hub.sessions()).every((s) => s.status !== "starting" && s.status !== "working"), "Sessions ruhig");
  const { body } = await hub.api<{ sessions: { id: string; hostId?: string; lastSeq: number }[] }>("/api/fleet");
  const seen = Object.fromEntries(body.sessions.map((s) => [`${s.hostId ?? ""}:${s.id}`, s.lastSeq]));
  await page.evaluate((map) => localStorage.setItem("ancientvoid.seen", JSON.stringify(map)), seen);
  await page.reload();
}

/** EPIC-P43 T43.3: „Ruhig“ ist zu, solange oben etwas steht — für Tests, die eine ruhige Session brauchen. */
export async function openQuiet(page: Page): Promise<void> {
  const fold = page.locator(".section-zuletzt .section-fold");
  await fold.waitFor();
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
}

/**
 * EPIC-P43 T43.4: eine Ansicht der Session öffnen. Chat, Änderungen (früher „Diff“) und Befehle (früher
 * „Code“/„Dateien“) sind Reiter; Verlauf, Bericht, Datei, Graph, GitLab, Suche und Umgebung liegen unter „Mehr“.
 */
export async function sessionTab(scope: Page | Locator, name: string): Promise<void> {
  const bar = scope.locator(".subtabs-wrap").first();
  const main = ({ Diff: "Änderungen", Code: "Befehle", Dateien: "Befehle" } as Record<string, string>)[name] ?? name;
  const direct = bar.getByRole("button", { name: new RegExp(`^${main}`) });
  if (main === "Chat" || main === "Befehle") return direct.click();
  const menu = bar.getByRole("menu", { name: "Weitere Ansichten" });
  if (main === "Änderungen") {
    // Kleinkram-Regel 2 (T43.5): ohne Änderungen rückt „Änderungen“ unter „Mehr“ — und zurück, sobald der
    // nachgeladene Diff eine Datei zeigt. Deshalb wiederholen, bis einer der beiden Wege greift.
    const item = menu.getByRole("menuitem", { name: main, exact: true });
    await expect(async () => {
      // Ein offenes Blatt „Mehr“ ohne den Eintrag deckt die Reiter ab: erst schließen.
      if ((await menu.isVisible()) && !(await item.isVisible())) await bar.page().keyboard.press("Escape");
      if (await direct.isVisible()) return direct.click({ timeout: 2_000 });
      if (!(await menu.isVisible())) await bar.locator('[aria-haspopup="menu"]').click({ timeout: 2_000 });
      await item.click({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    return;
  }
  if (!(await menu.isVisible())) await bar.locator('[aria-haspopup="menu"]').click();
  await menu.getByRole("menuitem", { name: main, exact: true }).click();
}

/**
 * EPIC-P43 (Kleinkram-Regel 6): Dateibaum, Browser und Geräte haben keine Randlaschen mehr. In einer Session
 * öffnet der Reiter „Befehle“ den Dateibaum und „Mehr“ Browser und Geräte; ohne Session das globale „Mehr“.
 */
export async function openLayer(page: Page, name: "Dateibaum" | "Browser" | "Geräte"): Promise<void> {
  const bar = page.locator(".subtabs-wrap").first();
  // Browser und Geräte gehören immer zu einer Session; der Dateibaum geht auch ohne (globales „Mehr“).
  const inSession = await bar
    .waitFor({ timeout: name === "Dateibaum" ? 3_000 : 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!inSession) return dockGo(page, name);
  if (name === "Dateibaum") {
    await sessionTab(page, "Befehle");
    await page.getByRole("button", { name: "Dateibaum öffnen" }).first().click();
    return;
  }
  await bar.locator('[aria-haspopup="menu"]').click();
  await bar.getByRole("menu", { name: "Weitere Ansichten" }).getByRole("menuitem", { name, exact: true }).click();
}

/**
 * EPIC-P43 T43.5 (Kleinkram-Regel 3): eine Aktion der Session-Karte. Mit Maus steht sie beim Überfahren
 * da, auf Touch erst nach langem Drücken — der Weg über das Menü „⋯“ der Karte geht überall.
 */
export async function cardAction(card: Locator, name: string): Promise<void> {
  const inline = card.locator(".session-card-actions").getByRole("button", { name, exact: true });
  if (await inline.isVisible()) {
    await card.hover();
    return inline.click();
  }
  await card.locator(".row-menu-btn").click();
  await card.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
}

/**
 * Klick auf eine Taste, die ihr eigenes Fenster schließt („In die App zurück“). Unter Last schließt das
 * Fenster, bevor Playwright den Klick quittiert („Target closed“) — das zählt nur, wenn es wirklich zu ist.
 */
export async function clickClosing(page: Page, target: Locator): Promise<void> {
  const closed = page.waitForEvent("close");
  await target.click().catch((err: unknown) => {
    if (!page.isClosed()) throw err;
  });
  await closed;
}

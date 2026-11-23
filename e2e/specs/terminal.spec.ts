import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/**
 * ADR-0087: Terminal-Tab — Allowlist-Ziele, leere Config erklärt sich,
 * Verbinden startet eine lokale Shell über den Hub.
 */

test.use({
  hubOptions: {
    // Zwei Ziele: die Auswahl im Tab muss das Ziel des Tickets bestimmen —
    // mit nur einem Eintrag prüft man das nicht (Nutzerreport 18.11.2026).
    terminals: [
      { id: "hub", label: "Hub-Host", local: true },
      { id: "zweit", label: "Zweites Ziel", local: true },
    ],
  },
});

async function openTerminal(page: Page): Promise<void> {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  await page.getByRole("button", { name: /Mehr/ }).first().click();
  await page.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name: "Terminal" }).click();
  await expect(page).toHaveURL(/#\/terminal$/);
}

test.describe("Terminal-Tab (ADR-0087)", () => {
  test("Dock „Mehr“ → „Terminal“ erreicht die Seite mit Ziel", async ({ app }) => {
    await openTerminal(app);
    await expect(app.getByTestId("terminal-page")).toBeVisible();
    await expect(app.getByLabel("Terminal-Ziel")).toContainText("Hub-Host");
    await expect(app.getByRole("button", { name: "Verbinden" })).toBeVisible();
  });

  test("Verbinden öffnet eine lokale Shell (script/bash)", async ({ app }) => {
    test.setTimeout(40_000);
    await openTerminal(app);
    await app.getByRole("button", { name: "Verbinden" }).click();
    await expect(app.getByText("verbunden")).toBeVisible({ timeout: 15_000 });
    await expect(app.getByTestId("terminal-xterm")).toBeVisible();
  });

  test("gewähltes Ziel bekommt das Ticket (Auswahl wirkt)", async ({ app }) => {
    test.setTimeout(40_000);
    await openTerminal(app);
    const ticketPosts: string[] = [];
    app.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/ticket")) ticketPosts.push(req.url());
    });
    await app.getByLabel("Terminal-Ziel").selectOption("zweit");
    await app.getByRole("button", { name: "Verbinden" }).click();
    await expect(app.getByText("verbunden")).toBeVisible({ timeout: 15_000 });
    expect(ticketPosts).toHaveLength(1);
    expect(ticketPosts[0]).toContain("/api/terminals/zweit/ticket");
  });

  test("Tab verlassen hält die Sitzung, Zurückkommen hängt wieder an", async ({ app }) => {
    // Nutzerwunsch 20.11.2026: die letzte Sitzung bleibt offen, auch wenn man rausspringt.
    test.setTimeout(60_000);
    await openTerminal(app);
    await app.getByRole("button", { name: "Verbinden" }).click();
    await expect(app.getByText("verbunden")).toBeVisible({ timeout: 15_000 });
    await app.getByTestId("terminal-xterm").click();
    await app.keyboard.type("export HALTE=$((40+2)); echo marke-$HALTE\n");
    await expect(app.getByTestId("terminal-xterm")).toContainText("marke-42", { timeout: 15_000 });

    await app.evaluate(() => { location.hash = "#/"; });
    await expect(app.getByTestId("terminal-page")).toHaveCount(0);
    await app.evaluate(() => { location.hash = "#/terminal"; });

    await expect(app.getByText("verbunden")).toBeVisible({ timeout: 15_000 });
    await expect(app.getByTestId("terminal-xterm")).toContainText("marke-42");
    await app.getByTestId("terminal-xterm").click();
    await app.keyboard.type("echo noch-$HALTE\n");
    await expect(app.getByTestId("terminal-xterm")).toContainText("noch-42", { timeout: 15_000 });

    await app.getByRole("button", { name: "Beenden" }).click();
    await expect(app.getByText("getrennt")).toBeVisible();
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.terminal.last"))).toBeNull();
  });
});

test.describe("Terminal ohne Config", () => {
  test.use({ hubOptions: { terminalAutodetect: false } });

  test("leere Allowlist erklärt die Config", async ({ app }) => {
    await openTerminal(app);
    await expect(app.getByTestId("terminal-empty")).toContainText("terminals");
  });
});

test.describe("Auto-Erkennung (ADR-0087 Nachtrag 2026-11-23)", () => {
  test.use({ hubOptions: {} });

  test("ohne Config werden installierte Shells des Hub-Hosts angeboten", async ({ app }) => {
    await openTerminal(app);
    // Linux-E2E-Umgebung hat immer bash; die Fläche erklärt sich nicht mehr.
    await expect(app.getByLabel("Terminal-Ziel")).toContainText("bash");
    await expect(app.getByTestId("terminal-empty")).toHaveCount(0);
  });
});

test.describe("Zwischenablage im Terminal (Nutzerreport 23.11.2026)", () => {
  test("Ctrl+V fügt ein und Enter führt aus", async ({ app }) => {
    test.setTimeout(40_000);
    await openTerminal(app);
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await app.evaluate(() => navigator.clipboard.writeText("echo paste-42"));
    await app.getByRole("button", { name: "Verbinden" }).click();
    await expect(app.getByText("verbunden")).toBeVisible({ timeout: 15_000 });
    await app.getByTestId("terminal-xterm").click();
    await app.keyboard.press("Control+v");
    await app.keyboard.press("Enter");
    await expect(app.getByTestId("terminal-xterm")).toContainText("paste-42", { timeout: 15_000 });
  });
});

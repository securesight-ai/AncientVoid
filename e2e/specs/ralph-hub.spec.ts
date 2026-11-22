import { expect, test } from "../support/fixtures.ts";
import { repoRoot } from "../support/hub.ts";

/**
 * EPIC-P54 (ADR-0110): Ralph im Hub — die Schleife treibt jede promptbare CLI.
 * Am Test-Hub steht der Stand-in `e2e/support/ralph-agent.mjs` für den echten
 * Agenten; bewiesen wird der Weg durchs Start-Formular, die loop.*-Events und
 * das Menschen-Gate `wartend`. Echter Grind mit echtem LLM: T54.6 → P000.
 */
const agent = `node ${repoRoot}/e2e/support/ralph-agent.mjs {prompt}`;

test.describe("Ralph im Hub (EPIC-P54)", () => {
  test.use({ hubOptions: { ralphHub: true } });

  test("Ralph-Loop im Start-Formular wählen, Grind läuft bis zum Menschen-Gate wartend (AC-P54-1)", async ({ app, hub }) => {
    // Zwei Aufgaben ins Projekt legen — die Saat des Loops liest sie aus epics/ (AC-P54-2).
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(`${hub.alpha}/epics`, { recursive: true });
    writeFileSync(`${hub.alpha}/epics/EPIC-T1-e2e.md`, "# EPIC-T1\n\n- [ ] **T1.1** Erste Aufgabe\n- [ ] **T1.2** Zweite Aufgabe\n");
    await app.getByRole("button", { name: "Neue Session" }).click();
    const loop = app.getByLabel("Loop", { exact: true });
    await loop.selectOption("ralph-hub");
    await app.getByLabel("Ziel (Epic oder Bug)").fill("EPIC-T1");
    await app.getByLabel(/Agenten-Befehl/).fill(agent);
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//, { timeout: 15_000 });

    const id = app.url().split("/sessions/")[1]!.split(/[?#]/)[0]!;
    // Der Grind: pro Turn eine Aufgabe, dann der prüfende Turn → wartend (Level 1).
    await expect
      .poll(async () => (await hub.events(id)).filter((e) => e.payload?.kind === "loop.notify" && e.payload?.status === "wartend").length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const events = await hub.events(id);
    const progress = events.filter((e) => e.payload?.kind === "loop.progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.payload).toMatchObject({ done: 2, total: 2, status: "wartend" });
    // K5: kompakte Events, Turn-Ausgabe nur als Blob-Referenz.
    for (const e of events.filter((e) => String(e.payload?.loop) === "ralph-hub")) {
      expect(JSON.stringify(e).length).toBeLessThan(4 * 1024);
    }
    expect(events.some((e) => e.payload?.kind === "loop.turn" && typeof e.payload?.outputBlob === "string")).toBe(true);
    // Sichtbar im Chat: das Gate wartet auf Abnahme.
    await expect(app.getByText(/wartet auf Abnahme/).first()).toBeVisible({ timeout: 10_000 });
  });

  test("ohne Agenten-Befehl kein Start — Pflichtfeld blockiert laut (AC-P54-3)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("ralph-hub");
    await app.getByLabel("Ziel (Epic oder Bug)").fill("EPIC-T1");
    const start = app.getByRole("button", { name: "Starten" });
    await expect(start).toBeDisabled();
    await expect(app.locator(".loop-block")).toContainText(/fehlt/);
    await app.getByLabel(/Agenten-Befehl/).fill(agent);
    await expect(start).toBeEnabled();
  });
});

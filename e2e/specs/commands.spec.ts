import type { Page } from "@playwright/test";
import { test, expect, openQuiet, seeAll } from "../support/fixtures.ts";

async function say(app: Page, text: string): Promise<void> {
  if (!(await app.locator(".command-sheet").isVisible())) await app.keyboard.press("Control+k");
  await app.getByLabel("Auftrag", { exact: true }).fill(text);
  await app.getByRole("button", { name: "Planen" }).click();
}

test.describe("Aufträge in Worten (T9.4, AC-P9-3)", () => {
  test("„Zeig wartende Sessions“ filtert sofort, ohne Rückfrage", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await hub.createSession({ adapter: "opencode", prompt: "Anderes" });
    // EPIC-P43 T43.3: die fertige Session steht unter „Ruhig“, das zu ist, solange jemand dran ist.
    await hub.until(async () => (await hub.sessions()).some((s) => s.status === "idle"), "opencode fertig");
    await seeAll(app, hub);
    await openQuiet(app);
    await expect(app.locator(".session-card")).toHaveCount(2);
    await app.getByLabel("Auftrag in Worten (Strg+K)").click();
    await say(app, "Zeig wartende Sessions");
    await expect(app.locator(".command-sheet")).toHaveCount(0);
    await expect(app.locator(".session-card")).toHaveCount(1);
    await expect(app.getByRole("button", { name: "nur wartende ✕" })).toBeVisible();
    await app.getByRole("button", { name: "nur wartende ✕" }).click();
    await expect(app.locator(".session-card")).toHaveCount(2);
  });

  test("„Starte opencode in alpha: …“ zeigt Ziel und Risiko, startet erst nach „Ausführen“, ohne Pfadeingabe", async ({ app, hub }) => {
    await app.keyboard.press("Control+k");
    await say(app, "Starte opencode in alpha: Lies die README");
    const step = app.locator(".command-step");
    await expect(step).toContainText("Session starten — opencode · alpha");
    await expect(step.locator(".command-risk")).toHaveText("ändert");
    expect(await hub.sessions()).toHaveLength(0);
    await app.getByRole("button", { name: "Ausführen" }).click();
    await expect(app.locator(".command-result.ok")).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Lies die README/)).toBeVisible({ timeout: 15_000 });
    expect(await hub.sessions()).toHaveLength(1);
  });

  test("„Antworte dort …“ im offenen Chat; „schreibe 'stopp' in die Nachricht“ stoppt nichts und lässt sich rückgängig machen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    await say(app, "Antworte dort: bitte mit Tests");
    await expect(app.locator(".command-step")).toContainText("Antwort senden");
    await app.getByRole("button", { name: "Ausführen" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: bitte mit Tests/)).toBeVisible({ timeout: 15_000 });
    await app.getByLabel("Schließen").click();

    await say(app, "schreibe 'stopp' in die Nachricht");
    await app.getByRole("button", { name: "Ausführen" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("stopp");
    await expect(app.locator(".session-topbar .status")).not.toHaveAttribute("data-status", "stopped");
    await app.getByRole("button", { name: "Rückgängig" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
  });

  test("gleich benannte Sessions: Rückfrage mit Auswahl statt Raten; Freigaben bleiben ein Tipp", async ({ app, hub }) => {
    const a = await hub.createSession({ adapter: "opencode", prompt: "Parser reparieren" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Parser reparieren" });
    await expect(app.locator(".session-card")).toHaveCount(2);
    await app.keyboard.press("Control+k");
    await say(app, "Stoppe die Session Parser");
    await expect(app.locator(".command-question")).toContainText("Mehrere Sessions passen");
    await app.getByRole("dialog", { name: "Auftrag in Worten" }).getByRole("button", { name: /Parser reparieren.*alpha/ }).click();
    await expect(app.locator(".command-step")).toContainText("Session beenden — Parser reparieren");
    await app.getByRole("button", { name: "Ausführen" }).click();
    await expect.poll(async () => (await hub.api<{ status: string }>(`/api/sessions/${a}`)).body.status).toBe("stopped");

    await say(app, "Gib die Freigabe frei");
    await expect(app.locator(".command-refusal")).toContainText("selbst auf der Karte");
  });

  test("„Such im Code nach parseToken“ öffnet den Code-Reiter mit Treffern; ohne lokales Modell bleibt Text unverändert", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Code" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await say(app, "Such im Code nach parseToken");
    await expect(app.locator(".code-hit").first()).toContainText("src/auth.ts:4");

    await app.getByRole("button", { name: "Chat", exact: true }).click();
    await app.getByPlaceholder("Antworten…").fill("bitte die tets");
    await say(app, "Korrigiere den Text");
    await app.getByRole("button", { name: "Ausführen" }).click();
    await expect(app.locator(".command-sheet .reply-error")).toContainText("Kein lokales Modell");
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("bitte die tets");
  });
});

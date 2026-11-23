import { test, expect } from "../support/fixtures.ts";

/**
 * ADR-0042 / EPIC-P25: Slash-Commands im Composer. Vorschläge kommen nur
 * aus der Deklaration des Adapters (scope-gefiltert), ein ungelisteter
 * Slash wird sichtbar als normaler Text gemeldet — nie still als Command
 * fehlgeleitet (AC-P25-1/2).
 */
test.describe("Slash-Commands (ADR-0042, EPIC-P25)", () => {
  test("Antwortfeld: Vorschlag übernehmen, /compact läuft und erscheint in der Timeline @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.fill("/c");
    await expect(app.getByRole("listbox", { name: "Commands" })).toBeVisible();
    // scope steer: /new und /tokens (start-only) tauchen nicht auf.
    await expect(app.getByRole("option", { name: "/compact" })).toBeVisible();
    await expect(app.getByRole("option", { name: "/new" })).toHaveCount(0);
    await app.getByRole("option", { name: "/compact" }).click();
    await expect(field).toHaveValue("/compact ");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".event.assistant").last()).toContainText("Command /compact ausgeführt", { timeout: 20_000 });
  });

  test("ungelisteter Slash bekommt den sichtbaren Hinweis, senden geht als Text @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.fill("/foobar jetzt");
    await expect(app.locator(".composer-notice")).toContainText("nicht als Command gemeldet");
    await app.getByRole("button", { name: "Senden" }).click();
    // Der Stand-in beantwortet ihn wie jeden Prompt — sichtbar, nicht still.
    await expect(app.locator(".event.assistant").last()).toContainText("Antwort auf: /foobar jetzt", { timeout: 20_000 });
  });

  test("Nicht unterstütztes /compact wird sichtbar abgelehnt @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Hallo" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "erster Zug beendet");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("/compact");
    await expect(app.locator(".composer-notice")).toHaveText("/compact ist hier nicht verfügbar.");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".reply-error")).toContainText("/compact wird nicht unterstützt");
    expect((await hub.events(id)).filter((event) => event.type === "assistant")).toHaveLength(1);
  });

  test("Adapter ohne Deklaration (opencode) meldet ehrlich: keine /Commands @desktop", async ({ app, hub: _hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const field = app.getByPlaceholder("Refactore den Auth-Flow…");
    await field.fill("/clear jetzt");
    await expect(app.locator(".composer-notice")).toContainText("meldet keine /Commands");
  });
});

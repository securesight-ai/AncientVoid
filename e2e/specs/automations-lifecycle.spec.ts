import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";
import type { AutomationDefinition, AutomationHistoryEntry } from "@ancientvoid/contracts";

async function create(hub: TestHub, label: string) {
  const host = await hub.api<{ hostId: string }>("/api/fleet/hello");
  const promptText = "Ein überprüfbarer Auftrag";
  const definition = { id: randomUUID(), label, generation: 1, enabled: false, hostId: host.body.hostId,
    schedule: { kind: "preset", preset: "daily", localTime: "09:00", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "dummy", workdir: "worktree", project: hub.alpha, promptBlobSha256: createHash("sha256").update(promptText).digest("hex") },
    grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: new Date().toISOString(),
  };
  const res = await hub.api<AutomationDefinition>("/api/automations", { body: { definition, promptText } });
  expect(res.status).toBe(201); return res.body;
}

async function outcome(hub: TestHub, id: string) {
  return (await hub.api<{ history: AutomationHistoryEntry[] }>(`/api/automations/${id}/history`)).body.history[0];
}

test("P41: bestehende Automation bearbeiten, freigeben, Ergebnis und Folgeoperation sehen", async ({ app, hub }) => {
  const definition = await create(hub, "Bearbeitbarer Plan");
  await app.goto(`${hub.origin}/#/automationen`);
  await app.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const form = app.getByTestId("automation-form");
  await form.getByLabel("Label", { exact: true }).fill("Nachbearbeitet");
  await form.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(form).toHaveCount(0);
  const list = await hub.api<{ automations: { definition: AutomationDefinition }[] }>("/api/automations");
  const changed = list.body.automations.find(a => a.definition.id === definition.id)!.definition;
  expect(changed.generation).toBe(2); expect(changed.enabled).toBe(false);
  expect(changed.target).toEqual(definition.target);
  await app.getByRole("button", { name: "Aktivieren", exact: true }).click();
  await expect(app.getByTestId("automation-state")).toHaveText("aktiv");
  await app.getByRole("button", { name: "Jetzt starten", exact: true }).click();
  await expect.poll(() => outcome(hub, definition.id)).toMatchObject({ state: "settled", outcome: "succeeded" });
  await expect(app.getByTestId("automation-history")).toContainText("erfolgt");
  const first = (await outcome(hub, definition.id))!.operationId;
  await app.getByRole("button", { name: "Jetzt starten", exact: true }).click();
  await expect.poll(async () => (await outcome(hub, definition.id))?.operationId).not.toBe(first);
});

test("P41: Swarm-Vorlage in der PWA wählen und zum tatsächlichen Swarm springen (ADR-0123)", async ({ app, hub }) => {
  const source = await hub.api<{ id: string }>("/api/swarms", { body: { title: "PWA-Vorlage", goal: "Eine Aufgabe", project: hub.alpha,
    frame: { adapters: ["dummy"], coordinatorAdapter: null, maxTasks: 1, maxParallel: 1, maxDispatchesPerTask: 1 },
    plan: { tasks: [{ id: "T1", title: "Prüfen", prompt: "Ergebnis", adapter: "dummy" }] } } });
  expect(source.status).toBe(201);
  await app.goto(`${hub.origin}/#/automationen`);
  await app.getByRole("button", { name: "Neue Automation", exact: true }).click();
  const form = app.getByTestId("automation-form");
  await form.getByLabel("Label", { exact: true }).fill("Swarm-Automation");
  await form.getByRole("combobox", { name: "Automationart", exact: true }).selectOption("swarm");
  await form.getByRole("combobox", { name: "Swarm-Vorlage", exact: true }).selectOption(source.body.id);
  await form.getByRole("button", { name: "Anlegen", exact: true }).click();
  await expect(form).toHaveCount(0);
  await app.getByRole("button", { name: "Jetzt starten", exact: true }).click();
  await expect(app.getByTestId("automation-history")).toContainText("erfolgt");
  const link = app.getByTestId("automation-history").getByRole("link", { name: "Swarm ↗", exact: true });
  await expect(link).toHaveAttribute("href", /swarm=/);
  await link.click();
  await expect(app.getByTestId("swarm-detail")).toBeVisible();
});

test("P41: ein Fehler beim Verlauf bleibt als Fehler sichtbar", async ({ app, hub }) => {
  await create(hub, "Verlaufsfehler");
  await app.route("**/api/automations/*/history", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Verlauf nicht lesbar" }) }));
  await app.goto(`${hub.origin}/#/automationen`);
  await app.getByText("Verlaufsfehler", { exact: true }).click();
  await expect(app.getByTestId("automation-detail").getByRole("alert")).toContainText("Verlauf nicht lesbar");
  await expect(app.getByText("Noch keine Läufe.", { exact: true })).toHaveCount(0);
});

test("P41: schlägt der Verlaufsabruf nach einem erfolgreichen fehl, wird der Altbestand datiert als veraltet gezeigt", async ({ app, hub }) => {
  await create(hub, "Veralteter Verlauf");
  await app.goto(`${hub.origin}/#/automationen`);
  await app.getByText("Veralteter Verlauf", { exact: true }).click();
  await expect(app.getByText("Noch keine Läufe.", { exact: true })).toBeVisible();
  await app.route("**/api/automations/*/history", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Verlauf nicht lesbar" }) }));
  await app.reload();
  await app.getByText("Veralteter Verlauf", { exact: true }).click();
  await expect(app.getByTestId("automation-detail").getByRole("alert")).toContainText("Verlauf nicht lesbar");
  await expect(app.getByTestId("automation-history-asof")).toContainText("aktueller Abruf fehlgeschlagen");
});

test.describe("P41 Offline-Projektion", () => {
  test.use({ serviceWorkers: "allow" });
  test("Reload im Flugmodus zeigt den datierten Plan und sperrt alle Mutationen", async ({ app, hub }) => {
    await create(hub, "Plan im Flugmodus");
    await app.goto(`${hub.origin}/#/automationen`);
    await expect(app.getByText("Plan im Flugmodus", { exact: true })).toBeVisible();
    await app.getByText("Plan im Flugmodus", { exact: true }).click();
    await expect(app.getByText("Noch keine Läufe.", { exact: true })).toBeVisible(); // Verlauf online abgerufen und gecacht
    await app.evaluate(async () => { await navigator.serviceWorker.ready; });
    await app.reload();
    await expect(app.getByText("Plan im Flugmodus", { exact: true })).toBeVisible();
    const before = Date.now();
    await app.context().setOffline(true);
    await app.reload();
    await expect(app.getByText("Plan im Flugmodus", { exact: true })).toBeVisible();
    await expect(app.getByTestId("automations-offline")).toContainText("Offline");
    const at = await app.getByTestId("automations-asof").getAttribute("datetime");
    expect(Date.parse(at!)).toBeLessThanOrEqual(before);
    await app.getByText("Plan im Flugmodus", { exact: true }).click();
    const historyAt = await app.getByTestId("automation-history-asof").locator("time").getAttribute("datetime");
    expect(Date.parse(historyAt!)).toBeLessThanOrEqual(before); // auch der Verlauf ist datiert, nicht als frisch ausgegeben
    for (const name of ["Neue Automation", "Jetzt starten", "Aktivieren", "Bearbeiten"]) {
      await expect(app.getByRole("button", { name, exact: true })).toBeDisabled();
    }
  });
});

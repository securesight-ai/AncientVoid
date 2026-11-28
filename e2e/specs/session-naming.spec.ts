import type { SessionRecord } from "@ancientvoid/contracts";
import { test, expect } from "../support/fixtures.ts";

test("P90 zeigt den Ursprung nach dem Umbenennen und hält ihn bei der Übergabe fest", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "dummy", prompt: "Ursprünglicher Plan für die Übersicht" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await expect(app.locator(".session-origin")).toHaveText("Ursprung · Ursprünglicher Plan für die Übersicht");
  await app.getByLabel("Weitere Aktionen").click();
  await app.getByRole("button", { name: "Umbenennen", exact: true }).click();
  await app.getByLabel("Neuer Titel").fill("Aktueller Fokus");
  await app.locator(".rename-form").getByRole("button").click();
  await expect(app.locator(".session-top-title")).toHaveText("Aktueller Fokus");
  await expect(app.locator(".session-origin")).toContainText("Ursprünglicher Plan");
  const handover = await hub.api<SessionRecord>(`/api/sessions/${id}/handover`, { body: { adapter: "codex", prompt: "Cache-Invaliderung überarbeiten" } });
  expect(handover.status, JSON.stringify(handover.body)).toBe(201);
  await app.goto(`${hub.origin}/#/sessions/${handover.body.id}`);
  await expect(app.locator(".session-top-title")).toHaveText("Cache-Invaliderung überarbeiten");
  await expect(app.locator(".session-origin")).toContainText("Ursprünglicher Plan");
  await expect(app.locator(".session-handover-mark")).toHaveAttribute("title", "Übergabe");
  expect((await hub.api(`/api/sessions/${handover.body.id}/stop`, { body: {} })).status).toBe(200);
  await hub.restart();
  const restored = await hub.api<SessionRecord>(`/api/sessions/${handover.body.id}`);
  expect(restored.body).toMatchObject({
    originIntent: "Ursprünglicher Plan für die Übersicht",
    focus: { text: "Cache-Invaliderung überarbeiten", source: "handoff" },
    handoverFrom: id,
  });
});

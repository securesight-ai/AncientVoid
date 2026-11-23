import { test, expect } from "../support/fixtures.ts";

/**
 * Nutzerfund 23.11.2026 (PC): „löschen von gequeuten Requests und Editieren
 * funktioniert bei mir nicht“. Die Zeile ist die einzige Stelle, wo eine
 * vorgemerkte Meldung korrigiert werden kann — sie muss klickbar sein und der
 * Hub muss führen. Dazu: eine abgelehnte Aktion nennt den Grund und bietet
 * „Erneut versuchen“, statt ratlos daliegend die Nachricht zu verlieren.
 */
interface QueueItem {
  id: string;
  text: string;
  position?: number;
}

test.describe("Warteschlange am PC bearbeiten", () => {
  test("Text ändern, umhängen, streichen — der Hub führt, was der PC klickt @desktop @tablet", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("zweite Meldung");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-item")).toHaveCount(1);

    // ✎ Text nachträglich ändern.
    await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 bearbeiten/ }).click();
    await expect(app.locator(".queue-edit-input")).toBeVisible();
    await app.locator(".queue-edit-input").fill("verbesserte Meldung");
    await app.getByTestId("queue-edit-save").click();
    await expect(app.locator(".queue-item")).toContainText("verbesserte Meldung");
    await hub.until(async () => ((await hub.api<QueueItem[]>(`/api/sessions/${id}/queue`)).body)[0]?.text === "verbesserte Meldung", "Text beim Hub geändert");

    // zweite Meldung dazwischen, dann umhängen (↑).
    await app.getByPlaceholder("Antworten…").fill("dritte Meldung");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-item")).toHaveCount(2);
    await app.getByRole("button", { name: /Vorgemerkte Nachricht 2 als nächstes senden/ }).click();
    await hub.until(async () => {
      const liste = (await hub.api<QueueItem[]>(`/api/sessions/${id}/queue`)).body;
      return liste[0]?.text === "dritte Meldung" && typeof liste[0]?.position === "number";
    }, "dritte Meldung steht beim Hub vorn");

    // ✕ streichen — und zwar wirklich beim Hub, nicht nur im Bildschirm.
    await app.getByRole("button", { name: /streichen/ }).first().click();
    await hub.until(async () => (await hub.api<QueueItem[]>(`/api/sessions/${id}/queue`)).body.length === 1, "eine Meldung gestrichen");
    await app.reload();
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await expect(app.locator(".queue-item")).toHaveCount(1);
    await expect(app.locator(".queue-item")).toContainText("verbesserte Meldung");
  });

  test("eine abgelehnte Aktion nennt den Grund und bietet Erneut versuchen @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("spätere Meldung");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-item")).toHaveCount(1);

    // Zug beenden, dann „jetzt senden“ in einer Sitzung ohne laufenden Zug.
    await hub.api(`/api/sessions/${id}/stop`, { method: "POST", body: {} });
    await hub.until(async () => (await hub.sessions()).find((s) => s.id === id)?.status === "stopped", "Sitzung gestoppt");
    await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 jetzt senden/ }).click();
    await expect(app.locator(".queue-error")).toBeVisible();
    await expect(app.locator(".queue-error")).toContainText("bleibt vorgemerkt");
    await expect(app.getByTestId("queue-retry")).toBeVisible();

    // Die Nachricht ist nicht verloren: sie steht weiter in der Liste und lässt sich streichen.
    await expect(app.locator(".queue-item")).toHaveCount(1);
    await app.getByRole("button", { name: /streichen/ }).click();
    await expect(app.locator(".queue-item")).toHaveCount(0);
    await hub.until(async () => (await hub.api<QueueItem[]>(`/api/sessions/${id}/queue`)).body.length === 0, "auch beim Hub gestrichen");
  });
});

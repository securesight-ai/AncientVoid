import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * BUG-0046: liefert der Anbieter den Denk-Text nicht (leerer Block mit Signatur),
 * zeigt der Verlauf eine ruhige Zeile statt eines aufklappbaren leeren Blocks.
 */
test("BUG-0046: ein Denk-Block ohne Text ist eine ruhige Zeile ohne leeren Inhalt", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "claude", prompt: "DENKEN bitte" });
  await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.summary.length > 0), "Antwort", 20_000);
  await app.goto(`${hub.origin}/#/sessions/${id}`);

  // Chat: nur Gelesenes — der leere Denk-Block fehlt dort.
  await app.getByRole("button", { name: "Chat" }).click();
  await expect(app.locator(".event.assistant").first()).toBeVisible();
  await expect(app.locator(".event.thinking")).toHaveCount(0);

  // Verlauf: eine Zeile mit der Erklärung, nichts zum Aufklappen oder Kopieren.
  await sessionTab(app, "Verlauf");
  await app.getByRole("button", { name: "Debuggen" }).click();
  const row = app.getByTestId("withheld");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Der Anbieter liefert keinen Denktext");
  await row.click();
  await expect(row.getByRole("button", { name: "Kopieren" })).toHaveCount(0);
  await expect(row.locator("pre")).toHaveCount(0);
  await expect(row).not.toContainText('"text": ""');
});

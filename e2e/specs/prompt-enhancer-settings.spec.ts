import { test, expect } from "../support/fixtures.ts";

test("P90 speichert Pi als bevorzugte Engine und aktiviert den Repo-Scan", async ({ app, hub }) => {
  await app.goto(`${hub.origin}/#/einstellungen`);
  const section = app.getByTestId("settings-enhancer");
  await section.getByLabel("Bevorzugte Engine").selectOption("pi");
  await section.getByLabel("Pi-Modell-ID (optional)").fill("local/qwen");
  await section.getByRole("switch", { name: "Repo-Scan für die Vorschau" }).check();
  await section.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Einstellung gespeichert.");
  await app.goto(`${hub.origin}/`);
  await app.goto(`${hub.origin}/#/einstellungen`);
  await expect(section.getByLabel("Bevorzugte Engine")).toHaveValue("pi");
  await expect(section.getByLabel("Pi-Modell-ID (optional)")).toHaveValue("local/qwen");
  await expect(section.getByRole("switch", { name: "Repo-Scan für die Vorschau" })).toBeChecked();
});

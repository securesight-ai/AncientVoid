// EPIC-P61 T61.10 (Adapter, §3.4): Umschalter → migrierte Stellen Englisch,
// Persistenz über Reload, offline gleich — Kataloge liegen im Bundle (ADR-0101).
// Deutsch ist im Fixture gepinnt; dieses Spec schreibt die Sprache selbst.
// Volle Reloads brauchen Navigation zum Ziel (die App startet auf der Übersicht).
import { test, expect } from "../support/fixtures.ts";

test("Sprache: Umschalten auf Englisch, Persistenz über Reload, offline gleich", async ({ app, hub }, info) => {
  test.setTimeout(90_000);
  await app.goto(`${hub.origin}/#/einstellungen`);
  const appearance = app.locator(".settings-section").filter({ has: app.getByRole("heading", { name: /^(Darstellung|Appearance)$/ }) });
  await expect(appearance.getByRole("group", { name: "Sprache", exact: true }).getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
  await appearance.getByRole("group", { name: "Sprache", exact: true }).getByRole("button", { name: "English" }).click(); // lädt neu (ADR-0101)
  await app.waitForLoadState("load");
  await app.reload(); // Persistenz über Reload — Sprache bleibt Englisch
  await app.goto(`${hub.origin}/#/einstellungen`); // Reload landet auf der Übersicht — neu hineinnavigieren
  await expect(appearance.getByRole("group", { name: "Language", exact: true }).getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Migrierte Bereiche schalten mit: Dock (Mobile-Leiste) über das Mehr-Sheet.
  await app.getByRole("navigation", { name: "Navigation" }).getByRole("button", { name: "More" }).click();
  await expect(app.getByRole("button", { name: "Settings" })).toBeVisible();
  await app.screenshot({ path: info.outputPath("p61-settings-english.png") });
  // Offline ohne Reload (der Runner blocket Service Workers): bestehender
  // Zustand bleibt ohne Netz korrekt — Kataloge sind im Bundle, AC-P61-4.
  await app.context().setOffline(true);
  await expect(appearance.getByRole("group", { name: "Language", exact: true }).getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
  await app.getByRole("button", { name: "Settings" }).click(); // im Mehr-Sheet geöffnet bleiben
  await expect(appearance.getByRole("group", { name: "Language", exact: true }).getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
  await app.context().setOffline(false);
});

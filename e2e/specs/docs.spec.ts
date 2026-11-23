import { test, expect, sessionTab } from "../support/fixtures.ts";

/** Suchansicht: alle Dokumente strukturiert (nach Verzeichnis gruppiert),
 * geöffnet als gerendertes Markdown — ohne Code-Ansicht (kein Gutter,
 * kein Syntax-Highlight). */
test.describe("Dokumentübersicht in der Suchansicht", () => {
  test("listet alle Dokumente gruppiert, öffnet gerendert ohne Code-Ansicht @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", project: hub.alpha });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Suche");

    // Struktur: Gruppenkopf Stammverzeichnis, README mit Titel „Alpha“,
    // Skill-Datei in ihrem Ordner (ohne #Überschrift → Dateiname).
    await expect(app.locator(".doc-group-dir").filter({ hasText: "Stammverzeichnis" })).toBeVisible();
    await expect(app.locator(".doc-item").filter({ hasText: "Alpha" })).toBeVisible();
    await expect(app.locator(".doc-item").filter({ hasText: "SKILL.md" })).toBeVisible();
    await expect(app.locator(".doc-group-dir").filter({ hasText: ".claude/skills/neon" })).toBeVisible();

    // Öffnen: gerenderte Überschrift, kein Code-Viewer.
    await app.locator(".doc-item").filter({ hasText: "Alpha" }).click();
    await expect(app.locator(".file-viewer").getByRole("heading", { name: "Alpha" })).toBeVisible();
    await expect(app.locator(".file-viewer .markdown").getByText("Das Handbuch beschreibt den Handoff zwischen PC und Handy.")).toBeVisible();
    await expect(app.locator(".file-gutter, .file-code, .file-code-grid")).toHaveCount(0);

    await app.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(app.locator(".file-viewer")).toHaveCount(0);
  });
});

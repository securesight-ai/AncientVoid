import { fileURLToPath } from "node:url";
import { test, expect, dockGo } from "../support/fixtures.ts";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test.describe("Anhänge (T7.10)", () => {
  test("Bild und DOCX anhängen: gelesen (OCR/Office), mitgeschickt, im Chat zu öffnen", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByLabel("Dateien anhängen").setInputFiles([fixture("bild-mit-text.png"), fixture("dokument.docx")]);
    const chips = app.locator(".composer .attachment-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: "bild-mit-text.png" })).toContainText(/Zeichen · OCR/, { timeout: 20_000 });
    await expect(chips.filter({ hasText: "dokument.docx" })).toContainText(/Zeichen · Office/);
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Was steht in den Anhängen?");
    await app.getByRole("button", { name: "Starten" }).click();
    await app.getByRole("button", { name: "Chat" }).click();
    // opencode takes the image as a file (-f); the DOCX rides as its text
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Was steht in den Anhängen\? .* Dateien: 1 · Texte: office: Rechnung Nr\. 4711/)).toBeVisible();
    const own = app.locator(".event.own").first();
    // Ein Bild in der Chat-Zeile ist ein Vorschaubild, kein Chip; Dokumente bleiben Chips.
    await expect(own.locator(".attachment-chip")).toHaveCount(1);
    await expect(own.locator(".attachment-thumb")).toHaveCount(1);
    await own.locator(".attachment-thumb").click();
    const licht = app.locator("[data-testid=attachment-lightbox]");
    await expect(licht.locator("img")).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(licht).toHaveCount(0);
    await own.getByRole("button", { name: /dokument\.docx/ }).click();
    const viewer = app.locator("[data-testid=attachment-viewer]");
    await expect(viewer.locator(".attachment-text")).toContainText("4711");
    await app.keyboard.press("Escape");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const prompt = (await hub.events(id)).find((e) => e.payload.kind === "session.prompt")!;
    // K5: the event carries references, never the bytes or the text
    expect(JSON.stringify(prompt.payload).length).toBeLessThan(4096);
    expect(JSON.stringify(prompt.payload)).not.toContain("Betrag");
  });

  test("eine Antwort mit Anhang geht auch ohne Text; ein Anhang lässt sich vor dem Senden entfernen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByLabel("Dateien anhängen").setInputFiles([fixture("dokument.docx"), fixture("bild-mit-text.png")]);
    await app.getByRole("button", { name: "bild-mit-text.png entfernen" }).click();
    await expect(app.locator(".composer .attachment-chip")).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Senden" })).toBeEnabled();
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.getByText(/Texte: office: Rechnung Nr\. 4711/)).toBeVisible();
  });

  test("Gemini-Schlüssel: nur setzbar, nie auslesbar; entfernbar", async ({ app, hub }) => {
    await dockGo(app, "Einstellungen");
    const card = app.getByTestId("gemini-settings");
    await expect(card).toContainText("kein Schlüssel");
    await card.getByLabel("API-Schlüssel").fill("AIzaTEST-geheim-1234567890");
    await card.getByRole("button", { name: "Speichern" }).click();
    await expect(card).toContainText("Schlüssel hinterlegt ✓");
    const settings = await hub.api<Record<string, unknown>>("/api/settings");
    expect(JSON.stringify(settings.body)).not.toContain("geheim");
    await card.getByRole("button", { name: "Schlüssel entfernen" }).click();
    await expect(card).toContainText("kein Schlüssel");
  });
});

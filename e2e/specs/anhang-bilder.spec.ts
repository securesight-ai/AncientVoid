import { fileURLToPath } from "node:url";
import { test, expect } from "../support/fixtures.ts";

const beispiel = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * Zwischeninhalte ins Chat-Fenster (Nutzerwunsch 2026-11-23): ein Screenshot aus der
 * Zwischenablage wird mit einem Einfügen zum Anhang der Nachricht, das Bild ist ein
 * anklickbares Vorschaubild, und der Anhang-Link eines Agenten oeffnet dasselbe Vollbild.
 */
test.describe("Bild einfügen, Bild öffnen, Bild-Link", () => {
  test("Screenshot einfügen: Bild an der Nachricht, ein Klick öffnet das Vollbild", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();

    const Beweis = await app.evaluate(async () => {
      const feld = document.querySelector(".composer-input");
      if (!(feld instanceof HTMLTextAreaElement)) return { fehler: "kein Eingabefeld" as const };
      const leinwand = document.createElement("canvas");
      leinwand.width = 320;
      leinwand.height = 200;
      const stift = leinwand.getContext("2d");
      if (!stift) return { fehler: "kein Zeichenkontext" as const };
      stift.fillStyle = "#7dd3fc";
      stift.fillRect(0, 0, 320, 200);
      stift.fillStyle = "#082f49";
      stift.fillRect(24, 24, 140, 70);
      const blob = await new Promise<Blob | null>((loesung) => leinwand.toBlob(loesung, "image/png"));
      if (!blob) return { fehler: "kein PNG" as const };
      const datei = new File([blob], "eingefuegter-screenshot.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(datei);
      feld.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      return { groesse: datei.size };
    });
    expect(Beweis.fehler).toBeUndefined();
    expect(Beweis.groesse ?? 0).toBeGreaterThan(400);

    // Derselbe Weg wie die Büroklammer: hochladen, Hub liest das Bild (OCR), Chip zeigt es.
    const chip = app.locator(".composer .attachment-chip");
    await expect(chip).toHaveCount(1);
    // Der Hub hat das Bild gelesen: der Chip verlaesst den Lesezustand (ohne Text im Bild: „none“).
    await expect(chip.first()).not.toHaveClass(/pending/, { timeout: 25_000 });

    await app.getByRole("button", { name: "Senden" }).click();
    const eigene = app.locator(".event.own").last();
    const vorschau = eigene.locator(".attachment-thumb");
    await expect(vorschau).toHaveCount(1);
    await expect(vorschau.locator("img")).toBeVisible();
    // Echtes Bild, nicht nur ein Platzhalter: die nativen Maße stimmen mit dem Screenshot überein.
    const natur = await vorschau.locator("img").evaluate((bild) => {
      const el = bild as HTMLImageElement;
      return { b: el.naturalWidth, h: el.naturalHeight };
    });
    expect(natur).toEqual({ b: 320, h: 200 });

    await app.screenshot({ path: "data/tmp-debug/anhang-chat.png" });
    await vorschau.click();
    const licht = app.locator("[data-testid=attachment-lightbox]");
    await expect(licht).toBeVisible();
    const bild = await licht.locator("img").boundingBox();
    expect(bild && bild.width > 200 && bild.height > 100).toBe(true);
    await expect(licht).toContainText("eingefuegter-screenshot.png");
    await app.screenshot({ path: "data/tmp-debug/anhang-vollbild.png" });
    await app.keyboard.press("Escape");
    await expect(licht).toHaveCount(0);

    // Der Link, den ein Agent zu einem Bild mitschickt: dasselbe Vollbild, ohne Umweg.
    const vorgemerkt = (await hub.events(id)).filter((e) => e.payload.kind === "session.prompt").pop();
    const anhangId = (vorgemerkt?.payload as { attachments?: Array<{ id: string }> } | undefined)?.attachments?.[0]?.id;
    expect(anhangId).toBeTruthy();

    await app.goto(`${hub.origin}/#/anhang/${anhangId}`);
    await expect(app.locator("[data-testid=attachment-lightbox] img")).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(app.locator("[data-testid=attachment-lightbox]")).toHaveCount(0);

    // Session-interner Link: Vollbild über der Session, Zurück führt in die Session.
    await app.goto(`${hub.origin}/#/sessions/${id}/anhang/${anhangId}`);
    await expect(app.locator("[data-testid=attachment-lightbox]")).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(app.locator("[data-testid=attachment-lightbox]")).toHaveCount(0);
    expect(app.url()).toContain(`#/sessions/${id}`);
  });

  test("ein Dokument bleibt ein Chip und oeffnet die Text-Ansicht (kein Vorschaubild)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByLabel("Dateien anhängen").setInputFiles([beispiel("dokument.docx")]);
    await expect(app.locator(".composer .attachment-chip")).toHaveCount(1);
    await app.getByRole("button", { name: "Senden" }).click();
    const eigene = app.locator(".event.own").last();
    await expect(eigene.locator(".attachment-thumb")).toHaveCount(0);
    await eigene.getByRole("button", { name: /dokument\.docx/ }).click();
    const blatt = app.locator("[data-testid=attachment-viewer]");
    await expect(blatt.locator(".attachment-text")).toContainText("4711", { timeout: 20_000 });
    await blatt.getByRole("button", { name: "✕" }).click();
    await expect(blatt).toHaveCount(0);
  });
});

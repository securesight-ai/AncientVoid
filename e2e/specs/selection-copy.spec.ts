import { test, expect } from "../support/fixtures.ts";

/**
 * Markieren → Auto-Zwischenablage (Nutzer-Anforderung 2026-10-30): Eine
 * fertige Textauswahl im Session-Verlauf landet ohne extra Kopieren-Knopf in
 * der Zwischenablage und quittiert sichtbar. Auswahl darf dabei nie still
 * verloren gehen — der Flash ist der Beleg, dass kopiert wurde.
 */
test.describe("Markieren kopiert in die Zwischenablage", () => {
  test("fertige Auswahl im Verlauf liegt danach im Clipboard @desktop", async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
    const marker = "MARKIER_MICH_12345";
    const id = await hub.createSession({ adapter: "dummy", prompt: marker });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-live")).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(marker).first()).toBeVisible();
    // Clipboard-Schreiben verlangt ein fokussiertes Dokument — wer markiert, hat den Fokus (BUG-0143).
    await app.bringToFront();

    // Längsten Textknoten im Verlauf deterministisch auswählen (kein Echo-
    // Wissen über den Dummy nötig) und das Auswahl-Ende als pointerus
    // auslösen — Rückgabe ist der erwartete Clipboard-Inhalt.
    const selected = await app.evaluate(() => {
      const root = document.querySelector(".tail-scroll");
      if (!root) throw new Error("kein Verlauf im DOM");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let best: Text | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!best || (n.textContent?.length ?? 0) > (best.textContent?.length ?? 0)) best = n as Text;
      }
      if (!best || (best.textContent?.trim().length ?? 0) < 10) throw new Error("kein ausreichend langer Text im Verlauf");
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(best);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.querySelector(".tail-scroll")!.dispatchEvent(new Event("pointerup", { bubbles: true }));
      return best.textContent ?? "";
    });

    await expect(app.locator(".copy-flash")).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText()),
      )
      .toBe(selected);
  });

  test("Auswahl im Eingabefeld wird NICHT auto-kopiert @desktop", async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
    const id = await hub.createSession({ adapter: "dummy", prompt: "hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.fill("EINGABEFELD_NICHT_KOPIEREN");
    await field.selectText();
    await app.evaluate(() => document.querySelector(".tail-scroll")!.dispatchEvent(new Event("pointerup", { bubbles: true })));
    // Kein Flash — die Auswahl liegt außerhalb des Verlaufs.
    await expect(app.locator(".copy-flash")).toHaveCount(0);
  });
});

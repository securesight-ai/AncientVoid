import { test, expect } from "../support/fixtures.ts";

/**
 * ADR-0090: die mehrstufige Zwischenablage. Markieren (bestehender Weg, BUG-0107) legt eine
 * Stufe in die Ablage; das Blatt holt sie zurück und fügt sie ins Eingabefeld ein. Ohne den
 * Fix gab es kein `clipboard-open` — Kopiertes war beim nächsten Kopieren verloren.
 */
test.describe("Mehrstufige Zwischenablage (ADR-0090)", () => {
  test.beforeEach(async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
  });

  test("die Markierung wird eine Stufe, und Einfügen schreibt sie ins Eingabefeld", async ({ app, hub }) => {
    const marker = "ABLAGE_MARKIERUNG_4711";
    const id = await hub.createSession({ adapter: "dummy", prompt: marker });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll").getByText(marker).first()).toBeVisible();
    await app.bringToFront();
    // Erst das Feld, in das spaeter einfuegt werden soll — das Blatt selbst ueberdeckt den
    // Composer, und die Ablage merkt sich das letzte editierbare Feld (paste-target).
    await app.locator(".composer-input").click();

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
      root.dispatchEvent(new Event("pointerup", { bubbles: true }));
      return best.textContent ?? "";
    });
    expect(selected.trim().length).toBeGreaterThan(9);

    await expect(app.getByTestId("clipboard-open")).toBeVisible();
    await app.getByTestId("clipboard-open").click();
    await expect(app.getByTestId("clipboard-shelf")).toBeVisible();
    const first = app.getByTestId("shelf-row").first();
    await expect(first).toContainText(selected.trim().slice(0, 24));
    await expect(app.getByTestId("clipboard-shelf")).toContainText("Markierung");

    // Einfuegen dort, wo das Feld war: das Blatt schliesst, der Text steht im Composer.
    await first.getByTestId("shelf-insert").click();
    await expect(app.getByTestId("clipboard-shelf")).toHaveCount(0);
    // Bei einem textarea zaehlt der WERT, nicht der Textknoten — die Behauptung muss
    // denselben Massstab anlegen wie das Feld.
    await expect(app.locator(".composer-input")).toHaveValue(selected.trim());
  });

  test("entfernen und „alle löschen“ leeren die Ablage sichtbar", async ({ app, hub }) => {
    const marker = "ABLAGE_LOSCHEN_8123";
    const id = await hub.createSession({ adapter: "dummy", prompt: marker });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll").getByText(marker).first()).toBeVisible();
    await app.bringToFront();
    await app.evaluate(() => {
      const root = document.querySelector(".tail-scroll");
      if (!root) return;
      const node = [...root.querySelectorAll("*")].map((el) => el.textContent ?? "").sort((a, b) => b.length - a.length)[0] ?? "";
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let best: Text | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!best || (n.textContent?.length ?? 0) > (best.textContent?.length ?? 0)) best = n as Text;
      if (!best) return;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(best);
      sel?.removeAllRanges();
      sel?.addRange(range);
      root.dispatchEvent(new Event("pointerup", { bubbles: true }));
      void node;
    });

    await app.getByTestId("clipboard-open").click();
    await expect(app.getByTestId("shelf-list")).toBeVisible();
    await app.getByTestId("shelf-row").first().getByTestId("shelf-drop").click();
    await expect(app.getByTestId("shelf-list")).toHaveCount(0);
    await expect(app.getByTestId("clipboard-shelf")).toContainText("Noch nichts abgelegt");
  });
});

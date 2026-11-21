import type { Page } from "@playwright/test";
import { test, expect, sessionTab, dockGo, seeAll } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P43 T43.5: die sieben Kleinkram-Regeln (Design-Review §4.3), je Regel ein Test;
 * Regel 8 (Design-System: Umbruch statt horizontaler Scrollbalken) hat ihren Test hier ebenfalls.
 */
async function idleSession(app: Page, hub: TestHub, prompt: string): Promise<string> {
  const id = await hub.createSession({ adapter: "opencode", prompt });
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await expect(app.locator(".session-live, .tile").first()).toBeVisible();
  return id;
}

/** Sichtbare Tasten einer Fläche: Name, Text, aria-label, Tooltip (der Tooltip-Layer macht aus `title` `data-tip`). */
async function buttons(app: Page) {
  return app.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, [role='button'], summary")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      })
      .map((b) => ({
        html: b.outerHTML.slice(0, 120),
        text: (b.textContent ?? "").trim(),
        label: b.getAttribute("aria-label") ?? "",
        title: b.getAttribute("title") || b.getAttribute("data-tip") || "",
      })),
  );
}

test.describe("Kleinkram-Regeln (EPIC-P43 T43.5)", () => {
  test("Regel 1: Unbekanntes schweigt in der Leiste und steht im Bericht", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title").first()).toBeVisible();
    await expect(app.locator(".run-strip").first()).not.toContainText("unbekannt");
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontextfenster" })).toContainText("keine Meldung");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontingent" })).toContainText(/unbekannt|keine Meldung/);
  });

  test("Regel 2: leere Reiter rücken unter „Mehr“ und sagen in einem Satz, was fehlt — mit einer Aktion", async ({ app, hub }) => {
    await idleSession(app, hub, "Nur lesen");
    const bar = app.locator(".subtabs-wrap").first();
    await expect(bar.getByRole("button", { name: /^Änderungen/ })).toHaveCount(0);
    await sessionTab(app, "Änderungen");
    const empty = app.locator(".ui-empty").first();
    await expect(empty).toContainText("noch nichts geändert");
    await empty.getByRole("button", { name: "Zum Chat" }).click();
    await expect(bar.getByRole("button", { name: /^Chat/ })).toHaveAttribute("aria-current", "page");

    await sessionTab(app, "Datei");
    // „Datei“ öffnet den Dateibaum von selbst; die Fläche zeigt den Editor statt eines Knopfes.
    await expect(app.getByTestId("files-sidebar")).toBeVisible();
    await expect(app.locator(".code-pane").first()).toBeVisible();
  });

  test("Regel 3: Zeilenaktionen beim Überfahren, Fokus oder langem Drücken — und im Menü der Zeile", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Kartenaktion" });
    await seeAll(app, hub);
    const card = app.locator(".session-card").filter({ hasText: "Kartenaktion" });
    const archive = card.locator(".session-card-actions").getByRole("button", { name: "Archivieren", exact: true });
    await expect(card).toHaveCount(1);
    // Touch am Gerät selbst ablesen — das echte Handy läuft als Projekt „phone“, nicht „mobile“.
    const touch = await app.evaluate(() => matchMedia("(hover: none)").matches);
    if (touch) {
      await expect(archive).toBeHidden();
      await card.locator(".session-open").dispatchEvent("contextmenu");
      await expect(archive).toBeVisible();
    } else {
      expect(await archive.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
      await card.hover();
      await expect.poll(() => archive.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    }
    await card.locator(".row-menu-btn").click();
    await expect(card.getByRole("menu").getByRole("menuitem")).toHaveText(["Repo-Graph", "Anheften", "Übergeben…", "Archivieren"]);
    await card.getByRole("menuitem", { name: "Anheften" }).click();
    await expect(app.locator(".section-pins .session-card")).toHaveCount(1);
  });

  test("Regel 4: eine Hauptaktion je Ansicht, gefüllt, oben rechts", async ({ app, hub }) => {
    await idleSession(app, hub, "Lege eine DATEI an");
    await sessionTab(app, "Änderungen");
    const head = app.locator(".changes-head").first();
    await expect(head).toContainText("1 Datei");
    // Die Ansicht selbst — das Antwortfeld darunter mit „Senden“ gehört nicht zu ihr.
    await expect(app.locator(".tail-scroll").first().locator(".ui-button--primary")).toHaveCount(1);
    const primary = head.locator(".ui-button--primary");
    await expect(primary).toHaveText("Ins Projekt übernehmen");
    const [btn, box] = await Promise.all([primary.boundingBox(), head.boundingBox()]);
    expect(btn!.x + btn!.width).toBeGreaterThan(box!.x + box!.width - 4);
    // Der Bericht darunter trägt dieselbe Aktion nicht ein zweites Mal.
    await expect(app.locator(".changes-report").getByRole("button", { name: "Ins Projekt übernehmen" })).toHaveCount(0);
  });

  test("Regel 5: jede Taste trägt Worte oder ein Symbol mit aria-label und Tooltip", async ({ app, hub }) => {
    await idleSession(app, hub, "Tasten prüfen");
    const pages: (() => Promise<void>)[] = [
      async () => sessionTab(app, "Chat"),
      async () => sessionTab(app, "Befehle"),
      async () => {
        await app.goto(`${hub.origin}/#/`);
        await expect(app.locator(".dashboard")).toBeVisible();
      },
      async () => dockGo(app, "Einstellungen"),
    ];
    const bad: string[] = [];
    for (const show of pages) {
      await show();
      await app.waitForTimeout(300);
      for (const b of await buttons(app)) {
        const words = /[\p{L}\p{N}]{2,}/u.test(b.text);
        if (!words && !(b.label && b.title)) bad.push(b.html);
        if (!b.text && !b.label) bad.push(`ohne Namen: ${b.html}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  test("Regel 6: nichts liegt über dem Inhalt", async ({ app, hub }) => {
    await idleSession(app, hub, "Nichts darüber");
    await sessionTab(app, "Chat");
    // Keine Randlaschen; der rechte Rand des Verlaufs gehört dem Verlauf.
    await expect(app.locator(".files-toggle, .browser-toggle, .device-toggle")).toHaveCount(0);
    await expect(app.locator(".tail-scroll")).toContainText("Antwort auf: Nichts darüber");
    const covered = await app.evaluate(async () => {
      const scroll = document.querySelector(".tail-scroll");
      if (!scroll) return ["kein Verlauf"];
      scroll.scrollTop = scroll.scrollHeight;
      await new Promise(requestAnimationFrame);
      const r = scroll.getBoundingClientRect();
      const hits: string[] = [];
      // BUG-0145 reserviert unten Platz für Nyx. Die Reserve ist kein Textinhalt;
      // zusätzlich echte Textrechtecke prüfen, damit kein Knopf dahinter verschwindet.
      const zoom = r.height / (scroll as HTMLElement).offsetHeight;
      const reserve = document.querySelector('.nyx-fab:is([data-bp="phone"], [data-bp="tablet"])')
        ? parseFloat(getComputedStyle(scroll).paddingBottom) * zoom : 0;
      for (let y = r.top + 20; y < Math.min(r.bottom - reserve, innerHeight) - 20; y += 40) {
        const el = document.elementFromPoint(r.right - 6, y);
        if (el && !scroll.contains(el) && !el.contains(scroll)) hits.push(`${el.tagName}.${el.className}`);
      }
      const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const box of range.getClientRects()) {
          if (!box.width || !box.height || box.top < r.top || box.bottom > Math.min(r.bottom, innerHeight)) continue;
          for (const x of [box.left + 1, (box.left + box.right) / 2, box.right - 1]) {
            if (x < r.left || x >= r.right) continue;
            const el = document.elementFromPoint(x, (box.top + box.bottom) / 2);
            if (el && !scroll.contains(el) && !el.contains(scroll)) hits.push(`Text verdeckt: ${el.tagName}.${el.className}`);
          }
        }
      }
      return hits;
    });
    expect(covered).toEqual([]);
  });

  test("Regel 7: Formularelemente sind App-Bausteine, kein Browser-Standard", async ({ app, hub }) => {
    // Das Anlage-Formular trägt Auswahlfelder (Projekt, Adapter) und das Auftragsfeld; die Session das Antwortfeld.
    const check = () => app.evaluate(() => {
      const font = getComputedStyle(document.body).fontFamily;
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("select, input[type=text], input[type=search], input:not([type]), textarea")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.fontFamily !== font) bad.push(`Schrift ${el.tagName}: ${cs.fontFamily}`);
        if (el.tagName === "SELECT" && cs.appearance !== "none") bad.push(`Auswahl im Browser-Stil: ${el.outerHTML.slice(0, 80)}`);
        if (cs.backgroundColor === "rgb(255, 255, 255)" && document.documentElement.dataset.theme !== "light") bad.push(`weißes Feld: ${el.outerHTML.slice(0, 80)}`);
      }
      return bad;
    });
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Adapter")).toBeVisible();
    const offCreate = await check();
    await idleSession(app, hub, "Formulare");
    await sessionTab(app, "Chat");
    await expect(app.locator(".dock-stack textarea, .composer textarea").first()).toBeVisible();
    expect([...offCreate, ...(await check())]).toEqual([]);
  });
  test("Regel 8: Fließtext bricht um — kein horizontaler Scrollbalken; Diff, Code, Tabellen und Zeilenleisten sind ausgenommen", async ({ app, hub }) => {
    const lang = "horizontalliniendickwandsthroughbruchtestwortohnenatuerlicheLeerzeichen";
    const id = await idleSession(app, hub, lang);
    // Ausnahme-Liste = die in docs/design-system.md (Kleinkram-Regel 8) dokumentierten Stellen.
    const scan = () => app.evaluate(() => {
      const exceptions = ".diff-code, .hunk-body-unified, .hunk-split-cell, .md-code, .md-table, .table-scroll, .file-code, .file-text, .file-hex, .code-lines, .code-lines code, .preview-diff, .dock, .files-tabs, .session-strip, .run-strip";
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        if (el.closest(exceptions)) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.scrollWidth - el.clientWidth > 2) bad.push(`${el.tagName}.${el.className}`.slice(0, 90));
      }
      // Regel 8 umgesetzte Stellen: die Umbruch-Container dürfen nicht auf Scroll zurückfallen.
      for (const s of [".filter-bar", ".attach-cmd-row", ".run-meta", ".desktop-cmd"]) {
        for (const el of document.querySelectorAll<HTMLElement>(s)) {
          if (el.getBoundingClientRect().width === 0) continue;
          const ox = getComputedStyle(el).overflowX;
          if (ox === "auto" || ox === "scroll") bad.push(`Umbruch-Container scrollt: ${s}`);
        }
      }
      return [...new Set(bad)];
    });
    // Dashboard: Karten mit dem langen Wort.
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".dashboard")).toBeVisible();
    expect(await scan()).toEqual([]);
    // Session: Chat mit langem Wort im Text und im Antwortfeld.
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByText(new RegExp(lang.slice(0, 20))).first()).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill(lang);
    expect(await scan()).toEqual([]);
    // Befehle: Befehlszeilen.
    await sessionTab(app, "Befehle");
    expect(await scan()).toEqual([]);
    // Einstellungen: von der Übersicht aus (dockGo- Weg wie in Regel 5).
    await app.getByRole("button", { name: "Zur Übersicht" }).click();
    await expect(app.locator(".dashboard")).toBeVisible();
    await dockGo(app, "Einstellungen");
    expect(await scan()).toEqual([]);
  });
});

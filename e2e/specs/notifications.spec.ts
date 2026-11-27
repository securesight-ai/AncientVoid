import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

test.describe("Fehler und Benachrichtigungen (ADR-0015)", () => {
  test("ein erschöpftes Kontingent erscheint als rote Karte oben rechts und im Chat @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    const toast = app.locator(".toast.error").filter({ hasText: "Kontingent erschöpft (5 h)" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("wieder frei ab 2026-09-23 15:00:00");
    const box = (await toast.boundingBox())!;
    // Nach clearDeviceMetricsOverride kennt Playwright die Fläche nicht (T16.6).
    const width = app.viewportSize()?.width ?? (await app.evaluate(() => window.innerWidth));
    expect(box.y).toBeLessThan(160);
    // EPIC-P51 T51.4 (löst T8.5 ab): am PC sitzt die Glocke im Fenstereck —
    // der Toast rückt ihr mit 56 px Vorhalte aus, statt in der Listenspalte zu liegen.
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(width - (box.x + box.width)).toBeGreaterThanOrEqual(48);
    // P50-Invariante nur auf der PC-Fläche: mit sichtbarem Toast scrollt das Fenster
    // nie (mobil drückt der Toast die Seite per T8.6 in den Fluss).
    if ((await app.locator(".split").count()) > 0) {
      expect(await app.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await app.evaluate(() => window.innerHeight + 1));
    }
    await expect(app.locator(".toast.error"), "no second toast for the process exit").toHaveCount(1);

    await toast.locator(".toast-body").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".event.provider-error")).toContainText("opencode: Kontingent erschöpft (5 h)");
  });

  test("nach einem Fehler geht es mit dem nächsten Prompt weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "provider.error"), "provider error");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("Jetzt wieder");
    await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Jetzt wieder/)).toBeVisible();
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle");
  });

  test("ein Serverfehler ohne Ursache wird ehrlich erklärt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte SERVERFEHLER" });
    const toast = app.locator(".toast.error").filter({ hasText: "Serverfehler beim Provider" });
    await expect(toast).toContainText("keine Ursache");
    await expect(toast).toContainText("err_9508ce50");
  });

  test("ein fertiger Zug landet in der Glocke — ohne Meldung über dem Inhalt (T8.6)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.getByRole("button", { name: "Benachrichtigungen (1 neu)" })).toBeVisible();
    await expect(app.locator(".toast")).toHaveCount(0);
    await app.getByRole("button", { name: "Benachrichtigungen (1 neu)" }).click();
    const item = app.locator(".notif-item").filter({ hasText: "alpha · Zug fertig" });
    await expect(item).toBeVisible();
    await expect(app.getByRole("button", { name: "Benachrichtigungen", exact: true })).toBeVisible();
    await item.click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await app.reload();
    await expect(app.getByRole("button", { name: "Benachrichtigungen", exact: true })).toBeVisible();
    await expect(app.locator(".toast")).toHaveCount(0);
  });

  test("Fehler, Rückfragen und Fertiges stehen in eigenen Abschnitten (Nutzerwunsch 2026-11-20)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" }); // Fehler
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" }); // offene Frage, bleibt offen
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" }); // Zug fertig
    await hub.until(
      async () => {
        const { body } = await hub.api<{ items: { kind: string; sessionId: string }[] }>("/api/notifications");
        const kinds = new Set(body.items.map((n) => n.kind));
        return kinds.has("provider.error") && kinds.has("tool.permission_requested") && kinds.has("session.turn_end");
      },
      "Fehler, Frage und fertiger Zug in der Glocke",
      30_000,
    );
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const sections = app.locator(".notif-section");
    // Reihenfolge ist die Wichtigkeit: Fehler, Rückfrage, Fertig, Sonstiges.
    // „Sonstiges“ bleibt hier ungerendert (leerer Abschnitt, keine Warnung/Info
    // im Szenario). Der Abschnittskopf trägt die Anzahl (Muster Übersicht).
    await expect(sections.nth(0).locator(".section-title")).toHaveText(/^Fehler/);
    await expect(sections.nth(0).locator(".notif-item")).toContainText("Kontingent erschöpft");
    await expect(sections.nth(1).locator(".section-title")).toHaveText(/^Rückfrage/);
    await expect(sections.nth(1).locator(".notif-item")).toContainText("Rückfrage");
    await expect(sections.nth(2).locator(".section-title")).toHaveText(/^Fertig/);
    await expect(sections.nth(2).locator(".notif-item")).toContainText("Zug fertig");
    // Der Fehler liegt im DOM über der Frage und der Frage über dem Fertigen.
    const order = await app.evaluate(() =>
      [...document.querySelectorAll(".notif-item")].map((el) => el.textContent ?? ""),
    );
    const at = (text: string) => order.findIndex((t) => t.includes(text));
    expect(at("Kontingent erschöpft")).toBeLessThan(at("Rückfrage"));
    expect(at("Rückfrage")).toBeLessThan(at("Zug fertig"));
  });

  test("die Sound-Taste sitzt direkt links neben ✕ im Panel-Kopf (BUG-0210)", async ({ app }) => {
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const head = app.locator(".notif-panel-head");
    const sound = (await head.locator('[data-testid="notif-sound-toggle"]').boundingBox())!;
    const close = (await head.getByRole("button", { name: "✕" }).boundingBox())!;
    expect(sound, "Sound-Taste vorhanden").toBeTruthy();
    expect(close, "✕ vorhanden").toBeTruthy();
    // Gleiche Zeile: beide Zentren liegen auf der Kopfzeile.
    expect(Math.abs(sound.y + sound.height / 2 - (close.y + close.height / 2))).toBeLessThanOrEqual(4);
    // Nutzerwunsch 27.11.2026: beide Tasten gleich groß (icon-Quadrate) und
    // mit festem Abstand statt aneinander klebend (vorher: Text-Taste ✕
    // breiter als die Sound-Taste, kein Spalt).
    expect(Math.abs(sound.height - close.height), `Höhen ${sound.height}/${close.height}`).toBeLessThanOrEqual(2);
    const gap = close.x - (sound.x + sound.width);
    expect(gap, `Spalt ${gap} px zwischen Sound-Taste und ✕`).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
  });

  test("das Panel ist ein Fenster: Hinterlegung schiebt den Hintergrund zurück, Klick daneben schließt (Nutzerwunsch 27.11.)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = app.locator(".notif-panel");
    await expect(panel).toBeVisible();
    // Wie beim Sheet-Baustein: Hintergrund defokussiert, Panel schwebt davor.
    await expect(app.locator(".notif-backdrop")).toHaveCSS("backdrop-filter", /blur\(16px\)/);
    await expect(panel).toHaveCSS("transform", /matrix/);
    await expect(app.locator("#app > .app-page")).toHaveCSS("transform", /matrix/); // Hintergrund weicht zurück
    await app.locator(".notif-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(panel).toHaveCount(0);
  });

  test("im Fluss-Modus liegt das Panel bündig über den Session-Karten @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kartenbund" });
    // Geometrie untransformiert messen: 3D aus (der Bündig-Vergleich würde
    // sonst die Schwebungs-Skalierung von Panel und Karten sehen).
    await app.evaluate(() => localStorage.setItem("ancientvoid.depth3d", "0"));
    await app.reload();
    const card = app.locator(".split-list .session-card").first();
    await expect(card).toBeVisible();
    const cb = (await card.boundingBox())!;
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = app.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const pb = (await panel.boundingBox())!;
    // Nutzerwunsch 27.11.2026: gleiche Kanten und Breite wie die Karten der
    // Listenspalte — gemessen an der Topbar-Spalte (Notifications.tsx).
    expect(Math.abs(pb.x - cb.x), `links ${pb.x} vs. Karte ${cb.x}`).toBeLessThanOrEqual(2);
    expect(Math.abs(pb.x + pb.width - (cb.x + cb.width)), `rechts ${pb.x + pb.width} vs. Karte ${cb.x + cb.width}`).toBeLessThanOrEqual(2);
  });

  test("Abschnitte einklappbar — nur Ungesehenes steht per Vorgabe offen (Nutzerwunsch 2026-11-18)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" }); // Fehler
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" }); // offene Frage, bleibt offen
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" }); // Zug fertig
    await hub.until(
      async () => {
        const { body } = await hub.api<{ items: { kind: string }[] }>("/api/notifications");
        const kinds = new Set(body.items.map((n) => n.kind));
        return kinds.has("provider.error") && kinds.has("tool.permission_requested") && kinds.has("session.turn_end");
      },
      "Fehler, Frage und fertiger Zug in der Glocke",
      30_000,
    );
    const fold = (name: string) => app.locator(".notif-section", { hasText: name }).locator(".section-fold");

    // Erst wenn die Glocke die volle Hub-Menge zählt, hat die PWA alles
    // ingestiert (4-s-Poll) — der folgende Klick trifft dann einen stabilen
    // Stand, und der zweite Öffnen sieht wirklich alles als gelesen.
    const { body } = await hub.api<{ items: unknown[] }>("/api/notifications");
    await expect(app.getByRole("button", { name: `Benachrichtigungen (${body.items.length} neu)` })).toBeVisible();

    // Erster Öffnen: alles noch ungesehen → alle vorhanden Abschnitte offen
    // („Sonstiges“ existiert im Szenario nicht — kein Eintrag, kein Abschnitt).
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(fold("Fehler")).toHaveAttribute("aria-expanded", "true");
    await expect(fold("Rückfrage")).toHaveAttribute("aria-expanded", "true");
    await expect(fold("Fertig")).toHaveAttribute("aria-expanded", "true");
    await expect(app.locator(".notif-item").filter({ hasText: "Kontingent erschöpft" })).toBeVisible();
    await app.locator(".notif-panel-head").getByRole("button", { name: "✕" }).click();

    // Zweiter Öffnen: alles gesehen → zu. Nur eine noch live offene Freigabe
    // bleibt Vorgabe-offen (Read-Mark löscht keine offene Frage, wie der Glow).
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(fold("Fehler")).toHaveAttribute("aria-expanded", "false");
    await expect(fold("Rückfrage")).toHaveAttribute("aria-expanded", "true");
    await expect(fold("Fertig")).toHaveAttribute("aria-expanded", "false");
    await expect(app.locator(".notif-item").filter({ hasText: "Rückfrage" })).toBeVisible();
    await expect(app.locator(".notif-item").filter({ hasText: "Kontingent erschöpft" })).toHaveCount(0);

    // Von Hand aufklappen zeigt die Meldungen, zuklappen versteckt sie wieder.
    await fold("Fehler").click();
    await expect(app.locator(".notif-item").filter({ hasText: "Kontingent erschöpft" })).toBeVisible();
    await fold("Fehler").click();
    await expect(app.locator(".notif-item").filter({ hasText: "Kontingent erschöpft" })).toHaveCount(0);

    // Neu angekommen, während das Panel offen ist: nur der betroffene Abschnitt klappt auf
    // („Zug fertig“ zählt jetzt zum grünen Fertig-Abschnitt, nicht mehr zu Sonstiges).
    await hub.createSession({ adapter: "opencode", prompt: "Nochmal Kurz" });
    await expect(fold("Fertig")).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
    await expect(fold("Fehler")).toHaveAttribute("aria-expanded", "false");
    await expect(app.locator(".notif-item").filter({ hasText: "Zug fertig" })).toHaveCount(2);
  });

  test("Hub weg und wieder da wird gemeldet", async ({ app, hub }) => {
    await hub.kill("SIGKILL");
    await expect(app.locator(".toast.warning").filter({ hasText: "Hub nicht erreichbar" })).toBeVisible({ timeout: 15_000 });
    await hub.restart();
    await expect(app.locator(".toast.success").filter({ hasText: "Verbindung zum Hub wieder da" })).toBeVisible({ timeout: 15_000 });
  });

  test("offline nachgespielter Bestand ist kein Poll — Liste bleibt, Hub-down sichtbar (BUG-0226)", async ({ app, hub }) => {
    test.setTimeout(60_000);
    const alt = "Uralt-Meldung aus dem Cache (BUG-0226)";
    const cached = { items: [{ id: 1, sessionId: null, level: "info", title: alt, detail: null, kind: "test", createdAt: new Date().toISOString() }], lastId: 1 };
    // Der Service Worker serviert offline die gespeicherte Antwort mit
    // X-AncientVoid-Cached-At als normale 200 — hier nachgebaut.
    await app.route("**/api/notifications*", (route) =>
      route.fulfill({ json: cached, headers: { "X-AncientVoid-Cached-At": new Date().toISOString() } }),
    );
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".toast.warning").filter({ hasText: "Hub nicht erreichbar" })).toBeVisible({ timeout: 20_000 });
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(app.locator(".notif-item").filter({ hasText: alt })).toHaveCount(0);
  });

  test("überlappende Polls spielen dieselbe Meldung nicht doppelt (BUG-0222)", async ({ app, hub }) => {
    test.setTimeout(75_000);
    const titel = "Race-Meldung (BUG-0222)";
    const page2 = {
      items: [{ id: 1, sessionId: null, level: "error", title: titel, detail: null, kind: "process.exit", createdAt: new Date().toISOString() }],
      lastId: 1,
    };
    let calls = 0;
    // Executor-Form: das e2e-tsconfig zielt unter es2024, Promise.withResolvers ist dort nicht in der lib.
    let dritterDa: (() => void) | undefined;
    const dritter = new Promise<void>((r) => (dritterDa = r));
    const verzoeger = new Promise((r) => setTimeout(r, 6000));
    // Abruf 2 bleibt hängen, bis Abruf 3 eintrifft (überlappender Poll) oder
    // 6 s vergehen (In-Flight-Guard hält 3 zurück) — dann löst sich 2 mit der
    // neuen Meldung, und 3 bekommt denselben Stand nochmal.
    await app.route("**/api/notifications*", async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ json: { items: [], lastId: 0 } });
      if (calls === 2) {
        await Promise.race([dritter, verzoeger]);
        return route.fulfill({ json: page2 });
      }
      if (calls === 3) {
        dritterDa?.();
        return route.fulfill({ json: page2 });
      }
      return route.fulfill({ json: { items: [], lastId: 1 } });
    });
    await app.goto(`${hub.origin}/#/`);
    await expect.poll(() => calls, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await app.waitForTimeout(7000); // Race ablaufen lassen: entweder kam 3 doppelt oder die Guard hielt ihn zurück
    await expect(app.locator(".toast").filter({ hasText: titel })).toHaveCount(1);
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(app.locator(".notif-item").filter({ hasText: titel })).toHaveCount(1);
  });
});

test.describe("Benachrichtigungen bei UI-Skalierung (Nutzerfund 2026-10-30)", () => {
  // Telefonbreite: erst hier fällt die ungeteilte 100vw-Breite aus dem Bild.
  test.use({ viewport: { width: 390, height: 844 } });

  test("das Panel bleibt bei 140 % Skalierung im Bildschirm und die ✕ bleibt erreichbar", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.getByRole("button", { name: /Benachrichtigungen/ })).toBeVisible();
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "1.4"));
    await app.reload();
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = app.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const vw = await app.evaluate(() => window.innerWidth);
    const box = (await panel.boundingBox())!;
    // zoom skaliert die gerenderte Größe — beide Kanten müssen im Viewport bleiben.
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
    const close = (await panel.locator(".notif-panel-head").getByRole("button", { name: "✕" }).boundingBox())!;
    expect(close.x).toBeGreaterThanOrEqual(-0.5);
    expect(close.x + close.width).toBeLessThanOrEqual(vw + 0.5);
  });

  for (const scale of ["1", "1.2", "1.6"]) {
    test(`Panel liegt bei ${Math.round(Number(scale) * 100)} % vollständig im Bild (alle vier Kanten)`, async ({ app, hub }) => {
      await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
      await expect(app.getByRole("button", { name: /Benachrichtigungen/ })).toBeVisible();
      await app.evaluate((v) => localStorage.setItem("ancientvoid.uiScale", v), scale);
      await app.reload();
      await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
      const panel = app.locator(".notif-panel");
      await expect(panel).toBeVisible();
      const { vw, vh } = await app.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
      for (const box of [(await panel.boundingBox())!, (await panel.locator(".notif-panel-head").getByRole("button", { name: "✕" }).boundingBox())!]) {
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.y).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(vh + 0.5);
      }
    });

    test(`Meldung oben überdeckt die Glocke nicht bei ${Math.round(Number(scale) * 100)} %`, async ({ app, hub }) => {
      await app.evaluate((v) => localStorage.setItem("ancientvoid.uiScale", v), scale);
      await app.reload();
      await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
      const toast = app.locator(".toast.error").first();
      await expect(toast).toBeVisible();
      const close = (await toast.locator(".toast-close").boundingBox())!;
      // Die Glocke liegt fest oben rechts — die ✕ der Meldung darf sie nicht berühren.
      const box = (await app.locator(".notif-bell").boundingBox())!;
      const overlaps = close.x < box.x + box.width && close.x + close.width > box.x && close.y < box.y + box.height && close.y + close.height > box.y;
      expect(overlaps, `✕ ${JSON.stringify(close)} vs Glocke ${JSON.stringify(box)}`).toBe(false);
    });
  }
});

test.describe("Glocke am PC: Listenkopf wenn die Liste offen, Fenstereck wenn zu (EPIC-P64 T64.4 löst T51.4 ab) @desktop", () => {
  // Läuft in beiden Projekten als PC-Szenario (Muster: zoom-flaechen „Desktop-Fläche").
  test.use({ viewport: { width: 1440, height: 900 } });
  const CORNER_TOLERANCE = 14; // 8 px Anker + Subpixel-/Rundungstoleranz

  async function expectCornered(page: Page, zoomNote = "") {
    const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
    const bell = (await page.locator(".notif-bell").boundingBox())!;
    expect(vw - (bell.x + bell.width), `Glocke rechts ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    expect(bell.y, `Glocke oben ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    await page.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = page.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(vw - (box.x + box.width), `Panel rechts ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    expect(box.x, `Panel links im Bild ${zoomNote}`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y, `Panel oben im Bild ${zoomNote}`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.height, `Panel unten im Bild ${zoomNote}`).toBeLessThanOrEqual(vh + 0.5);
    await panel.locator(".notif-panel-head").getByRole("button", { name: "✕" }).click();
    await expect(panel).toHaveCount(0);
  }

  /** T64.4: Fluss-Modus — Glocke liegt im Kopf der Listenspalte, größer als
   * die Umgebung (44 px), überdeckt nichts (kein fixed), Panel hängt gemessen
   * rechtsbündig unter ihr. Größen und Abstände gelten in CSS-px: mit
   * --ui-zoom (CSS `zoom`) skalieren gerenderte Boxen entsprechend. */
  async function expectInListHead(page: Page, note = "") {
    const zoom = await page.evaluate(() => Number(document.documentElement.style.getPropertyValue("--ui-zoom")) || 1);
    const bell = (await page.locator(".notif-bell").boundingBox())!;
    const column = (await page.locator(".split-list").boundingBox())!;
    const topbar = (await page.locator(".split-list .topbar").boundingBox())!;
    const vw = await page.evaluate(() => window.innerWidth);
    // In der Spalte, nicht am Fensterrand: deutlich Abstand zum rechten Rand.
    expect(bell.x + bell.width, `Glocke in der Spalte ${note}`).toBeLessThan(column.x + column.width + 0.5);
    expect(vw - (bell.x + bell.width), `Glocke nicht im Fenstereck ${note}`).toBeGreaterThan(40);
    // Im Fluss: die Topbar enthält sie (gleiche Zeile, innerhalb der Box).
    expect(bell.y).toBeGreaterThanOrEqual(topbar.y - 1);
    expect(bell.y + bell.height).toBeLessThanOrEqual(topbar.y + topbar.height + 1);
    // 44 px CSS — größer als die 36-px-Alte und jedes umliegende Icon der Topbar.
    expect(Math.abs(bell.width - 44 * zoom), `Glocke 44 px ${note}`).toBeLessThanOrEqual(1 + zoom);
    expect(Math.abs(bell.height - 44 * zoom), `Glocke 44 px hoch ${note}`).toBeLessThanOrEqual(1 + zoom);
    await page.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = page.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    // Panel hängt unter der Glocke, rechtsbündig zu ihr — nie mittig.
    expect(Math.abs(box.y - (bell.y + bell.height + 8 * zoom)), `Panel unter der Glocke ${note}`).toBeLessThanOrEqual(2 * zoom + 1);
    expect(Math.abs(box.x + box.width - (bell.x + bell.width)), `Panel rechtsbündig ${note}`).toBeLessThanOrEqual(2 * zoom + 1);
    const { vw: vw2, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(vw2 + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 0.5);
    await panel.locator(".notif-panel-head").getByRole("button", { name: "✕" }).click();
    await expect(panel).toHaveCount(0);
  }

  test("Liste offen: Glocke im Listenkopf, Panel unter ihr — eingeklappt: Fenstereck", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Liste offen)");
    await app.locator(".tile-list-toggle").click();
    await expect(app.locator(".split.list-collapsed")).toBeVisible();
    await expectCornered(app, "(Liste eingeklappt)");
    await app.locator(".tile-list-toggle").click();
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Liste wieder offen)");
  });

  test("Listenkopf hält bei 130 % UI-Zoom (Zoom-Formel, P50)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "1.3"));
    await app.reload();
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Zoom 130 %)");
  });
});
test.describe("Badge-Geometrie der Glocke (BUG-0256)", () => {
  test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true });

  test("Zahl hängt an der Glocke (linker Rand) und bleibt vollständig im Viewport", async ({ app, hub }) => {
    // Ungelesene erzeugen — die Glocke steht im Tablet-split als Flusselement im Listenkopf.
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    const bell = app.locator(".notif-bell");
    const count = app.locator(".notif-count");
    await expect(count).toBeVisible();
    const b = (await bell.boundingBox())!;
    const c = (await count.boundingBox())!;
    expect(c.y, "an der Glocke verankert (vorher: y=-4, 227 px über der Glocke)").toBeGreaterThanOrEqual(b.y - 8);
    expect(c.y, "vollständig im Viewport").toBeGreaterThanOrEqual(0);
    expect(c.x + c.width, "überlappt die Glocke horizontal").toBeLessThanOrEqual(b.x + b.width + 8);
    expect(c.x, "am linken Rand der Glocke").toBeLessThanOrEqual(b.x + 4);
  });
});

import { test, expect } from "../support/fixtures.ts";

/** Globaler Nyx-FAB: Speech-to-Text in das fokussierte Feld (+ Zwischenablage). */

test.describe("Nyx-FAB (Speech-to-Text)", () => {
  test.beforeEach(async ({ page }) => {
    // Gesteuerter Spracherkenner: `__speechSessions` beschreibt, was der Erkner
    // nacheinander abgibt (interim = Vorschau, final = segment). Nach Stille macht
    // Chrome ein onend — das hier ist die zweite Session, damit der Neustart testbar ist.
    await page.addInitScript(() => {
      type Emit = { text: string; final?: boolean };
      type Session = { emits: Emit[]; gap?: number };
      const g = globalThis as unknown as { __speechSessions?: Session[]; SpeechRecognition?: unknown };
      class FakeRecognition {
        lang = "";
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onstart: (() => void) | null = null;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        private stopped = false;
        start() {
          const sessions = g.__speechSessions ?? [];
          const session: Session = sessions.shift() ?? { emits: [], gap: 400 };
          let i = 0;
          let timer: ReturnType<typeof setTimeout>;
          this.flush = () => {
            for (let k = i; k < session.emits.length; k++) {
              const e = session.emits[k];
              if (e?.text) this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, length: 1, 0: { transcript: e.text } }] });
            }
            i = session.emits.length;
          };
          const step = () => {
            if (this.stopped) return void this.onend?.();
            const e = session.emits[i++];
            if (!e) return void this.onend?.();
            this.onresult?.({ resultIndex: 0, results: [{ isFinal: !!e.final, length: 1, 0: { transcript: e.text } }] });
            timer = setTimeout(step, session.gap ?? 120);
          };
          timer = setTimeout(() => {
            this.onstart?.();
            step();
          }, 30);
          void timer;
        }
        private flush: (() => void) | null = null;
        stop() {
          // So tut es einen echten Browser: beim Stoppen kommen die ausstehenden
          // Endergebnisse noch heraus — ein Diktat verliert kein halbfertiges Wort.
          this.flush?.();
          this.stopped = true;
          this.onend?.();
        }
        abort() {
          this.stopped = true;
        }
      }
      g.SpeechRecognition = FakeRecognition;
    });
  });

  test("FAB ist sichtbar; Composer hat keinen Voice-Button mehr", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator('[data-testid=nyx-fab]')).toBeVisible();
    await expect(app.locator(".composer-actions").getByRole("button", { name: "Voice" })).toHaveCount(0);
  });

  test("erneut tippen stoppt: Text kommt erst beim Stoppen ins Feld", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.click();
    await app.evaluate(() => ((globalThis as unknown as { __speechSessions?: unknown[] }).__speechSessions = [{ emits: [{ text: "bitte weitermachen", final: true }], gap: 120 }]));
    await app.locator('[data-testid=nyx-fab]').click();
    await expect(field).toHaveValue("");
    await app.locator('[data-testid=nyx-fab]').click();
    await expect(field).toHaveValue("bitte weitermachen");
  });

  test("BUG-0177: Wörter erscheinen während des Sprechens, der Knopf wird zum Stopp-Knopf", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.click();
    await app.evaluate(() => ((globalThis as unknown as { __speechSessions?: unknown[] }).__speechSessions = [
      { emits: [{ text: "bitte", final: false }, { text: "bitte weiter", final: false }, { text: "bitte weitermachen", final: true }], gap: 700 },
    ]));
    const fab = app.locator('[data-testid=nyx-fab]');
    await fab.click();
    const words = app.locator('[data-testid=nyx-fab-words]');
    // Wort-fuer-Wort: der Vorschautext waechst sichtbar, bevor etwas im Feld landet.
    const read = async () => (await words.textContent()) ?? "";
    await expect.poll(read, { timeout: 5_000 }).toBe("bitte");
    const erste = await read();
    await expect.poll(async () => (await read()).length > erste.length, { timeout: 5_000 }).toBe(true);
    const spaeter = await read();
    expect(spaeter.length).toBeGreaterThan(erste.length);
    expect(spaeter).toContain("bitte weiter");
    // Solange gelauscht wird, steht nichts im Feld — und der Knopf ist eindeutig Stopp.
    await expect(field).toHaveValue("");
    await expect(app.locator('[data-testid=nyx-fab-stop]')).toBeVisible();
    await expect(app.locator('[data-testid=nyx-fab-state]')).toContainText(/läuft 0:0\d/);
    await expect(fab).toHaveAttribute("aria-pressed", "true");
    await fab.click();
    await expect(field).toHaveValue("bitte weitermachen");
    await expect(app.locator('[data-testid=nyx-fab-stop]')).toHaveCount(0);
  });

  test("BUG-0177: Chrome beendet die Erkennung nach Stille — das Diktat läuft trotzdem weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.click();
    await app.evaluate(() => ((globalThis as unknown as { __speechSessions?: unknown[] }).__speechSessions = [
      { emits: [{ text: "zuerst", final: true }], gap: 120 },
      { emits: [{ text: "danach", final: true }], gap: 120 },
    ]));
    const fab = app.locator('[data-testid=nyx-fab]');
    await fab.click();
    await expect(app.locator('[data-testid=nyx-fab-words]')).toContainText("zuerst danach");
    await expect(app.locator('[data-testid=nyx-fab-toast]')).toContainText(/neu gestartet/);
    await fab.click();
    await expect(field).toHaveValue("zuerst danach");
  });

  test("Position bleibt nach Drag je Breakpoint erhalten", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const fab = app.locator('[data-testid=nyx-fab]');
    await expect(fab).toHaveAttribute("data-bp", "phone");
    const box = await fab.boundingBox();
    expect(box).toBeTruthy();
    await fab.dispatchEvent("pointerdown", { clientX: box!.x + 10, clientY: box!.y + 10, pointerId: 1, buttons: 1 });
    await fab.dispatchEvent("pointermove", { clientX: box!.x + 10, clientY: box!.y - 100, pointerId: 1, buttons: 1 });
    await fab.dispatchEvent("pointerup", { clientX: box!.x + 10, clientY: box!.y - 100, pointerId: 1, buttons: 0 });
    const after = await fab.boundingBox();
    expect(after!.y).toBeLessThan(box!.y - 40);
    await app.reload();
    await expect(app.locator('[data-testid=nyx-fab]')).toBeVisible();
    const again = await app.locator('[data-testid=nyx-fab]').boundingBox();
    expect(Math.abs((again?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(8);
  });

  test("BUG-0138: in der Standardposition liegt der FAB über dem Dock, nie auf dessen Tasten", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect
      .poll(async () => {
        const [fab, dock] = await Promise.all([app.locator('[data-testid=nyx-fab]').boundingBox(), app.locator(".dock-stack").boundingBox()]);
        return fab!.y + fab!.height <= dock!.y;
      })
      .toBe(true);
  });

  test("BUG-0145: das Ende des Verlaufs lässt sich über den FAB scrollen", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const tail = app.locator(".tail-scroll");
    await expect.poll(() => tail.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
    await expect
      .poll(async () => {
        await tail.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        const fab = (await app.locator('[data-testid=nyx-fab]').boundingBox())!;
        // Unterkante des letzten Inhalts im Scrollbereich, nicht des (gepolsterten) Containers.
        const contentBottom = await tail.evaluate((el) => Math.max(...[...el.children].map((c) => c.getBoundingClientRect().bottom)));
        return contentBottom <= fab.y;
      })
      .toBe(true);
  });

  test("BUG-0199: auf langen Seiten ohne Dock verdeckt der FAB kein Bedienelement", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await app.goto(`${hub.origin}/#/einstellungen`);
    await expect(app.locator('[data-testid=nyx-fab]')).toBeVisible();

    const punkte = await app.evaluate(() => {
      const grenze = Math.min(document.documentElement.scrollHeight - window.innerHeight, 6000);
      const pts: number[] = [];
      for (let y = 0; y <= grenze; y += 300) pts.push(y);
      return pts;
    });
    expect(punkte.length).toBeGreaterThan(6); // die Seite ist lang genug fuer den alten Fall

    for (const y of punkte) {
      await app.evaluate((petz) => window.scrollTo(0, petz), y);
      await app.waitForTimeout(240); // der FAB misst nach dem Nachrollen (Entprellung 140 ms)
      const verdeckt = await app.evaluate(() => {
        const fab = document.querySelector("[data-nyx-fab]");
        if (!fab) return ["FAB fehlt"];
        const r = fab.getBoundingClientRect();
        if (fab instanceof HTMLElement && (fab.hidden || r.width === 0)) return [];
        const treffer: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, a[href], [role="switch"], [role="button"], [role="checkbox"], summary',
        )) {
          if (el.closest("[data-nyx-fab]")) continue;
          const c = el.getBoundingClientRect();
          if (c.width === 0 || c.height === 0) continue;
          const cx = c.x + c.width / 2;
          const cy = c.y + c.height / 2;
          if (cx < r.x || cx > r.x + r.width || cy < r.y || cy > r.y + r.height) continue;
          const hit = document.elementFromPoint(Math.round(cx), Math.round(cy));
          if (!hit) continue;
          if (hit === el || el.contains(hit) || hit.contains(el)) continue; // Tipp kaeme an
          treffer.push(`${el.className || el.tagName} -> ${hit.className || hit.tagName}`);
        }
        return treffer;
      });
      expect(verdeckt, `Scrollpunkt ${y} px`).toEqual([]);
    }
  });

  test("BUG-0283: intern scrollende Übersichtsliste — der FAB verdeckt kein Karten-Bedienelement", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    for (let i = 0; i < 18; i++) await hub.createSession({ adapter: "dummy", prompt: `Übersicht ${i + 1}` });
    await app.goto(`${hub.origin}/#/`);
    const list = app.locator(".dashboard");
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(400);
    await expect(app.locator('[data-testid=nyx-fab]')).toBeVisible();
    // Erstumbruch abwarten: die Sessions wandern nach „fertig“ in die Ruhig-Gruppe —
    // ohne den Fix zieht genau das Karten ohne jedes Event unter den FAB.
    await app.waitForTimeout(2600);

    const max = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
    for (let y = 0; y <= max; y += 60) {
      await list.evaluate((el, y) => el.scrollTo(0, y), y);
      await app.waitForTimeout(240); // der FAB misst nach dem Nachrollen (Entprellung 140 ms)
      const verdeckt = await app.evaluate(() => {
        const listEl = document.querySelector(".dashboard");
        if (!listEl) return ["Liste fehlt"];
        const clip = listEl.getBoundingClientRect();
        const treffer: string[] = [];
        for (const el of Array.from(listEl.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], summary'))) {
          if (el.closest("[data-nyx-fab]")) continue;
          const c = el.getBoundingClientRect();
          if (c.width === 0 || c.height === 0) continue;
          const cx = c.x + c.width / 2;
          const cy = c.y + c.height / 2;
          // Nur Controls, die sichtbar in der Liste stehen — unter dem Dockrand
          // Geclipptes ist unerreichbar, aber vom FAB unberührt.
          if (cy < clip.top || cy > clip.bottom || cy < 0 || cy > window.innerHeight) continue;
          const hit = document.elementFromPoint(cx, cy);
          if (!hit) continue;
          if (hit === el || el.contains(hit) || hit.contains(el)) continue; // Tipp kaeme an
          treffer.push(`${el.className || el.tagName} -> ${hit.className || hit.tagName}`);
        }
        return treffer;
      });
      expect(verdeckt, `Listen-Scrollpunkt ${y} px`).toEqual([]);
    }
  });

  test("BUG-0201: am PC sitzt der FAB nicht ueber dem Chat-Verlauf", async ({ app, hub }) => {
    await app.setViewportSize({ width: 1280, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll")).toBeVisible();
    await expect
      .poll(async () => {
        const fab = await app.locator('[data-testid=nyx-fab]').boundingBox();
        const tail = await app.locator(".tail-scroll").boundingBox();
        if (!fab || !tail) return "kein Messwert";
        const ueberschneidung =
          fab.x < tail.x + tail.width && fab.x + fab.width > tail.x && fab.y < tail.y + tail.height && fab.y + fab.height > tail.y;
        return ueberschneidung ? `FAB ${Math.round(fab.x)},${Math.round(fab.y)} uber dem Verlauf` : "frei";
      })
      .toBe("frei");
  });

  test("lässt sich mit echter Maus ziehen (kein nativer Bild-Drag) und ist ≥ 64 px groß", async ({ app, hub }) => {
    await app.setViewportSize({ width: 1400, height: 900 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const fab = app.locator('[data-testid=nyx-fab]');
    const box = (await fab.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(64);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await app.mouse.move(cx, cy);
    await app.mouse.down();
    // Abwaerts/waerts ziehen: der PC-Default sitzt unten links, nach links und unten ist
    // der Viewport-Rand (Klemme bei 0) — das haette nur die Klemme getestet, nicht das Ziehen.
    await app.mouse.move(cx + 250, cy - 150, { steps: 12 });
    await app.mouse.up();
    const after = (await fab.boundingBox())!;
    expect(after.x).toBeGreaterThan(box.x + 150);
    expect(after.y).toBeLessThan(box.y - 80);
    // Ziehen ist kein Klick: es startet keine Aufnahme.
    await expect(app.locator('[data-testid=nyx-fab-toast]')).toHaveCount(0);
  });
});

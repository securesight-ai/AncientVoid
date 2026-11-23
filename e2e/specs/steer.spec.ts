import { test, expect, statusPill } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

async function answered(hub: TestHub, id: string, n: number): Promise<void> {
  await hub.until(async () => (await hub.events(id)).filter((e) => e.type === "assistant").length >= n, `${n} answers`);
}

test.describe("Antworten, Stop und Weiter (T1.5-6, T5.4, T5.5)", () => {
  test("eine Antwort geht an die laufende Session und kommt im Chat an @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await answered(hub, id, 1);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("Zweiter Zug");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Zweiter Zug · Session ses_e2e_\w+/)).toBeVisible();
    const natives = (await hub.events(id))
      .filter((e) => e.type === "assistant")
      .map((e) => /Session (ses_e2e_\w+)/.exec(String(e.payload.text))?.[1]);
    expect(new Set(natives).size, "same provider session across turns").toBe(1);
  });

  test("Codex verarbeitet /compact nativ und nimmt danach wieder Prompts an @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "codex", prompt: "Erster Zug" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "first turn over");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("/compact");
    await app.getByRole("button", { name: "Senden" }).click();
    await hub.until(async () => (await hub.events(id)).some((event) => event.payload.kind === "codex.compaction_end"), "native compaction end");
    await expect(statusPill(app)).toHaveAttribute("data-status", "idle");
    expect((await hub.events(id)).filter((event) => event.type === "assistant")).toHaveLength(1);
    await app.getByPlaceholder("Antworten…").fill("Nach Compaction");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText("Antwort auf: Nach Compaction · Codex")).toBeVisible();
  });

  test("Stop beendet die Session, Weiter setzt dieselbe Provider-Session fort", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Vor dem Stopp" });
    await answered(hub, id, 1);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Stop" }).click();
    await expect(statusPill(app)).toHaveAttribute("data-status", "stopped");
    await expect(app.getByRole("button", { name: "Stop" })).toHaveCount(0);

    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("Nach dem Stopp");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nach dem Stopp · Session ses_e2e_\w+ \(fortgesetzt\)/)).toBeVisible();
    await expect(statusPill(app)).toHaveAttribute("data-status", "idle");
    const [record] = await hub.sessions();
    const first = (await hub.events(id)).find((e) => e.type === "assistant");
    expect(String(first?.payload.text)).toContain(record!.nativeSessionId!);
  });

  test("ein Doppeltipp auf Senden startet nur einen Zug (BUG-0016)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await answered(hub, id, 1);
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Nur einmal");
    await app.getByRole("button", { name: "Weiter" }).dblclick();
    await answered(hub, id, 2);
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nur einmal/)).toHaveCount(1);
    const continued = (await hub.events(id)).filter((e) => e.payload.kind === "session.continued");
    expect(continued).toHaveLength(1);
  });

  test("zwei Geräte gleichzeitig: eines schreibt, das andere sieht den Konflikt (BUG-0017, AC-P5-4)", async ({ browser, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await answered(hub, id, 1);
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    const open = async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript((token) => localStorage.setItem("ancientvoid.token", token), hub.token);
      await page.goto(`${hub.origin}/#/sessions/${id}`);
      await page.getByPlaceholder("Antworten…").fill("Wer zuerst kommt");
      return page;
    };
    const [phone, desktop] = await Promise.all([open(), open()]);
    await Promise.all([
      phone.getByRole("button", { name: "Weiter" }).click(),
      desktop.getByRole("button", { name: "Weiter" }).click(),
    ]);
    await answered(hub, id, 2);
    const conflicts = await Promise.all(
      [phone, desktop].map((p) => p.getByText("Ein anderes Gerät schreibt gerade in diese Session.").count()),
    );
    expect(conflicts.sort()).toEqual([0, 1]);
    const continued = (await hub.events(id)).filter((e) => e.payload.kind === "session.continued");
    expect(continued).toHaveLength(1);
    await phone.context().close();
    await desktop.context().close();
  });

  test("eine abgelehnte Antwort wird angezeigt, nicht verschluckt", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    await hub.kill("SIGTERM");
    await app.getByPlaceholder("Antworten…").fill("Hub ist weg");
    await app.getByRole("button", { name: /Senden|Weiter|Vormerken/ }).click();
    await expect(app.locator(".reply-error")).toBeVisible();
  });

  test("der Status trennt laufenden Zug und Pause zwischen Zügen (T5.4) @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(statusPill(app)).toHaveAttribute("data-status", "idle");
    await app.getByPlaceholder("Antworten…").fill("Arbeite LANGSAM");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(statusPill(app)).toHaveAttribute("data-status", "working");
    // BUG-0063/EPIC-P43 T43.2: Arbeit ist im Chat *sichtbar*, in derselben Zustandssprache wie auf
    // den Karten — der Punkt atmet.
    await expect(app.locator(".session-topbar .status-working .status-mark")).toHaveCSS("animation-name", "mv-breathe");
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}$`));
    await app.getByRole("button", { name: "Stop" }).click();
    await expect(statusPill(app)).toHaveAttribute("data-status", "stopped");
    const ends = (await hub.events(id)).filter((e) => e.payload.kind === "session.turn_end");
    expect(ends).toHaveLength(1);
  });

  test("das Antwortfeld kommt zurück, wenn der Hub beim Öffnen kurz weg war (BUG-0022)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    // The first /api/adapters call is the sign-in check; the next ones come
    // from the session view. Those fail until the "network" is back.
    let calls = 0;
    let offline = true;
    await app.route("**/api/adapters", (route) => (++calls > 1 && offline ? route.abort() : route.continue()));
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.reload();
    await expect(app.locator(".session-topbar")).toContainText("opencode");
    await expect(app.getByPlaceholder("Antworten…")).toHaveCount(0);
    offline = false;
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible({ timeout: 8_000 });
  });
});

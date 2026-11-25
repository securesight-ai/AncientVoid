import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P15 T15.3: Nachrichten vormerken und eine laufende Session pausieren.
 * Die Attrappe der Claude-CLI hält den Zug mit LANGSAM offen, mit ZUEGIG 3 s.
 */
test.describe("Pause und Warteschlange", () => {
  const sessionPrompts = async (hub: { events: (id: string) => Promise<{ type: string; summary: string; payload: Record<string, unknown> }[]> }, id: string) =>
    (await hub.events(id)).filter((e) => (e.payload as { kind?: string }).kind === "session.prompt" || e.type === "user").map((e) => e.summary);

  async function open(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
  }

  test("Vormerken: die Nachricht wartet, steht in der Liste und geht am Zugende raus (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "ZUEGIG erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("zweite Frage danach");
    // Während des Zugs ersetzt Vormerken den Senden-Knopf — es gibt keinen zweiten daneben.
    await expect(app.getByRole("button", { name: "Senden" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Vormerken" })).toHaveCount(1);
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("zweite Frage danach");
    // ... und sie geht nach dem Zugende genau einmal raus:
    await expect(app.locator(".queue-list")).toHaveCount(0, { timeout: 20_000 });
    await hub.until(async () => (await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach")).length >= 1, "vorgemerkter Prompt gesendet", 20_000);
    expect((await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach"))).toHaveLength(1);
  });

  test("eine vorgemerkte Nachricht lässt sich streichen — sie geht nie raus", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("doch nicht");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("doch nicht");
    const remove = app.getByRole("button", { name: /Vorgemerkte Nachricht 1 streichen/ });
    // Symbol-Tasten haben eine echte Trefferfläche (≥ 36 px mit Maus).
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await remove.click();
    await expect(app.locator(".queue-list")).toHaveCount(0);
    // Gestrichen heißt beim Hub gestrichen — nicht nur ausgeblendet, bis zum nächsten Laden.
    await hub.until(async () => (await hub.api<unknown[]>(`/api/sessions/${id}/queue`)).body.length === 0, "Warteschlange beim Hub leer", 5_000);
    await app.reload();
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await expect(app.locator(".queue-list")).toHaveCount(0);
    expect(await sessionPrompts(hub, id)).not.toContain("doch nicht");
  });

  test("BUG-0114/ADR-0074: bei Next-Turn-Adaptern ohne midTurnInput bleibt die Vormerkung liegen und die Ablehnung steht da", async ({ app, hub }) => {
    // ADR-0098: claude selbst lenkt jetzt mitten im Zug — die Ablehnung gilt
    // weiter für Next-Turn-Adapter OHNE diese Zusicherung (hier: ACP/dsh-Form).
    const id = await hub.createSession({ adapter: "acp", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("kurze Zwischenfrage");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("kurze Zwischenfrage");

    // Ein Knopf, der nur scheitern kann, wird nicht angeboten — der Grund steht da.
    await expect(app.getByRole("button", { name: /Vorgemerkte Nachricht 1 jetzt senden/ })).toHaveCount(0);
    await expect(app.locator(".queue-list .queue-wait")).toHaveText("geht automatisch raus, wenn der Zug fertig ist");
    // Der Hub lehnt das sofortige Senden trotzdem ab, statt einen zweiten Prozess
    // auf dieselbe native Session zu setzen (ADR-0074).
    const [queued] = (await hub.api<{ id: string }[]>(`/api/sessions/${id}/queue`)).body;
    const denied = await hub.api<{ detail: string }>(`/api/sessions/${id}/queue/${queued!.id}/send`, { method: "POST", body: {} });
    expect(denied.status).toBe(422);
    expect(denied.body.detail).toContain("keine weitere Nachricht annehmen");
    await expect(app.locator(".queue-list")).toContainText("kurze Zwischenfrage");
    expect((await hub.api<unknown[]>(`/api/sessions/${id}/queue`)).body).toHaveLength(1);
  });


  test.describe("mit durchlaufendem Dummy-Zug", () => {
    // Live-Eingabe braucht einen Zug, der während des Tests nicht endet.
    test.use({ hubOptions: { dummyAutoStop: 0 } });
    test("BUG-0114: bei Live-Eingabe lässt sich eine vorgemerkte Nachricht sofort in den laufenden Zug senden", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy", prompt: "erste Frage" });
      await open(app, hub.origin, id);
      await expect(app.locator(".session-top-meta .status")).toHaveText("arbeitet");
      const ack = await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "kurze Zwischenfrage", queue: true } });
      expect(ack.status).toBe(200);
      await expect(app.locator(".queue-list")).toContainText("kurze Zwischenfrage");

      await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 jetzt senden/ }).click();
      await expect(app.locator(".queue-list")).toHaveCount(0);

      // Der Prompt ist sofort angekommen — der Dummy-Zug läuft noch (kein Turn-Ende).
      await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "dummy.prompt" && String((e.payload as { text?: string }).text).includes("kurze Zwischenfrage")), "vorgemerkter Prompt sofort gesendet", 20_000);
      expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
      expect((await hub.api<unknown[]>(`/api/sessions/${id}/queue`)).body).toHaveLength(0);
    });
  });

  test("Pause hält den Zug an, die Session steht auf pausiert und läuft mit „Weiter“ wieder (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByRole("button", { name: "Pause" }).click();
    await expect(app.locator(".session-top-meta .status")).toHaveText("pausiert");
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await app.getByPlaceholder("Antworten…").fill("mach bitte weiter");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator(".session-top-meta .status")).not.toHaveText("pausiert");
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.summary.length > 0), "Antwort nach der Pause", 20_000);
  });

  test("Adapter ohne Anhalten zeigen keinen Pause-Knopf", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude-clip" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
  });
});

test.describe("Steer-Timeout (AC-P17-3)", () => {
  // T17.4: der Hub wartet hart begrenzt auf die Annahme eines Prompts. Ein
  // Timeout beweist nichts — derselbe inputId wird nie zweimal gesendet.
  test.use({ hubOptions: { steerWaitMs: 3_000 } });

  test("eine hängende Antwort endet mit Timeout-Event und wird nie doppelt gesendet", async ({ hub }) => {
    test.setTimeout(90_000);
    const id = await hub.createSession({ adapter: "codex", prompt: "erste Frage SPAETES_ENDE" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 30_000);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "erster Zug abgeschlossen", 30_000);

    const body = { kind: "prompt", text: "STUMM zweite Frage", inputId: "stumm-1" };
    const first = await hub.api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/steer`, { method: "POST", body });
    expect(first.status).toBe(422);
    expect(first.body.detail).toMatch(/steer timeout/);

    // Fail loud: der Timeout steht als eigenes Event im Verlauf …
    const events = await hub.events(id);
    expect(events.filter((e) => (e.payload as { kind?: string }).kind === "session.steer_timeout")).toHaveLength(1);

    // … und der Retry mit derselben inputId ist keine zweite Submission.
    const retry = await hub.api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/steer`, { method: "POST", body });
    expect(retry.status).toBe(422);
    expect(retry.body.detail).toMatch(/in flight/);
    const asked = (await hub.events(id)).filter(
      (e) => e.type === "user" && String((e.payload as { text?: string }).text).includes("STUMM"),
    );
    expect(asked).toHaveLength(1);
  });
});

/**
 * ADR-0085: Kai steuert Pi vom Handy. Zwei Dinge müssen gehen: wählen, WIE eine Meldung
 * zugestellt wird (vormerken am Zugende oder jetzt lenken — die Wahl darf es nur dort geben,
 * wo der Adapter Eingaben mitten im Zug zusagt), und eine vorgemerkte Meldung nachträglich
 * ändern (Text und Stelle in der Reihe).
 */
test.describe("Zustellung wählen und Vorgemerktes nachträglich ändern (ADR-0085)", () => {
  const prompts = async (hub: { events: (id: string) => Promise<{ type: string; summary: string; payload: Record<string, unknown> }[]> }, id: string) =>
    (await hub.events(id)).filter((e) => (e.payload as { kind?: string }).kind === "session.prompt" || e.type === "user").map((e) => e.summary);
  const queueTexts = async (hub: { api: { <T>(path: string): Promise<{ body: T }> } }, id: string) =>
    (await hub.api<{ text: string; position: number }[]>(`/api/sessions/${id}/queue`)).body.map((q) => q.text);

  test.describe("mit durchlaufendem Zug (Eingabe mitten im Zug möglich)", () => {
    test.use({ hubOptions: { dummyAutoStop: 0 } });

    test("lenken schickt die Meldung sofort in den laufenden Zug, „am Zugende“ stellt um", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy", prompt: "erste Frage" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await expect(app.getByPlaceholder("Antworten…")).toBeVisible();

      const chip = app.getByTestId("delivery-toggle");
      await expect(chip).toHaveText("am Zugende");
      // Nutzerfund 18.11.: der Chip stand links am Hauptknopf und trug ein Emoji — beides
      // ist jetzt festgehalten: er steht rechts, ist so hoch wie der Knopf, und sein Symbol
      // ist ein Linienzeichen (eigenes <svg>), kein gerätefärbiges Emoji.
      const mainBox = await app.getByTestId("send-queue").boundingBox();
      const chipBox = await chip.boundingBox();
      expect([chipBox, mainBox]).toEqual([expect.objectContaining({}), expect.objectContaining({})]);
      expect(chipBox!.x).toBeGreaterThan(mainBox!.x + mainBox!.width - 1);
      expect(Math.abs(chipBox!.height - mainBox!.height)).toBeLessThanOrEqual(2);
      await expect(chip.locator("svg")).toHaveCount(1);
      const label = await chip.textContent();
      expect(label).not.toMatch(/[\u2300-\u27BF\u{1F300}-\u{1FAFF}]/u); // kein Emoji in der Beschriftung
      expect(label ?? "").not.toContain("\uFE0F"); // auch kein Variation Selector als Emoji-Markierung
      await chip.click();
      await expect(chip).toHaveText("lenken");
      await expect(app.getByTestId("send-now")).toHaveText("Jetzt lenken");

      await app.getByPlaceholder("Antworten…").fill("mitten im Zug lenken");
      await app.getByTestId("send-now").click();
      await expect(app.locator(".queue-list")).toHaveCount(0); // nichts vorgemerkt
      await hub.until(
        async () =>
          (await hub.events(id)).some((e) => e.payload.kind === "dummy.prompt" && String((e.payload as { text?: string }).text).includes("mitten im Zug lenken")),
        "Prompt mitten im Zug angekommen",
        20_000,
      );
      expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
      // Die Wahl ist eine Gewohnheit, kein einmaliger Klick: sie übersteht ein Neuladen.
      await app.reload();
      await expect(app.getByTestId("delivery-toggle")).toHaveText("lenken");
    });

    test("↑ ↓ und ✎ wirken beim Hub, nicht nur in der Ansicht", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy", prompt: "erste Frage" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
      for (const text of ["vierte Anfrage", "wichtigste Anfrage"]) {
        await app.getByPlaceholder("Antworten…").fill(text);
        await app.getByRole("button", { name: "Vormerken" }).click();
      }
      await expect(app.locator(".queue-item")).toHaveCount(2);
      expect(await queueTexts(hub, id)).toEqual(["vierte Anfrage", "wichtigste Anfrage"]);

      await app.getByTestId("queue-move-front").nth(1).click();
      await expect(app.locator(".queue-item").first()).toContainText("wichtigste Anfrage");
      expect(await queueTexts(hub, id)).toEqual(["wichtigste Anfrage", "vierte Anfrage"]);

      await app.getByTestId("queue-edit").first().click();
      await app.getByLabel("Vorgemerkte Nachricht 1 bearbeiten").fill("wichtigste, präzisiert");
      await app.getByTestId("queue-edit-save").click();
      expect(await queueTexts(hub, id)).toEqual(["wichtigste, präzisiert", "vierte Anfrage"]);
      expect((await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "session.queue_moved")).toBe(true);
      expect((await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "session.queue_edited")).toBe(true);
    });

    test("im Querformat bleibt die Zustellwahl neben der Eingabe erreichbar", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy", prompt: "erste Frage" });
      await app.setViewportSize({ width: 915, height: 412 });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      // Chat ist die Arbeitsansicht; im niedrigen Querformat startet die Steuerung
      // zugeklappt (BUG-0053) — beides machen wir wie ein Nutzer.
      await app.getByRole("button", { name: "Chat" }).click();
      const composer = app.getByPlaceholder("Antworten…");
      if (!(await composer.isVisible())) await app.locator(".dock-toggle").click();
      await expect(composer).toBeVisible();
      const chip = app.getByTestId("delivery-toggle");
      await expect(chip).toBeInViewport();
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.x + box.width).toBeLessThanOrEqual(915);
      await expect(app.getByRole("button", { name: "Chat" })).toBeInViewport();
    });
  });

  test("claude bietet die Wahl an (ADR-0098): Standard bleibt Vormerken — ⚡ lenkt mitten im Zug", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    // ADR-0098: der Streaming-Input-Prozess nimmt Meldungen mitten im Zug an —
    // der Chip ist da (vor ADR-0098 verbot ADR-0074 die Wahl für claude noch).
    await expect(app.getByTestId("delivery-toggle")).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Vormerken" })).toHaveCount(1);
    await app.getByPlaceholder("Antworten…").fill("am Zugende");
    await app.getByRole("button", { name: "Vormerken" }).click();
    expect(await queueTexts(hub, id)).toEqual(["am Zugende"]);

    // BUG-0235: „jetzt lenken“ geht in den laufenden Zug, nicht in die Warteschlange.
    const chip = app.getByTestId("delivery-toggle");
    await chip.click();
    await expect(app.getByTestId("send-now")).toHaveText("Jetzt lenken");
    await app.getByPlaceholder("Antworten…").fill("zwischenruf jetzt");
    await app.getByTestId("send-now").click();
    // Der Zwischenruf geht sofort in den laufenden Zug — er landet NICHT in
    // der Warteschlange (die weiterhin nur „am Zugende“ enthält).
    await hub.until(
      async () => (await hub.events(id)).some((e) => e.payload?.kind === "session.prompt" && String((e.payload as { text?: string }).text).includes("zwischenruf jetzt")),
      "Zwischenruf mitten im Zug angekommen",
      20_000,
    );
    expect(await queueTexts(hub, id)).toEqual(["am Zugende"]);
  });

  test("BUG-0235: Claude leert die Vormerkung nach dem Hauptzug bei weiterlaufendem Hintergrundjob", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "ZUEGIG HINTERGRUND" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload?.kind === "session.activity_begin"), "Hintergrundjob gestartet");
    const ack = await hub.api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/steer`, {
      method: "POST",
      body: { kind: "prompt", text: "Nächster Zug", queue: true },
    });
    expect(ack.body).toMatchObject({ ok: true, detail: "queued" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.summary.includes("Nächster Zug")), "Antwort während des Hintergrundjobs", 8_000);
    expect(await queueTexts(hub, id)).toEqual([]);
    expect((await hub.events(id)).some((e) => e.payload?.kind === "session.activity_end")).toBe(false);
  });

  test("✎ Bearbeiten: die geänderte Fassung geht raus, nicht die alte", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "ZUEGIG erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("URSPRÜNGLICH");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("URSPRÜNGLICH");

    await app.getByTestId("queue-edit").click();
    await app.getByLabel("Vorgemerkte Nachricht 1 bearbeiten").fill("KORRIGIERT");
    await app.getByTestId("queue-edit-save").click();
    await expect(app.locator(".queue-list")).toContainText("KORRIGIERT");
    expect(await queueTexts(hub, id)).toEqual(["KORRIGIERT"]);

    await hub.until(async () => (await prompts(hub, id)).some((t) => t.includes("KORRIGIERT")), "geänderte Fassung gesendet", 25_000);
    expect(await prompts(hub, id)).not.toContain("URSPRÜNGLICH");
  });
});

import { installSpeechRecognition } from "../support/speech.ts";
import { test, expect, statusPill, openApprovals, sessionTab, cardAction, hostedRunner } from "../support/fixtures.ts";
import { phone } from "../support/phone.ts";

test.describe("Archiv (P5 §9)", () => {
  test("Archivieren nimmt die Session aus der Übersicht, der Archiv-Chip holt sie zurück @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    const card = app.locator(".session-card");
    await expect(card).toHaveCount(1);
    await cardAction(card, "Archivieren");
    await expect(card).toHaveCount(0);
    await app.getByRole("button", { name: "Archiv (1)" }).click();
    await expect(card).toHaveCount(1);
    await cardAction(card, "Zurückholen");
    await app.getByRole("button", { name: "Aktive" }).click();
    await expect(card).toHaveCount(1);
  });

  test("Löschen im Archiv räumt archivierte Sessions weg — mit Rückfrage", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    await cardAction(app.locator(".session-card"), "Archivieren");
    await app.getByRole("button", { name: "Archiv (1)" }).click();
    const card = app.locator(".session-card");
    await expect(card).toHaveCount(1);
    // Der Löschen-Button steht nur im Archiv — aktive Karten haben ihn nicht.
    await expect(app.locator(".session-card .session-card-actions").getByRole("button", { name: "Löschen", includeHidden: true })).toHaveCount(1);
    await cardAction(card, "Löschen");
    // Rückfrage im Base-Modal (kein Browser-Dialog) — bestätigen löscht.
    await app.getByTestId("modal").getByRole("button", { name: "Löschen" }).click();
    await expect(card).toHaveCount(0);
    await hub.until(async () => !(await hub.sessions()).some((s) => s.id === id), "archiv delete");
    expect((await hub.api(`/api/sessions/${id}/events`)).status).toBe(404);
  });

  test("eine archivierte Session mit laufendem Adapter lässt sich löschen @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Archivierter Auftrag" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    expect((await hub.api(`/api/sessions/${id}/archive`, { body: { archived: true } })).status).toBe(200);
    await app.getByRole("button", { name: "Archiv (1)" }).click();
    await cardAction(app.locator(".session-card"), "Löschen");
    await app.getByTestId("modal").getByRole("button", { name: "Löschen" }).click();
    await expect.poll(async () => (await hub.api(`/api/sessions/${id}/events`)).status).toBe(404);
    await expect(app.locator(".session-card")).toHaveCount(0);
  });

  test("im Archiv lassen sich ausgewählte und danach alle übrigen Sessions löschen @desktop", async ({ app, hub }) => {
    const ids = [];
    for (const title of ["Archiv A", "Archiv B", "Archiv C"]) {
      const id = await hub.createSession({ adapter: "dummy" });
      await hub.api(`/api/sessions/${id}/stop`, { body: {} });
      await hub.api(`/api/sessions/${id}/meta`, { body: { title } });
      await hub.api(`/api/sessions/${id}/archive`, { body: { archived: true } });
      ids.push(id);
    }
    const active = [await hub.createSession({ adapter: "dummy" }), await hub.createSession({ adapter: "dummy" })].sort();
    await app.getByRole("button", { name: "Archiv (3)" }).click();
    const search = app.getByRole("searchbox", { name: "Sessions filtern" });
    await search.fill("Archiv");
    await app.getByRole("checkbox", { name: "Archiv A auswählen" }).check();
    await app.getByRole("checkbox", { name: "Archiv B auswählen" }).check();
    const remove = app.getByRole("button", { name: "2 Sessions löschen" });
    await remove.click();
    // Abbrechen im Base-Modal lässt alles stehen.
    await app.getByTestId("modal").getByRole("button", { name: "Abbrechen" }).click();
    await expect(app.locator(".session-card")).toHaveCount(3);
    const blocked = `**/api/sessions/${ids[1]}`;
    await app.route(blocked, (route) => route.fulfill({ status: 409, json: { error: "Workspace belegt" } }), { times: 1 });
    await remove.click();
    await app.getByTestId("modal").getByRole("button", { name: "Löschen" }).click();
    await expect(app.getByRole("alert")).toContainText("1 von 2 nicht gelöscht. Archiv B: Workspace belegt");
    await expect(app.locator(".session-card")).toHaveCount(2);
    await expect(app.getByRole("checkbox", { name: "Archiv B auswählen" })).toBeChecked();
    await app.getByRole("button", { name: "1 Session löschen" }).click();
    await app.getByTestId("modal").getByRole("button", { name: "Löschen" }).click();
    await expect(app.locator(".session-card")).toHaveCount(1);
    expect((await hub.sessions()).map((s) => s.id).sort()).toEqual([ids[2], ...active].sort());
    await search.clear();
    await app.getByRole("button", { name: "Alle sichtbaren auswählen" }).click();
    await app.getByRole("button", { name: "1 Session löschen" }).click();
    await app.getByTestId("modal").getByRole("button", { name: "Löschen" }).click();
    await expect(app.locator(".session-card")).toHaveCount(0);
    expect((await hub.sessions()).map((s) => s.id).sort()).toEqual(active);
  });

  test("Archivieren aus der Session heraus bringt das Handy in die Übersicht; die Karte ist weg", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByLabel("Weitere Aktionen").click();
    await app.locator(".session-menu").getByRole("button", { name: "Archivieren" }).click();
    await expect(app).toHaveURL(/#\/$/);
    await expect(app.locator(".session-card")).toHaveCount(0);
    expect((await hub.api<{ archived: boolean }>(`/api/sessions/${id}`)).body.archived).toBe(true);
  });

  test("Löschen entfernt eine gestoppte Session komplett — mit Rückfrage", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    app.on("dialog", (dialog) => void dialog.accept());
    await app.getByLabel("Weitere Aktionen").click();
    await app.locator(".session-menu").getByRole("button", { name: "Löschen" }).click();
    await expect(app).toHaveURL(/#\/$/);
    expect((await hub.sessions()).some((s) => s.id === id)).toBe(false);
    const gone = await hub.api(`/api/sessions/${id}/events`);
    expect(gone.status).toBe(404);
  });
});

test.describe("Freigaben (T2.4, T2.6)", () => {
  test.use({ hubOptions: { requireStepApprovals: true } });

  test("eine Antwort wartet auf Freigabe und kommt nach „Freigeben“ an", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Bitte freigeben");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".reply-error")).toContainText("pending approval");

    await app.getByLabel("Zur Übersicht").click();
    await openApprovals(app);
    const approval = app.locator(".approval-card").filter({ hasText: "Bitte freigeben" });
    await expect(approval.getByText("Bestätigung")).toBeVisible();
    const reason = approval.getByPlaceholder("Begründung (Pflicht)…");
    if (await reason.count()) await reason.fill("passt");
    await approval.getByRole("button", { name: "Freigeben" }).click();
    await hub.until(
      async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Bitte freigeben")),
      "approved prompt answered",
    );
    await expect(app.getByText("keine offenen Freigaben")).toBeVisible();
  });

  test("eine wartende Freigabe übersteht einen Hub-Absturz und läuft danach genau einmal (T7.3)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Nach dem Absturz" } });
    await hub.restart(); // SIGKILL — before T7.3 the queued prompt died with the process
    await app.reload();
    await openApprovals(app);
    const approval = app.locator(".approval-card").filter({ hasText: "Nach dem Absturz" });
    const reason = approval.getByPlaceholder("Begründung (Pflicht)…");
    if (await reason.count()) await reason.fill("passt");
    await approval.getByRole("button", { name: "Freigeben" }).click();
    await expect(approval.locator(".approval-outcome")).toHaveText("ausgeführt");
    await hub.until(
      async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Nach dem Absturz")),
      "approved prompt answered",
    );
    const answers = (await hub.events(id)).filter((e) => e.type === "assistant" && String(e.payload.text).includes("Nach dem Absturz"));
    expect(answers).toHaveLength(1);
  });

  test("„Ablehnen“ verwirft die Antwort", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Bitte ablehnen" } });
    await app.reload();
    await openApprovals(app);
    const approval = app.locator(".approval-card").filter({ hasText: "Bitte ablehnen" });
    await approval.getByRole("button", { name: "Ablehnen" }).click();
    await expect(app.getByText("keine offenen Freigaben")).toBeVisible();
    const answers = (await hub.events(id)).filter((e) => e.type === "assistant");
    expect(answers.map((e) => String(e.payload.text))).not.toContainEqual(expect.stringContaining("Bitte ablehnen"));
  });
});

test.describe("Budget (T2.7)", () => {
  test("eine Session über Budget pausiert und läuft nach Erhöhen weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Teuer", budgetUsd: 0.001 });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "parked", "budget park");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(statusPill(app)).toHaveAttribute("data-status", "parked");
    await sessionTab(app, "Bericht");
    await expect(app.getByText("Session wegen Budget pausiert.")).toBeVisible();
    await app.locator('input[type="number"]').fill("1");
    await app.getByRole("button", { name: "Budget erhöhen" }).click();
    await expect(app.getByText(/Budget erhöht|pending approval|Freigabe/)).toBeVisible();
  });
});

test.describe("Composer: Verbessern, Empfehlung, Skills (T3.9, T5.7–T5.10)", () => {
  test("Verbessern zeigt Original und Vorschlag und übernimmt ihn", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("mach die login seite schneller");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("mach die login seite schneller");
    await expect(preview).toContainText("Ziel: mach die login seite schneller");
    await expect(preview).toContainText("$0.0004");
    await app.getByRole("button", { name: "Verbessertes übernehmen" }).click();
    await expect(prompt).toHaveValue(/^Ziel: mach die login seite schneller\nScope:/);
    // A one-off prompt gets no skill suggestion (no draft that just copies it).
    await expect(app.locator(".recommend-card")).toHaveCount(0);
  });

  test("Verbessern geht auch für eine dsh-ACP-Registration unter freier ID (BUG-0061)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("deepseek");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("mach das mit dem login besser");
    // The button must be enabled at all: the hub said enhance:true for
    // this registration, the old hardcoded id list said no.
    await app.getByRole("button", { name: "Verbessern" }).click();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("mach das mit dem login besser");
    await expect(preview).toContainText("Ziel: mach das mit dem login besser");
    await app.getByRole("button", { name: "Verbessertes übernehmen" }).click();
    await expect(prompt).toHaveValue(/^Ziel: mach das mit dem login besser\nScope:/);
  });

  test("„Original senden“ behält den eigenen Text", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("bleib wie du bist");
    await app.getByRole("button", { name: "Verbessern" }).click();
    await app.getByRole("button", { name: "Original senden" }).click();
    await expect(prompt).toHaveValue("bleib wie du bist");
  });

  test("nach Verbessern kommt eine Empfehlung, die man verwerfen oder nutzen kann", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("Neon-Styling für die Oberfläche");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const card = app.locator(".recommend-card");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Verwerfen" }).click();
    await expect(card).toHaveCount(0);

    await app.getByRole("button", { name: "Verbessern" }).click();
    await expect(card).toBeVisible();
    const name = (await card.locator("strong").textContent())!.trim();
    await card.getByRole("button", { name: "Nutzen" }).click();
    await expect(prompt).toHaveValue(new RegExp(`^/${name}\\n\\n`));
  });

  test("Skills gibt es nur für Adapter mit Skill- oder Agent-Aufruf (ADR-0018)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("dummy");
    await expect(app.getByText("Skills/Agents: für diesen Adapter nicht verfügbar")).toBeVisible();
    await app.getByLabel("Adapter").selectOption("opencode");
    await expect(app.getByRole("button", { name: "+ Skill/Agent" })).toBeVisible();
  });

  test("ein Projekt-Skill lädt seine extends-Kette und zeigt sie im Chat (T5.10)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Mach es bunt", args: { skill: "neon" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText("Skills task → neon")).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Mach es bunt/)).toBeVisible();
  });

  test("Skill-Picker-Overlay für Claude: Skill wählen, starten, Kette im Chat (T7.8)", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("claude");
    await app.getByRole("button", { name: "+ Skill/Agent" }).click();
    const sheet = app.locator(".ui-sheet");
    await expect(sheet.getByText("Senden mit …")).toBeVisible();
    await sheet.getByRole("button", { name: /neon/ }).click();
    await expect(app.getByRole("button", { name: "Skill: neon" })).toBeVisible();
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Mach es bunt");
    await app.getByRole("button", { name: "Starten" }).click();
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText("Skills task → neon")).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Mach es bunt · Claude/)).toBeVisible();
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const created = (await hub.events(id)).find((e) => e.payload.kind === "session.created");
    expect(created?.payload.args).toMatchObject({ skill: "neon", skillChain: ["task", "neon"] });
  });
});

test.describe("Sprache (T1.5, T3.10)", () => {
  // Die Spracherkennung fragt das Mikrofon an; auf dem echten Handy öffnet das einen Berechtigungsdialog, den kein Test beantworten soll.
  test.skip(phone.active, "Mikrofon-Dialog: auf dem Handy nicht automatisierbar");
  test.beforeEach(async ({ page }) => installSpeechRecognition(page));

  test("Diktat füllt das Antwortfeld (Nyx-FAB)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    await app.evaluate(() => ((globalThis as unknown as { __speech: string }).__speech = "bitte weitermachen"));
    const fab = app.getByTestId("nyx-fab");
    await fab.click();
    await expect(app.getByTestId("nyx-fab-words")).toHaveText("bitte weitermachen");
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
    await fab.click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("bitte weitermachen");
  });

});

test.describe("Offline (K10, T8.2)", () => {
  // Die Handy-Läufe blockieren den Service Worker (wie `serviceWorkers: "block"`); der Offline-Stand kommt aus genau diesem Worker.
  test.skip(phone.active, "braucht den Service Worker, den die Handy-Läufe blockieren");
  test.use({ serviceWorkers: "allow" });

  // BUG-0163: Setzt voraus, dass der Service-Worker-Cache beim Offline-Gang
  // den letzten Online-Stand schon übernommen hat — auf langsamer Hardware
  // kann der Cache ~2 s hinterherhängen. K10 bleibt lokal verbindlich.
  test("BUG-0015/AC-P8-2: offline neu laden zeigt den letzten Stand mit seiner Zeit, keine Token-Eingabe, keine Mutation", async ({ app, hub }) => {
    test.skip(hostedRunner, "BUG-0163: Service-Worker-Cache-Herzschlag nur lokal schnell genug");
    const id = await hub.createSession({ adapter: "opencode", prompt: "Vor dem Flugmodus" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    // Let the service worker take control, then load once online (fills the cache).
    await app.evaluate(async () => {
      const nav = globalThis as unknown as { navigator: { serviceWorker: { ready: Promise<unknown> } } };
      await nav.navigator.serviceWorker.ready;
    });
    await app.reload();
    await expect(app.locator(".session-card")).toHaveCount(1);
    await app.locator(".session-open").click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Vor dem Flugmodus/)).toBeVisible();
    await app.waitForTimeout(1300); // tail cache is written after 1 s
    await app.getByLabel("Zur Übersicht").click();
    await expect(app.locator(".session-card")).toHaveCount(1);
    const before = Date.now();

    await app.context().setOffline(true);
    await app.waitForTimeout(1100);
    await app.reload();
    await expect(app.getByText("Device-Token")).toHaveCount(0);
    await expect(app.locator(".session-card")).toHaveCount(1);
    const stale = app.locator(".badge-stale").first();
    await expect(stale).toContainText("offline");
    // The time shown is when the data was fetched — not "now".
    const shown = (await stale.textContent()) ?? "";
    const hhmmss = /(\d{2}):(\d{2}):(\d{2})/.exec(shown);
    expect(hhmmss).not.toBeNull();
    const at = new Date(before);
    at.setHours(Number(hhmmss![1]), Number(hhmmss![2]), Number(hhmmss![3]));
    expect(at.getTime()).toBeLessThanOrEqual(before + 1000);

    // K10 (2026-11-12): der Badge ist klickbar — tippen lädt neu. Offline bleibt
    // die Meldung stehen und zeigt weiterhin denselben gespeicherten Stand.
    const firstShown = hhmmss![0];
    await app.locator("[data-testid=badge-refresh]").click();
    const again = app.locator("[data-testid=badge-refresh]");
    await expect(again).toContainText("offline");
    expect(/\d{2}:\d{2}:\d{2}/.exec((await again.textContent()) ?? "")![0]).toBe(firstShown);

    await app.locator(".session-open").click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Vor dem Flugmodus/)).toBeVisible();
    await expect(app.getByText("Offline — Senden ist gesperrt, dein Entwurf bleibt.")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Offline geschrieben");
    await expect(app.getByRole("button", { name: /^(Senden|Weiter)$/ })).toBeDisabled();

    await app.context().setOffline(false);
    await app.reload();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Offline geschrieben");
    await expect(app.getByText("Offline — Senden ist gesperrt, dein Entwurf bleibt.")).toHaveCount(0);
    // K10-Fix (2026-11-12): frische Daten lassen die Meldung verschwinden —
    // früher blieb sie stehen, weil nur das „online”-Event sie löschte.
    await expect(app.locator("[data-testid=badge-refresh]")).toHaveCount(0);
    // Nothing was sent while offline.
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
  });
});

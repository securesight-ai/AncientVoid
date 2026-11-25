import type { Page } from "@playwright/test";
import { test, expect, statusPill, dockGo, openQuiet, seeAll, sessionTab, cardAction, hostedRunner } from "../support/fixtures.ts";

/** BUG-0176: Der Klick auf „Starten“ darf nicht ins laufende Einwachsen des
 * Arbeitsort-Feldes fallen (Vorschau-Antwort verschiebt das Formular unterm
 * Zeiger) — erst warten, bis die Vorschau steht, dann klicken. */
async function startWhenPreviewSettled(app: Page): Promise<void> {
  const choice = app.locator("fieldset.workplace-choice");
  if (await choice.count()) {
    await expect(choice).toHaveAttribute("data-preview", /done|failed/);
  }
  await app.getByRole("button", { name: "Starten" }).click();
}

test.describe("Session anlegen und verfolgen (P1, P1.6)", () => {
  test("eine neue Session startet aus der UI und öffnet sich per Link @desktop", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await expect(app.getByRole("combobox", { name: "Projekt", exact: true })).toContainText("alpha (main)");
    await expect(app.getByRole("combobox", { name: "Projekt", exact: true })).toContainText("beta (main)");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Fasse die README zusammen");
    await startWhenPreviewSettled(app);

    await expect(app).toHaveURL(/#\/sessions\//);
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    await expect(app.locator(".session-topbar")).toContainText("alpha");
    await expect(app.locator(".session-topbar")).toContainText("opencode · e2e/fake-model");
    // 2026-10-26: host and model are always visible — the model from the
    // registration's default (hub.ts configures model for the e2e opencode),
    // the host from the fleet's own label (this machine's real hostname).
    const fleet = await hub.api<{ hosts: { hostId: string; self: boolean; label?: string }[] }>("/api/fleet");
    const selfLabel = fleet.body.hosts.find((h) => h.self)?.label;
    await expect(app.locator(".session-topbar")).toContainText(selfLabel ?? "dieser Rechner");
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Fasse die README zusammen · Session ses_e2e_/)).toBeVisible();
    await expect(app.getByText("Ich lese zuerst die README.")).toBeVisible();

    const [record] = await hub.sessions();
    expect(record?.id).toBe(id);
    expect(record?.adapter).toBe("opencode");
  });

  test("der Session-Tail verbindet sich nach einem Abbruch mit einem frischen Ticket", async ({ app, hub }) => {
    const prompt = "Tail nach Verbindungsabbruch";
    const id = await hub.createSession({ adapter: "opencode", prompt });
    const streamPath = `/api/events/${id}/tail`;
    const queries: URLSearchParams[] = [];
    await app.routeWebSocket((url) => url.pathname === streamPath, (route) => {
      queries.push(new URL(route.url()).searchParams);
      const upstream = route.connectToServer();
      if (queries.length === 1) {
        upstream.onMessage(() => route.close({ code: 1012 }));
      }
    });

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    await expect.poll(() => queries.length).toBe(2);
    for (const query of queries) {
      expect([...query.keys()]).toEqual(["ticket"]);
      expect(query.get("ticket")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(queries[1]?.get("ticket")).not.toBe(queries[0]?.get("ticket"));
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Tail nach Verbindungsabbruch/)).toBeVisible();
  });

  test("Projektauswahl zuerst: Pfad wird vorbelegt, folgt der Auswahl und bleibt überschreibbar @desktop", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    // Ohne Host-Auswahl kommt das Projekt vor Loop und Adapter, auch im zweispaltigen Formular.
    const project = app.getByRole("combobox", { name: "Projekt", exact: true });
    await expect(app.locator(".new-session-form label").first()).toContainText("Projekt");
    // Das vorausgewählte Projekt füllt den Pfad automatisch: Start ohne jede Pfad-Eingabe.
    const pfad = app.getByLabel("Pfad");
    await expect(pfad).toHaveValue(hub.alpha);
    // Anderes Projekt gewählt: der Pfad folgt der Auswahl.
    await project.selectOption(hub.beta);
    await expect(pfad).toHaveValue(hub.beta);
    // Manueller Override bleibt möglich — der eigene Pfad wird zur Session.
    await pfad.fill(hub.projectsDir);
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Ohne Pfadtippen gestartet");
    await startWhenPreviewSettled(app);
    await expect(app).toHaveURL(/#\/sessions\//);
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const detail = await hub.api<{ project: string }>(`/api/sessions/${id}`);
    expect(detail.body.project).toBe(hub.projectsDir);
  });

  test("Startprompt und eigene Antworten stehen im Chat, in Reihenfolge @desktop", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Mein Startprompt");
    await startWhenPreviewSettled(app);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Mein Startprompt/)).toBeVisible();
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.getByPlaceholder("Antworten…").fill("Meine Rückfrage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Meine Rückfrage/)).toBeVisible();
    const chat = await app.locator(".event.user, .event.assistant").allTextContents();
    const order = chat.map((t) => (t.includes("Antwort auf") ? "llm" : t.includes("Mein Startprompt") ? "start" : t.includes("Meine Rückfrage") ? "reply" : "?"));
    expect(order).toEqual(["start", "llm", "reply", "llm"]);
    await expect(app.locator(".event.user").first()).toContainText("Du");
  });

  test("⌘/Ctrl+Enter sendet die Antwort aus dem Eingabefeld (Tablet mit Tastatur) @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Tastatur Start" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const box = app.getByPlaceholder("Antworten…");
    await box.fill("Gesendet per Tastatur");
    // Plain Enter must stay a newline (one-handed phone use): the value
    // grows, nothing is sent.
    await box.press("Enter");
    await expect(box).toHaveValue("Gesendet per Tastatur\n");
    await box.press("Control+Enter");
    await expect(app.locator(".event.user").last()).toContainText("Gesendet per Tastatur");
    await expect(box).toHaveValue("");
  });

  test("jede Karte in der Übersicht nennt Projekt und Auftrag @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Workflow: release\n\nBaue die Punkteanzeige" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Ziel: Menü aufräumen\nScope: nur beta" });
    const alpha = app.locator(".session-card").filter({ hasText: "Baue die Punkteanzeige" });
    await expect(alpha.locator("[data-testid=session-project]")).toHaveText("alpha");
    const beta = app.locator(".session-card").filter({ hasText: "Menü aufräumen" });
    await expect(beta.locator("[data-testid=session-project]")).toHaveText("beta");
    await expect(beta).toContainText("opencode");
    // card shows the model (registration default) and the readable host too
    await expect(beta).toContainText("e2e/fake-model");
  });

  test("T8.1/EPIC-P43 T43.3: der Start ordnet nach „Du bist dran“ und „Ruhig“ und öffnet eine Session", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    const stopped = await hub.createSession({ adapter: "dummy", project: hub.beta });
    await hub.api(`/api/sessions/${stopped}/stop`, { body: {} });
    const waiting = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await seeAll(app, hub);
    await expect(app.locator(".section-title")).toHaveText([/Du bist dran/, /Ruhig/]);
    const need = app.locator(".section-braucht .session-card");
    await expect(need).toHaveCount(1);
    await expect(need.locator(".status")).toHaveText("Freigabe nötig");
    await expect(need.locator(".session-activity")).toContainText("Wartet auf Freigabe: Bash");
    // One tap from the overview to the waiting request (AC-P8-1).
    await need.locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${waiting}`));
    await expect(app.locator(".session-approvals .approval-card")).toBeVisible();
    await app.goBack();
    // „Ruhig“ ist zu, solange oben etwas steht.
    await expect(app.locator(".section-zuletzt .session-card")).toHaveCount(0);
    await openQuiet(app);
    await expect(app.locator(".section-zuletzt .session-card [data-testid=session-project]")).toHaveText(["alpha", "beta"]);
    await app.locator(".section-zuletzt .session-card").filter({ hasText: "alpha" }).locator(".session-open").click();
    await expect(app.locator(".session-topbar")).toContainText("alpha");
    await expect(app.locator(".session-topbar")).toContainText("dummy");
  });

  test("T8.1: jede Seite hat eine Adresse — Zurück im Browser geht zurück", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app).toHaveURL(/#\/neu$/);
    await dockGo(app, "Einstellungen");
    await expect(app).toHaveURL(/#\/einstellungen$/);
    await app.goBack();
    await expect(app).toHaveURL(/#\/neu$/);
    await expect(app.getByRole("button", { name: "Starten" })).toBeVisible();
    await app.goBack();
    await expect(app.locator(".session-card")).toHaveCount(1);
    await app.locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}$`));
    await app.reload();
    await expect(app.locator(".session-topbar")).toContainText("dummy");
    await app.goBack();
    await expect(app.locator(".dashboard")).toBeVisible();
  });

  // BUG-0282: Am Handy führt der Übersicht-Knopf immer in die Übersicht. Der
  // alte popView-Rückschritt merkte sich beim Zurückkehren die verlassene
  // Ansicht selbst wieder (main.tsx rememberView) und pendelte nach einem
  // In-Session-Sprung (Suche-Treffer, Forge-Link) zwischen den Sessions,
  // statt heimzukehren.
  test("BUG-0282: Übersicht-Knopf nach In-Session-Sprung zurück in die Übersicht", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Nadel Alpha" });
    await hub.createSession({ adapter: "dummy", prompt: "Nadel Beta" });
    await expect(app.locator(".session-card")).toHaveCount(2);
    await app.locator(".session-card").filter({ hasText: "Nadel Alpha" }).locator(".session-open").click();
    await expect(app.locator(".session-topbar")).toContainText("Nadel Alpha");
    const overviewBtn = app.getByLabel("Zur Übersicht");
    await expect(overviewBtn.locator(".tab-icon")).toBeVisible();
    await sessionTab(app, "Suche");
    await app.locator(".search-input").fill("Nadel Beta");
    await app.locator(".search-form button[type=submit]").click();
    await app.locator(".hit-group-title").filter({ hasText: "Nadel Beta" }).click();
    await expect(app.locator(".session-topbar")).toContainText("Nadel Beta");
    await overviewBtn.click();
    await expect(app.locator(".dashboard")).toBeVisible();
  });

  test("T8.6: anheften und umbenennen gilt auf allen Geräten", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Erster Auftrag" });
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    const card = app.locator(".session-card").filter({ hasText: "Erster Auftrag" });
    await cardAction(card, "Anheften");
    await expect(app.locator(".section-pins .session-card")).toHaveCount(1);
    expect((await hub.api<{ pinned: boolean }>(`/api/sessions/${id}`)).body.pinned).toBe(true);
    await hub.api(`/api/sessions/${id}/meta`, { body: { title: "Umbenannt" } });
    await expect(app.locator(".section-pins .session-title")).toHaveText("Umbenannt");
  });

  test("Verlauf filtert große Tool-Ergebnisse und merkt sich den Filter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lies alles GROSS" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".event.tool_use")).toHaveCount(1);
    await expect(app.locator(".event.tool_result")).toHaveCount(0);
    await app.getByRole("button", { name: "Debuggen" }).click();
    await expect(app.locator(".event.tool_result")).toHaveCount(1);
    // The filter is stored by an effect after render — wait for it, as a
    // user's reload never lands inside the same frame.
    await expect.poll(() => app.evaluate(() => localStorage.getItem("ancientvoid.filter"))).toBe("debuggen");
    await app.reload();
    await sessionTab(app, "Verlauf");
    await expect(app.getByRole("button", { name: "Debuggen" })).toHaveClass(/active/);
    await expect(app.locator(".event.tool_result")).toHaveCount(1);
  });

  test.describe("lange Session", () => {
    test.use({ hubOptions: { dummyAutoStop: 160 } });

    test("beim Öffnen steht das Ende da, nicht nur die ersten 100 Events (BUG-0026) @desktop", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "dummy done", 20_000);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await sessionTab(app, "Verlauf");
      await app.getByRole("button", { name: "Debuggen" }).click();
      await expect(app.getByText("dummy: auto-stop reached")).toBeVisible();
      const last = (await hub.events(id)).at(-1)!.seq;
      await expect(app.locator(`.event[data-seq="${last}"]`)).toHaveCount(1);
    });
  });

  // BUG-0163: Das API-Snapshot kann auf langsamer Hardware ein Event vor dem
  // Folge-Statusereignis gezogen werden (seq-Liste dann ±1) — der Dedup-
  // Kern (kein Duplikat, keine Lücke) bleibt lokal geprüft.
  test("jedes Event erscheint genau einmal, auch beim Öffnen mitten im Lauf (BUG-0023)", async ({ app, hub }) => {
    test.skip(hostedRunner, "BUG-0163: API-Snapshot-Race nur auf langsamer Hardware aussagekräftig");
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    await app.getByRole("button", { name: "Debuggen" }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "dummy done");
    const api = (await hub.events(id)).map((e) => e.seq);
    await expect.poll(() => app.locator(".event[data-seq]").evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-seq"))))).toEqual(api);
  });

  test("ein Link auf eine andere Session zeigt nur deren Verlauf (BUG-0024)", async ({ app, hub }) => {
    const first = await hub.createSession({ adapter: "opencode", prompt: "Erste Session" });
    const second = await hub.createSession({ adapter: "opencode", prompt: "Zweite Session" });
    await app.goto(`${hub.origin}/#/sessions/${first}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Erste Session/)).toBeVisible();
    await app.evaluate((id) => ((globalThis as unknown as { location: { hash: string } }).location.hash = `#/sessions/${id}`), second);
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Zweite Session/)).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Erste Session/)).toHaveCount(0);
  });

  test("eine Karte klappt beim Antippen auf und zeigt Details", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    const card = app.locator(".event.tool_use").first();
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    await expect(card.locator(".event-detail")).toContainText("README.md");
  });

  test("ein Denkschritt am Längenlimit erscheint im Chat (T5.9)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Denk nur LIMIT" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/am Längenlimit aufgehört\. 3900 Tokens gingen ins Denken/)).toBeVisible();
  });

  test("der Bericht zeigt Kosten, Tokens und geänderte Dateien", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    const row = (label: string) => app.locator(".kv-row").filter({ hasText: label }).locator(".v");
    await expect(row("Kosten")).toContainText("$0.0012");
    await expect(row("Tokens")).toContainText("321");
    await expect(row("Dateien geändert")).toContainText("1");
  });

  test("T7.7: nicht gemeldete Kosten sind keine $0, geschätzte Tokens tragen ≈", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => typeof (e as { tokensEst?: number }).tokensEst === "number"), "dummy tokens");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    const row = (label: string) => app.locator(".kv-row").filter({ hasText: label }).locator(".v");
    await expect(row("Kosten")).toHaveText("nicht gemeldet");
    await expect(row("Kosten")).toHaveAttribute("title", /keine 0/);
    await expect(row("Tokens")).toContainText("≈ ");
    const record = (await hub.api<{ metrics: { cost: string; tokens: string } }>(`/api/sessions/${id}`)).body;
    expect(record.metrics).toMatchObject({ cost: "unknown", tokens: "estimated" });
  });

  test("der Diff zeigt die geänderte Datei der Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Diff");
    const file = app.locator(".diff-file-row").filter({ hasText: "e2e-change.txt" });
    await expect(file).toBeVisible();
    await expect(file.locator(".diff-add-count")).toHaveText("+1");
  });

  test("AC-P2-1: der Diff gliedert drei Commits als drei Abschnitte mit Betreff", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
    expect(workdir).toBeTruthy();
    // Drei echte Commits im Session-Worktree — wie eine Session, die pro
    // Schritt committet. Der Adapter selbst committet nicht (siehe Test
    // oben: e2e-change.txt erscheint uncommittet).
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const git = promisify(execFile);
    const identity = ["-c", "user.email=e2e@local", "-c", "user.name=E2E"];
    const subjects = ["feat: erster Schritt", "feat: zweiter Schritt", "fix: dritter Schritt"];
    for (const [i, subject] of subjects.entries()) {
      // Ein echter Inhalt pro Commit — `add -A` allein hätte ab dem
      // zweiten Commit nichts mehr zu committen.
      await writeFile(join(workdir, `schritt-${i}.txt`), `${subject}\n`);
      await git("git", ["-C", workdir, ...identity, "add", "-A"]);
      await git("git", ["-C", workdir, ...identity, "commit", "-qm", subject]);
    }
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Diff");
    const headings = app.locator(".diff-commit-heading");
    await expect(headings).toHaveCount(3);
    await expect(headings.nth(0)).toContainText("feat: erster Schritt");
    await expect(headings.nth(1)).toContainText("feat: zweiter Schritt");
    await expect(headings.nth(2)).toContainText("fix: dritter Schritt");
    // Die Datei des ersten Commits ist über die Sprungliste erreichbar …
    await expect(app.locator(".diff-file-row").filter({ hasText: "e2e-change.txt" })).toBeVisible();
    // … und weil alles committet ist, gibt es keinen uncommitteten Rest.
    await expect(app.getByText("Nicht committete Änderungen")).toHaveCount(0);
  });

  test("AC-P1-4: das gewählte Verlauf-Preset überlebt ein Neuladen der Seite", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "dummy reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Verlauf ist der Default-Tab, Standard-Preset ist „Überwachen“.
    const chips = app.locator(".filter-bar .chip");
    await expect(chips.filter({ hasText: "Überwachen" })).toHaveClass(/active/);
    await chips.filter({ hasText: "Debuggen" }).click();
    await expect(chips.filter({ hasText: "Debuggen" })).toHaveClass(/active/);
    // AC-P1-4: Reload-Persistenz durch localStorage („ancientvoid.filter“)
    // — der ursprüngliche P1-Rest, der nie durch einen echten Reload-Klick
    // beobachtet wurde.
    await app.reload();
    await expect(chips.filter({ hasText: "Debuggen" })).toHaveClass(/active/);
    await expect(chips.filter({ hasText: "Überwachen" })).not.toHaveClass(/active/);
  });

  test("BUG-0146: sobald das Preset sichtbar gewählt ist, ist es schon gespeichert", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "dummy reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const chips = app.locator(".filter-bar .chip");
    await expect(chips.filter({ hasText: "Überwachen" })).toHaveClass(/active/);
    // Ein Reload direkt nach dem Sichtbarwerden (unter Last im vollen Lauf passiert) darf nichts verlieren:
    // der Beobachter liest den Speicher in genau dem Moment, in dem die Taste aktiv wird.
    await app.evaluate(() => {
      const chip = [...document.querySelectorAll(".filter-bar .chip")].find((c) => c.textContent === "Debuggen")!;
      new MutationObserver((_records, observer) => {
        if (!chip.classList.contains("active")) return;
        (globalThis as unknown as { __storedAtActive?: string | null }).__storedAtActive = localStorage.getItem("ancientvoid.filter");
        observer.disconnect();
      }).observe(chip, { attributes: true, attributeFilter: ["class"] });
    });
    await chips.filter({ hasText: "Debuggen" }).click();
    await expect(chips.filter({ hasText: "Debuggen" })).toHaveClass(/active/);
    expect(await app.evaluate(() => (globalThis as unknown as { __storedAtActive?: string | null }).__storedAtActive)).toBe("debuggen");
  });

  test("die Suche findet Text in der Projekt-Doku und öffnet die Datei", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    const search = `/api/search?project=${encodeURIComponent(hub.alpha)}&q=Handbuch`;
    await expect.poll(async () => (await hub.api(search)).status).toBe(200);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Suche");
    await app.getByRole("button", { name: "Doku", exact: true }).click();
    await app.getByRole("searchbox").fill("Handbuch");
    const hit = app.locator(".search-result-card").filter({ hasText: "README.md" });
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await hit.click();
    // Der Satz steht auch im Suchtreffer: auf breiten Fenstern bleibt die Trefferliste neben der Datei sichtbar.
    // Die Datei öffnet gerendert als Markdown (Dokumentansicht, kein Code-Viewer) — der
    // Trefferabschnitt ist markiert und angesteuert.
    await expect(app.locator(".file-viewer .markdown").getByText("Das Handbuch beschreibt den Handoff zwischen PC und Handy.")).toBeVisible();
    await expect(app.locator(".doc-hit")).toBeVisible();
    await expect(app.locator(".file-gutter, .file-code")).toHaveCount(0);
  });

  test("ein Provider-Absturz bleibt im Verlauf sichtbar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte FEHLER" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    await expect(app.getByText("opencode: process exited with code 3")).toBeVisible();
    await expect(statusPill(app)).not.toHaveText("stopped");
  });
});

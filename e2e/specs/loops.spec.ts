import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P19 T19.6: die Loop-Auswahl im Start-Formular. Echte Loops (aSPARK-Factory, securesight-factory) ohne
 * eingerichteten Connector stehen sichtbar, aber gesperrt und begründet da; der Fake-Loop des Testkits ist startbar.
 */
test.describe("Loop / Dark Factory im Start-Formular", () => {
  test("aSPARK-Factory steht ohne Anbindung gesperrt und begründet in der Auswahl, securesight-factory ist wählbar @desktop", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    const loop = app.getByLabel("Loop", { exact: true });
    await expect(loop).toBeVisible();
    await expect(loop).toHaveValue("");
    // In der Test-Fixture ist securesight-factory angebunden (K7-Spec), aSPARK nicht.
    await expect(loop.locator("option")).toHaveText(["kein Loop", "aSPARK-Factory (nicht verbunden)", "securesight-factory", "fake-loop"]);
    await expect(loop.locator("option[value='aspark-factory']")).toHaveAttribute("disabled", "");
    await expect(loop.getByRole("option", { name: "securesight-factory" })).toBeEnabled();
    await expect(app.locator(".loop-reasons")).toContainText("aSPARK-Factory: nicht eingerichtet");
  });

  test("ohne Loop startet die Session wie bisher (AC-P19-5)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Loop", { exact: true })).toHaveValue("");
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("ohne Loop");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
  });

  test("ein Loop: Felder kommen vom Loop, die riskante Betriebsart braucht ein Häkchen, dann läuft er als Session", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    // Adapter/Modell/Modus entscheidet der Loop — die Felder verschwinden mit Begründung.
    await expect(app.getByLabel("Adapter")).toHaveCount(0);
    await expect(app.getByText("Adapter, Modell und Modus bestimmt der Loop selbst.")).toBeVisible();
    // Betriebsart: nie die riskante als Vorgabe.
    const betriebsart = app.getByLabel("Betriebsart");
    await expect(betriebsart).toHaveValue("ruhig");
    const start = app.getByRole("button", { name: "Starten" });
    // Die Linie ist eine Auswahl der vorhandenen; die erste ist voreingestellt.
    await expect(app.getByLabel("Line")).toHaveValue("alpha");
    await expect(start).toBeEnabled();
    // Riskant: ohne Häkchen kein Start.
    await betriebsart.selectOption("scharf");
    await expect(start).toBeDisabled();
    await expect(app.locator(".loop-block")).toContainText("braucht deine Bestätigung");
    await app.getByLabel("Außenwirkung bestätigen").check();
    await expect(start).toBeEnabled();
    await start.click();

    await expect(app).toHaveURL(/#\/sessions\//);
    const [record] = await hub.sessions();
    expect(record?.adapter).toBe("loop:fake-loop");
    await hub.until(async () => (await hub.events(record!.id)).some((e) => (e.payload as { kind?: string }).kind === "loop.info"), "loop.info");
    const info = (await hub.events(record!.id)).find((e) => (e.payload as { kind?: string }).kind === "loop.info");
    expect(info?.payload).toMatchObject({ line: "alpha", mode: "scharf" });
  });

  const startLoop = async (app: Page, goal = "") => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    if (goal) await app.getByPlaceholder("Refactore den Auth-Flow…").fill(goal);
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
  };

  test("Kopf-Abzeichen und Panel zeigen Betriebsart, Fortschritt und Gate; Pause und Betriebsart gehen an den Loop (T19.6)", async ({ app }) => {
    await startLoop(app);
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig");
    await expect(app.locator(".loop-panel")).toContainText("1 von 3 Aufgaben · bauen");
    await expect(app.locator("[data-testid=loop-gate]")).toContainText("policy: bestanden");
    await expect(app.locator(".loop-bar")).toHaveAttribute("aria-valuenow", "33");

    await app.getByRole("button", { name: "Pausieren" }).click();
    await expect(app.getByRole("button", { name: "Weiter" })).toBeVisible();
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig · pausiert");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.getByRole("button", { name: "Pausieren" })).toBeVisible();

    // Betriebsart mit Außenwirkung: ohne Bestätigung bleibt sie, wie sie war
    // (Rückfrage im Base-Modal statt Browser-Dialog).
    await app.getByLabel("Betriebsart des Loops").selectOption("scharf");
    await app.getByTestId("modal").getByRole("button", { name: "Abbrechen" }).click();
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig");
    await app.getByLabel("Betriebsart des Loops").selectOption("scharf");
    await app.getByTestId("modal").getByRole("button", { name: "OK" }).click();
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · scharf");
  });

  test("ein gestörter Loop fällt sofort auf: Abzeichen und Warnung mit Grund (T19.6)", async ({ app }) => {
    await startLoop(app, "FEHLER");
    await expect(app.locator(".loop-alert.bad")).toContainText("Loop gestört: offline");
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig · gestört");
  });

  test("Neues Repo anbinden: Felder und Token, abgelehntes Token bleibt im Formular, dann startet die Session auf der neuen Linie", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    await app.getByLabel("Line").selectOption("+neu");
    const start = app.getByRole("button", { name: "Starten" });
    await expect(app.locator(".loop-onboard")).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(app.locator(".loop-block")).toHaveText("Name der Linie fehlt");
    await app.getByLabel("Name der Linie").fill("beta");
    await expect(app.locator(".loop-block")).toHaveText("Repo-Token fehlt");
    const token = app.getByLabel("Repo-Token");
    await expect(token).toHaveAttribute("type", "password");

    await token.fill("falsch");
    await start.click();
    await expect(app.getByText("Der Token wurde abgelehnt")).toBeVisible();
    await expect(app).not.toHaveURL(/#\/sessions\//);
    expect(await hub.sessions()).toHaveLength(0);

    await token.fill("geheim");
    await start.click();
    await expect(app).toHaveURL(/#\/sessions\//);
    const [record] = await hub.sessions();
    expect(record?.adapter).toBe("loop:fake-loop");
    await hub.until(async () => (await hub.events(record!.id)).some((e) => (e.payload as { kind?: string }).kind === "loop.info"), "loop.info");
    const events = JSON.stringify(await hub.events(record!.id));
    expect(events).toContain('"line":"beta"');
    expect(events).not.toContain("geheim");
  });

  test("Anbindungs-Formular: Pflicht-Selects gelten als gewählt, der Start-Grund steht laut am Knopf (2026-10-30)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    await app.getByLabel("Line").selectOption("+neu");
    // „Art“ zeigt „Projekt“ an — und das zählt: der Start scheitert nie an „Art fehlt“.
    await expect(app.getByLabel("Art", { exact: true })).toHaveValue("projekt");
    const blocker = app.locator(".loop-block");
    await expect(blocker).toBeVisible();
    await expect(blocker).not.toContainText("Art fehlt");
    await expect(blocker).toContainText("Name der Linie fehlt");
    await expect(app.getByRole("button", { name: "Starten" })).toBeDisabled();
    // Der Grund ist eine Warnung am Knopf, kein graues Flüstern („es passiert nichts“).
    await expect(blocker).toHaveClass(/warn/);
  });

  test("Anbindungs-Formular: Projektpfad kommt aus der Projektauswahl, eigene Eingabe gewinnt (ADR-0045)", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    await app.getByLabel("Line").selectOption("+neu");
    const pfad = app.getByLabel("Projektpfad");
    // Der Pfad des oben gewählten Projekts steht sofort da — kein Tippen.
    await expect(pfad).toHaveValue(hub.alpha);
    const projekt = app.locator(".form-grid > label").first().locator("select");
    // Ein Wechsel der Projektauswahl oben zieht das Feld mit, solange unberührt.
    await projekt.selectOption(hub.beta);
    await expect(pfad).toHaveValue(hub.beta);
    // Die eigene Eingabe gewinnt und bleibt bei weiterem Projektwechsel.
    await pfad.fill("/eigener/pfad");
    await projekt.selectOption(hub.alpha);
    await expect(pfad).toHaveValue("/eigener/pfad");
  });

  test("Die zuletzt gestartete Loop-Auswahl steht beim nächsten Anlegen wieder da", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    await app.getByLabel("Line").selectOption("alpha");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Loop-Merken");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
    await app.getByLabel("Zur Übersicht").click();
    await app.getByRole("button", { name: "Neue Session" }).click();
    // T8.4-Familie: auch der Loop wird gemerkt — Line und Betriebsart gleich mit.
    await expect(app.getByLabel("Loop", { exact: true })).toHaveValue("fake-loop");
    await expect(app.getByLabel("Line")).toHaveValue("alpha");
    await expect(app.getByLabel("Betriebsart")).toHaveValue("ruhig");
  });

  test("K7: Hub-Neustart mitten im Loop — Zustand bleibt, nichts doppelt, nichts fehlt (echter securesight-Connector, AC-P19-3)", async ({ hub }) => {
    const { spawnSync } = await import("node:child_process");
    test.skip(spawnSync("python3", ["--version"], { stdio: "ignore" }).error !== undefined, "python3 fehlt");
    const { appendFileSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const project = join(hub.projectsDir, "securesight-demo");
    for (const d of ["scripts", ".harness/notify", ".harness/transcript", ".factory"]) mkdirSync(join(project, d), { recursive: true });
    writeFileSync(join(project, "scripts", "betrieb.py"), 'import json\nprint(json.dumps({"schema_version":"1","mode":"a","iteration":{"id":"7","status":"running"},"human_hold":{"active":False,"reason":None},"last_gates":{"result":"pass","at":"t"},"watchdog":{"running":True}}))\n');
    writeFileSync(join(project, ".factory", "progress.json"), JSON.stringify({ schema_version: "1", total: 4, done: 1, now: { story: "S-1", task: "T-1", phase: "bauen" } }));
    writeFileSync(join(project, ".harness", "notify", "20261028-1.json"), JSON.stringify({ schema_version: "1", escalation_level: "1", reason_ref: "gates-rot", at: "t", run_id: "r1" }));
    const transcript = join(project, ".harness", "transcript", "s1.ndjson");
    const line = (seq: number) => `${JSON.stringify({ schema_version: "2", at: "t", seq, session: "s1", role: "llm", kind: "assistant_text", detail: `Zug ${seq}`, source: "claude" })}\n`;
    writeFileSync(transcript, line(0));

    const res = await hub.api<{ id?: string }>("/api/sessions", { body: { project, loop: { id: "securesight-factory" } } });
    expect(res.status).toBe(201);
    const id = res.body.id!;
    const loopEvents = async () => (await hub.events(id)).filter((e) => String(e.payload.kind ?? "").startsWith("loop."));
    const count = async (kind: string) => (await loopEvents()).filter((e) => e.payload.kind === kind).length;
    await hub.until(async () => (await count("loop.info")) >= 1 && (await count("loop.notify")) >= 1, "Loop meldet sich");
    appendFileSync(transcript, line(1) + line(2));
    await hub.until(async () => (await count("loop.transcript")) === 2, "zwei Zeilen im Verlauf");
    const before = await loopEvents();

    const ms = await hub.restart("SIGKILL");
    console.info(`K7 Loop: Neustart bis Hub antwortet ${ms} ms`);
    expect(ms).toBeLessThan(3000); // AC-P19-3: Neustart < 3 s
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.recovered"), "Session wiederhergestellt");
    appendFileSync(transcript, line(3));
    await hub.until(async () => (await count("loop.transcript")) === 3, "neue Zeile nach dem Neustart");
    await new Promise((r) => setTimeout(r, 1500)); // Zeit für etwaige Doppelmeldungen

    const after = await loopEvents();
    // nichts fehlt: alles von vorher ist unverändert da; nichts doppelt: je Art genau wie vorher, nur die neue Zeile kommt dazu
    expect(after.slice(0, before.length).map((e) => [e.seq, e.summary])).toEqual(before.map((e) => [e.seq, e.summary]));
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)?.payload).toMatchObject({ kind: "loop.transcript", seq: 3, detail: "Zug 3" });
    expect(await count("loop.info")).toBe(1);
    expect(await count("loop.notify")).toBe(1);
    expect(await count("loop.progress")).toBe(before.filter((e) => e.payload.kind === "loop.progress").length);
  });
});

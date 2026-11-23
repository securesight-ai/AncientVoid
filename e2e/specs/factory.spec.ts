import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P26 T26.5 / ADR-0043: ein Factory-Lauf über den Hub startet zwei
 * verknüpfte Sessions — Treiber (Claude/maki, Factory-Skill mit dem
 * Auftrag) und Beobachter (Loop securesight-factory, Modus project). Die
 * Factory ist damit wie jede andere Session auswählbar und monitorbar.
 */
test.describe("Factory-Lauf über den Hub (T26.5, ADR-0043)", () => {
  test.use({ hubOptions: { maki: true } });
  test("@desktop Start im Dialog legt Treiber mit /factory-Auftrag und verknüpften Beobachter an", async ({ app, hub }) => {
    // Ein Factory-Projekt im Modus `project`: .factory/config.json, kein betrieb.py.
    const project = join(hub.projectsDir, "factory-demo");
    mkdirSync(join(project, ".factory"), { recursive: true });
    writeFileSync(join(project, ".factory", "config.json"), "{}\n");
    // Wie nach echtem `factory init`: ein Intake-Zustand, den der Beobachter melden kann.
    mkdirSync(join(project, ".factory", "intake"), { recursive: true });
    writeFileSync(join(project, ".factory", "intake", "state.json"), JSON.stringify({ schema_version: "1", status: "intake", execution_ready: false, next_action: "erste Aufgabe festlegen" }));
    execSync("git init -q", { cwd: project }); // nur so taucht das Projekt in der Auswahl auf (Tiefe 1, .git)

    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByRole("combobox", { name: "Projekt", exact: true }).selectOption(project);
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("AncientVoid-Rename vorbereiten");
    await app.getByRole("button", { name: "Starten" }).click();

    // Der Dialog öffnet den Treiber-Chat auf dem tatsächlichen Host.
    await expect(app).toHaveURL(/#\/(hosts\/[^/]+\/)?sessions\//);
    const openedId = decodeURIComponent(app.url().match(/sessions\/([^/?]+)/)![1]!);
    await expect(app.locator(".session-top-title")).toContainText("Factory · AncientVoid-Rename vorbereiten");
    const all = (await hub.api<{ id: string; adapter: string; title: string }[]>("/api/sessions")).body;
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === openedId)?.adapter).toBe("claude");
    await expect(app.getByRole("button", { name: "Starten", exact: true })).toHaveCount(0);
    const observerId = all.find((s) => s.adapter === "loop:securesight-factory")!.id;
    expect(all.find((s) => s.id === observerId)?.title).toContain("Factory-Beobachter");
    const observer = (await hub.api<{ adapter: string; project: string }>(`/api/sessions/${observerId}`)).body;
    expect(observer.adapter).toBe("loop:securesight-factory");
    expect(observer.project).toBe(project);

    // Der Treiber trägt den Auftrag als /factory-Prompt und ist mit dem
    // Beobachter verknüpft (factory.linkage auf beiden Sessions).
    const sessions = (await hub.api<{ id: string; adapter: string }[]>("/api/sessions")).body;
    const driver = sessions.find((s) => s.adapter === "claude" && s.id !== observerId);
    expect(driver).toBeDefined();
    const driverEvents = await hub.events(driver!.id);
    expect(driverEvents.some((e) => e.type === "user" && String((e.payload as { text?: string }).text ?? "").startsWith("/factory AncientVoid-Rename vorbereiten"))).toBe(true);
    const linkOf = (events: Awaited<ReturnType<typeof hub.events>>) => events.find((e) => (e.payload as { kind?: string }).kind === "factory.linkage");
    expect((linkOf(driverEvents)?.payload as { factory?: { partner?: string } }).factory?.partner).toBe(observerId);
    expect((linkOf(await hub.events(observerId))?.payload as { factory?: { partner?: string } }).factory?.partner).toBe(driver!.id);

    // Der Beobachter meldet sich aus dem Projekt (Intake sichtbar, kein Stillstand).
    await hub.until(async () => (await hub.events(observerId)).some((e) => (e.payload as { kind?: string }).kind === "loop.info" || (e.payload as { kind?: string }).kind === "loop.broken"), "Beobachter meldet sich", 20_000);
    // Bereits vorhandene Beobachter ohne Titel bleiben verständlich benannt.
    await hub.api(`/api/sessions/${observerId}/meta`, { method: "POST", body: { title: null } });
    await app.goto(hub.origin);
    await expect(app.locator(".session-card").filter({ hasText: "loop:securesight-factory" })).toContainText("Factory-Beobachter");
  });
  test("@desktop maki-Auswahl bleibt beim Factory-Start erhalten und verlinkt den Fortschritt", async ({ app, hub }) => {
    const project = join(hub.projectsDir, "factory-maki");
    mkdirSync(join(project, ".factory"), { recursive: true });
    writeFileSync(join(project, ".factory/config.json"), "{}");
    mkdirSync(join(project, ".claude/skills/factory"), { recursive: true });
    writeFileSync(join(project, ".claude/skills/factory/SKILL.md"), "# Factory\nPrüfe factory progress show.");
    execSync("git init -q", { cwd: project });
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByRole("combobox", { name: "Adapter", exact: true }).selectOption("maki");
    await expect(app.getByRole("combobox", { name: "Modell", exact: true })).toHaveValue("lokal/klein");
    await app.getByRole("combobox", { name: "Modell", exact: true }).selectOption("lokal/glm-5.3");
    await app.getByRole("combobox", { name: "Projekt", exact: true }).selectOption(project);
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await expect(app.getByRole("combobox", { name: "Factory-Treiber", exact: true })).toHaveValue("maki");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Produkt bauen");
    await app.getByRole("button", { name: "Starten", exact: true }).click();
    await expect(app).toHaveURL(/sessions\//);
    const records = (await hub.api<{ id: string; adapter: string; model: string }[]>("/api/sessions")).body;
    const driver = records.find((s) => s.adapter === "maki")!;
    expect(driver.model).toBe("lokal/glm-5.3");
    expect(app.url()).toContain(driver.id);
    await expect(app.getByRole("button", { name: "Starten", exact: true })).toHaveCount(0);
    await app.getByRole("link", { name: "Fortschritt öffnen", exact: true }).click();
    await expect(app.getByRole("link", { name: "Treiber-Chat öffnen", exact: true })).toBeVisible();
    const duplicate = await hub.api("/api/factory/start", { method: "POST", body: { project, adapter: "maki" } });
    expect(duplicate.status).toBe(409);
    expect((await hub.api<unknown[]>("/api/sessions")).body).toHaveLength(2);
  });

  test("@desktop eine ersetzte Treiber-Wahl wird gesagt, nicht still getauscht (BUG-0105, EPIC-P35 T35.2)", async ({ app, hub }) => {
    const project = join(hub.projectsDir, "factory-notice");
    mkdirSync(join(project, ".factory"), { recursive: true });
    writeFileSync(join(project, ".factory/config.json"), "{}");
    execSync("git init -q", { cwd: project });

    await app.getByRole("button", { name: "Neue Session" }).click();
    // Zuerst codex wählen (ohne Loop ist jeder Adapter wählbar), dann den
    // Factory-Loop: nur claude/maki sind Treiber — die Ersetzung muss anstehen.
    await app.getByRole("combobox", { name: "Adapter", exact: true }).selectOption("codex");
    await app.getByRole("combobox", { name: "Projekt", exact: true }).selectOption(project);
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await expect(app.getByRole("combobox", { name: "Factory-Treiber", exact: true })).toHaveValue("claude");
    await expect(app.getByRole("status").filter({ hasText: "codex" })).toContainText("claude oder maki");
  });
});

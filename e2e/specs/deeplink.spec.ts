import { test, expect, sessionTab } from "../support/fixtures.ts";

test.describe("Deep-Link und Attach (AC-P5-5)", () => {
  test("ein Session-Link öffnet nach Reload dieselbe Session @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-topbar")).toContainText("dummy");
    await app.reload();
    await expect(app.locator(".session-topbar")).toContainText("dummy");
    expect(app.url()).toContain(`#/sessions/${id}`);
  });

  test("ein unbekannter Link landet in der Übersicht", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/sessions/gibt-es-nicht`);
    await expect(app.getByRole("heading", { name: "Noch keine Sessions" })).toBeVisible();
  });

  test("#/gefunden ist kein eigener Page-Slug mehr, sondern der Alias auf den Discovery-Zustand der Übersicht (EPIC-P47 §3.4)", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/gefunden`);
    await expect(app.locator(".discovery")).toBeVisible();
    await expect(app.locator("[data-testid=overview-switch-btn]")).toHaveCount(3); // „Gefunden“ ist kein Tab (Nutzerentscheid 2026-11-21)
  });

  test("ohne tmux gibt es nie einen Attach-Befehl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-list")).toBeVisible();
    await expect(app.locator("[data-testid=attach-cmd-card]")).toHaveCount(0);
  });

  test.describe("mit tmux-Worker", () => {
    test.use({ hubOptions: { runner: "tmux" } });

    test("Attach nur, solange ein Worker läuft", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "worker running");
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await sessionTab(app, "Bericht");
      await expect(app.locator("[data-testid=attach-cmd-card] code")).toHaveText(`tmux attach -t ancientvoid-${id}`);
      await app.getByRole("button", { name: "Stop" }).click();
      await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "stopped");
      await expect(app.locator("[data-testid=attach-cmd-card]")).toHaveCount(0);
    });
  });

  test("zwischen zwei Zügen gibt es den Terminal-Befehl für dieselbe Provider-Session (T5.5) @desktop", async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const native = (await hub.api<{ nativeSessionId: string }>(`/api/sessions/${id}`)).body.nativeSessionId;
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    await expect(app.locator("[data-testid=continue-open]")).toHaveText(`cd ${workdir} && opencode --session ${native}`);
    await expect(app.locator("[data-testid=continue-link]")).toHaveText(`${hub.origin}/#/sessions/${id}`);
    await app.locator("[data-testid=continue-card] .attach-cmd-row").last().getByRole("button", { name: "Kopieren" }).click();
    await expect(app.locator("[data-testid=continue-card]").getByRole("button", { name: "Kopiert" })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText())).toBe(
      `cd ${workdir} && opencode --session ${native}`,
    );
  });

  test("während ein Zug läuft, gibt es keinen Terminal-Befehl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "turn running");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    await expect(app.locator("[data-testid=continue-none]")).toBeVisible();
    await expect(app.locator("[data-testid=continue-open]")).toHaveCount(0);
    await expect(app.locator("[data-testid=continue-link]")).toContainText(`#/sessions/${id}`);
  });

  test("der Bericht sagt, wo die Änderungen liegen (Worktree statt Projektordner)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
    expect(workdir).not.toBe(hub.alpha);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    await expect(app.locator("[data-testid=worktree-card]")).toContainText(`ancientvoid/${id}`);
    await expect(app.locator("[data-testid=worktree-card]")).toContainText("nicht in alpha");
    await expect(app.locator("[data-testid=worktree-path]")).toHaveText(workdir);
    await expect(app.locator("[data-testid=worktree-open]")).toHaveText(`code ${workdir}`);

    await app.getByRole("button", { name: "Stop" }).click();
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "stopped");
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.worktree_kept"), "worktree kept");
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${workdir}/e2e-change.txt`), "the agent's file survived Stop (BUG-0027)").toBe(true);
  });

  test("„Ins Projekt übernehmen“ bringt die Arbeit der Session in den Projektordner", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const { existsSync, readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    expect(existsSync(`${hub.alpha}/e2e-change.txt`)).toBe(false);

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Bericht");
    await app.getByRole("button", { name: "Ins Projekt übernehmen" }).click();
    await expect(app.locator(".apply-confirm")).toContainText("in den ausgecheckten Branch von alpha");
    await app.getByRole("button", { name: "Jetzt übernehmen" }).click();
    await expect(app.locator(".apply-result.ok")).toContainText("nach main");
    expect(readFileSync(`${hub.alpha}/e2e-change.txt`, "utf8")).toContain("geändert durch E2E");
    expect(execFileSync("git", ["-C", hub.alpha, "log", "--format=%s", "-1"], { encoding: "utf8" })).toContain("AncientVoid: Lege eine DATEI an");
    await expect(app.locator(".toast.success").filter({ hasText: "ins Projekt übernommen" })).toBeVisible();

    await app.getByRole("button", { name: "Ins Projekt übernehmen" }).click();
    await app.getByRole("button", { name: "Jetzt übernehmen" }).click();
    await expect(app.locator(".apply-result.reply-error")).toHaveText("Keine Änderungen zum Übernehmen.");
  });
});

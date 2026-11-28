import { win32 } from "node:path";
import { realpath } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { LOOP_ARG, loopAdapterId } from "@ancientvoid/contracts";
import { isProjectPathAllowed, ensureProjectDir, toStartSpec, resolveSkillChain } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

const FACTORY_LOOP = "securesight-factory";
/** Rückwärtskompatibler Standard; maki bekommt den Skill als Prompt statt als Slash. */
const DRIVER_ADAPTER = "claude";

/**
 * EPIC-P26 T26.5 / ADR-0043: ein Factory-Lauf beginnt mit zwei verknüpften
 * Sessions — Treiber (Claude/maki im Projektverzeichnis, Factory-Skill)
 * und Beobachter (Loop securesight-factory, Modus `project`, schreibt nichts).
 * Verknüpfung: `options.driver` im Loop-Snapshot (K7) plus `factory.linkage`-
 * Ereignis auf beiden Sessions. Scheitert der Beobachter, wird der Treiber
 * wieder beendet — kein halbgareller Lauf. Policy `factory.start`: nur Menschen.
 */
/** T26.6 / ADR-0043 §Steuerung: feste Allowlist, nur Menschen (Policy `factory.control`). */
const FACTORY_COMMANDS = ["end_run", "resume", "set_mode"] as const;
type FactoryCommand = (typeof FACTORY_COMMANDS)[number];
/** Betriebsart mit Außenwirkung: `a` merged automatisch (docs/factory-schnittstelle.md). */
const RISKY_MODUS = "a";
const REFUSED: Record<string, string> = {
  notify_ack: "notify-ack gibt es nur im Modus repo (betrieb.py) und ist im Projektmodus nicht angebunden",
};

export function registerFactoryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const starting = new Set<string>();
  const { deps, hostId, projectRoots, catalogRootFor, callerLabel } = ctx;

  app.post<{ Body: { project?: unknown; goal?: unknown; adapter?: unknown; model?: unknown } }>("/api/factory/start", async (req, reply) => {
    const { project, goal, adapter = DRIVER_ADAPTER, model } = req.body ?? {};
    if (adapter !== "claude" && adapter !== "maki") return reply.code(400).send({ error: "Factory-Treiber muss claude oder maki sein" });
    if (model !== undefined && (typeof model !== "string" || !model.trim())) return reply.code(400).send({ error: "model muss Text sein" });
    if (typeof project !== "string" || !project.trim()) return reply.code(400).send({ error: "project fehlt" });
    if (goal !== undefined && typeof goal !== "string") return reply.code(400).send({ error: "goal muss Text sein" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // BUG-0171: auch ein Factory-Start darf einen noch fehlenden Ordner innerhalb
    // einer erlaubten Wurzel anlegen (eine Ebene), statt falsch "outside roots" zu melden.
    try {
      await ensureProjectDir(project, projectRoots);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "Projektpfad nicht verwendbar" });
    }
    const loopSpec = { id: FACTORY_LOOP, options: { anbindung: "bestehend" } };
    try {
      ctx.loops.assertStartable(loopSpec);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "loop not startable" });
    }
    const root = await realpath(project);
    const active = deps.sessions.list().find((s) => s.project === root && s.adapter === loopAdapterId(FACTORY_LOOP) && !["stopped", "error", "interrupted"].includes(s.status));
    if (starting.has(root) || active) return reply.code(409).send({ error: "Für dieses Projekt läuft bereits eine Factory. Öffne den bestehenden Lauf.", ...(active ? { observerId: active.id } : {}) });
    starting.add(root);
    try {
      const actor = callerLabel(req) ?? undefined;
      await catalogRootFor(root);
      try {
        // 1. Treiber — normaler Prompt-Weg, kein Sonderkanal (ADR-0043 1.).
        const command = goal?.trim() ? `/factory ${goal.trim()}` : "/factory";
        const skill = adapter === "maki" ? await resolveSkillChain(root, "factory") : null;
        if (adapter === "maki" && !skill) return reply.code(422).send({ error: "Factory-Skill fehlt im Projekt; zuerst factory init ausführen" });
        const driver = await deps.sessions.create(
          { adapter, project: root, prompt: command, ...(skill ? { args: { skill: "factory" } } : {}), ...(model ? { model } : {}) },
          actor,
          { workInProject: true },
        );
        const label = (goal?.trim().split("\n")[0] || win32.basename(root) || "Lauf");
        await deps.sessions.setMeta(driver.id, { title: `Factory · ${label}`.slice(0, 120) });
        try {
          // 2. Beobachter — Verknüpfung in options.driver, damit sie im Loop-Snapshot überlebt (K7).
          const observer = await deps.sessions.create(
            {
              adapter: loopAdapterId(FACTORY_LOOP),
              project: root,
              title: `Factory-Beobachter · ${label}`.slice(0, 120),
              args: { [LOOP_ARG]: toStartSpec({ ...loopSpec, options: { ...loopSpec.options, driver: driver.id } }, { project: root, goal }) },
            },
            actor,
          );
          // 3. Verknüpfung sichtbar machen — auf beiden Sessions, aus JSONL rekonstruierbar.
          await Promise.all([
            deps.sessions.recordHubEvents(driver.id, [
              { type: "system", summary: `Factory-Lauf: Treiber, Beobachter ${observer.id}`, payload: { kind: "factory.linkage", factory: { role: "driver", partner: observer.id } } },
            ]),
            deps.sessions.recordHubEvents(observer.id, [
              { type: "system", summary: `Factory-Lauf: Beobachter, Treiber ${driver.id}`, payload: { kind: "factory.linkage", factory: { role: "observer", partner: driver.id } } },
            ]),
          ]);
          return reply.code(201).send({ driver: { ...deps.sessions.get(driver.id), hostId }, observer: { ...observer, hostId }, hostId });
        } catch (err) {
          await deps.sessions.steer(driver.id, { kind: "stop" }, actor).catch(() => undefined);
          return reply.code(422).send({ error: `Beobachter konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}` });
        }
      } catch (err) {
        return reply.code(422).send({ error: err instanceof Error ? err.message : "factory start failed" });
      }
    } finally {
      starting.delete(root);
    }
  });
  /** Verknüpfung (Treiber ↔ Beobachter) aus dem JSONL lesen (K7) — nie aus dem Speicher geraten. */
  async function linkageOf(id: string): Promise<{ driver: string; observer: string } | null> {
    const events = await deps.sessions.tail(id, 0, 200);
    for (const e of events) {
      const p = e.payload as { kind?: string; factory?: { role?: string; partner?: string } };
      if (p.kind !== "factory.linkage" || typeof p.factory?.partner !== "string") continue;
      return p.factory.role === "driver" ? { driver: id, observer: p.factory.partner } : { driver: p.factory.partner, observer: id };
    }
    return null;
  }

  app.post<{ Params: { id: string }; Body: { command?: unknown; confirm?: unknown; modus?: unknown; provider?: unknown } }>("/api/factory/:id/command", async (req, reply) => {
    const { id } = req.params;
    const { command, confirm, modus, provider } = req.body ?? {};
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const actor = callerLabel(req) ?? "unbekannt";
    const link = await linkageOf(id);
    if (!link) return reply.code(422).send({ error: "Diese Session gehört zu keinem Factory-Lauf" });
    const audit = (outcome: string, detail?: string) =>
      Promise.all(
        [link.driver, link.observer].map((sid) =>
          deps.sessions.recordHubEvents(sid, [
            { type: "system", summary: `Factory-Befehl ${String(command)}: ${outcome}`, payload: { kind: "factory.command", factory: { command: String(command).slice(0, 40), actor, outcome, ...(detail ? { detail: detail.slice(0, 200) } : {}) } } },
          ]),
        ),
      ).then(() => undefined);

    if (typeof command !== "string" || !(FACTORY_COMMANDS as readonly string[]).includes(command)) {
      const reason = (typeof command === "string" && REFUSED[command]) || "Befehl nicht in der Allowlist (end_run, resume, set_mode)";
      await audit("abgelehnt", reason);
      return reply.code(422).send({ error: reason });
    }
    const cmd = command as FactoryCommand;

    if (cmd === "end_run") {
      // Beide Sessions: endet nur der Treiber, zeigte der Beobachter sonst einen Lauf, den es nicht mehr gibt.
      const acks = await Promise.all([link.driver, link.observer].map((sid) => deps.sessions.stop(sid, actor).catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }))));
      const failed = acks.filter((a) => !a.ok);
      await audit(failed.length ? "teilweise" : "ok", failed.map((a) => a.detail).join("; "));
      return reply.code(failed.length === acks.length ? 422 : 200).send({ ok: failed.length === 0, ...(failed.length ? { detail: failed.map((a) => a.detail).join("; ") } : {}) });
    }

    if (cmd === "resume") {
      const ack = await deps.sessions.steer(link.driver, { kind: "prompt", text: "/factory" }, actor).catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }));
      await audit(ack.ok ? "ok" : "fehlgeschlagen", ack.detail);
      return reply.code(ack.ok ? 200 : 422).send(ack);
    }

    // set_mode: nur Projektmodus — `factory init --reconfigure`, der Hub schreibt selbst nichts ins Projekt.
    if (modus !== "a" && modus !== "b") return reply.code(400).send({ error: "modus a oder b fehlt" });
    if (provider !== "anthropic" && provider !== "zai") return reply.code(400).send({ error: "provider anthropic oder zai fehlt" });
    if (modus === RISKY_MODUS && confirm !== true) {
      await audit("bestätigung fehlt", `modus ${modus}`);
      return reply.code(409).send({ error: "Betriebsart a merged automatisch (Außenwirkung) und braucht eine Bestätigung", needsConfirm: true });
    }
    const observer = deps.sessions.get(link.observer);
    const connector = ctx.loops.connector(FACTORY_LOOP);
    if (!observer || !connector?.onboard) return reply.code(422).send({ error: "Der Beobachter-Loop kann nicht rekonfiguriert werden" });
    const result = await connector.onboard({ options: { root: observer.project, modus, provider, reconfigure: "1" } }, AbortSignal.timeout(120_000));
    await audit(result.ok ? "ok" : "fehlgeschlagen", `modus ${modus}${result.detail ? ` · ${result.detail}` : ""}`);
    return reply.code(result.ok ? 200 : 422).send(result);
  });
}

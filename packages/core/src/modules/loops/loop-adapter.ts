import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { basicFeatures, loopAdapterId } from "@ancientvoid/contracts";
import type { Ack, Adapter, AdapterCapabilities, AdapterContext, HealthReport, LoopConnector, LoopSessionStarter, LoopStartSpec, SessionHandle, SessionSpec, SteerInput } from "@ancientvoid/contracts";

interface Snapshot {
  spec: LoopStartSpec;
  cursor: unknown;
}

/**
 * ADR-0038 §2: ein Loop-Lauf ist eine Hub-Session. Dieser Shim zeigt einen LoopConnector dem SessionManager als
 * Adapter (`loop:<id>`), damit EventStore, Recovery, Freigaben, Push und PWA ohne Umbau laufen.
 * Der Snapshot (Startvorgabe + Leseposition) liegt je Session unter `stateDir` — der Recovery-Pfad für K7:
 * nach einem Hub-Neustart liest der Connector ab dieser Position weiter, nichts doppelt, nichts fehlt.
 */
export function loopAsAdapter(connector: LoopConnector, opts: { stateDir: string; startSession?: LoopSessionStarter }): Adapter {
  const file = (sessionId: string) => join(opts.stateDir, `${sessionId}.json`);
  const cursors = new Map<string, unknown>();
  const specs = new Map<string, LoopStartSpec>();
  const caps = connector.capabilities();

  // Schreibvorgänge je Session nacheinander: zwei gleichzeitige hätten dieselbe Temp-Datei.
  const writes = new Map<string, Promise<void>>();
  const save = (sessionId: string): Promise<void> => {
    const run = async (): Promise<void> => {
      const spec = specs.get(sessionId);
      if (!spec) return;
      await mkdir(opts.stateDir, { recursive: true });
      const tmp = `${file(sessionId)}.tmp`;
      await writeFile(tmp, JSON.stringify({ spec, cursor: cursors.get(sessionId) ?? null } satisfies Snapshot), "utf8");
      await rename(tmp, file(sessionId));
    };
    const next = (writes.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(run);
    writes.set(sessionId, next);
    return next;
  };

  const open = async (sessionId: string, spec: LoopStartSpec, resume: unknown, ctx: AdapterContext): Promise<SessionHandle> => {
    specs.set(sessionId, spec);
    cursors.set(sessionId, resume);
    return connector.start(spec, ctx, {
      resume,
      saveCursor: (cursor) => {
        cursors.set(sessionId, cursor);
        void save(sessionId).catch((err) => ctx.log("warn", "loop snapshot not written", { error: String(err) }));
      },
      ...(opts.startSession ? { startSession: opts.startSession } : {}),
    });
  };

  return {
    id: loopAdapterId(connector.id),
    version: connector.version,

    capabilities(): AdapterCapabilities {
      const can = (c: (typeof caps.controls)[number]) => caps.controls.includes(c);
      return {
        reasoning: false,
        tools: false,
        cost: false,
        steer: can("workNext") || can("pause"),
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({
          followUp: can("workNext"),
          interrupt: can("pause"),
          // Fragen des Loops laufen über ctx.requestToolPermission (Freigaben-Ansicht).
          toolGate: caps.asks === "none" ? "none" : "native",
          questions: caps.asks === "permission+question",
          permissionModes: can("setMode") ? caps.modes : [],
        }),
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const raw = (spec.args as { loop?: Partial<LoopStartSpec> } | undefined)?.loop ?? {};
      const start: LoopStartSpec = {
        project: spec.project,
        ...(spec.prompt ? { goal: spec.prompt } : {}),
        ...(raw.mode ? { mode: raw.mode } : {}),
        ...(raw.orchestrator ? { orchestrator: raw.orchestrator } : {}),
        options: raw.options ?? {},
      };
      const handle = await open(ctx.sessionId, start, null, ctx);
      await save(ctx.sessionId);
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      switch (input.kind) {
        case "prompt":
          return connector.control(handle, { kind: "workNext", text: input.text }, ctx);
        case "park":
          return connector.control(handle, { kind: "pause" }, ctx);
        case "resume":
          return connector.control(handle, { kind: "resume" }, ctx);
        case "configure":
          if (input.permissionMode) return connector.control(handle, { kind: "setMode", mode: input.permissionMode }, ctx);
          return { ok: false, detail: "Ein Loop wählt Modell selbst — nur die Betriebsart ist änderbar" };
        case "stop":
          await connector.stop(handle, ctx);
          return { ok: true };
      }
    },

    status(handle: SessionHandle): Promise<HealthReport> {
      return connector.status(handle);
    },

    async stop(handle: SessionHandle, ctx: AdapterContext): Promise<void> {
      await connector.stop(handle, ctx);
      await (writes.get(handle.sessionId) ?? Promise.resolve()).catch(() => undefined);
      specs.delete(handle.sessionId);
      cursors.delete(handle.sessionId);
      writes.delete(handle.sessionId);
      await rm(file(handle.sessionId), { force: true });
    },

    /** K7: Startvorgabe und Leseposition aus dem Snapshot; ohne Snapshot ist die Session nicht wiederherstellbar. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      let snapshot: Snapshot;
      try {
        snapshot = JSON.parse(await readFile(file(sessionId), "utf8")) as Snapshot;
      } catch {
        ctx.log("warn", "loop snapshot missing — session not recoverable", { sessionId });
        return null;
      }
      return open(sessionId, snapshot.spec, snapshot.cursor, ctx);
    },
  };
}

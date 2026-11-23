import { describe, it, expect } from "vitest";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * BUG-0261: drei Pi-Laeufe auf derselben native Sitzung.
 *
 * Beobachtet 2026-11-23, 07:39/07:52/07:59 UTC, Sitzung 943797b3: drei
 * `pi -p --mode json --session <dieselbe Datei>`-Prozesse gleichzeitig. Jeder
 * hielt sich fuer den einzigen Agenten desselben Arbeitsverzeichnisses und
 * schrieb parallel in dasselbe Zifferblatt — Aenderungen ueberschrieben sich,
 * und der Hub meldete am Ende `session.turn_end reason:"error"` plus
 * `adapter.down`, weil der von ihm gefuehrte Prozess einem anderen gehoerte.
 *
 * Grundlage war ADR-0085: Pi setzte `midTurnInput: true` mit der Begruendung
 * „jeder Lenk-Aufruf ist ein eigener Lauf". Genau dieser eigene Lauf ist aber
 * ein **zweiter Prozess auf dieselbe native Session** — was ADR-0074 fuer
 * Claude & Co. ausdruecklich verbietet. Pi darf `midTurnInput` nicht
 * zusichern: lenken heisst bei Pi „im naechsten Zug".
 */

/** Ein Worker, der nicht von selbst endet: der Zug laeuft noch. */
function laufenderProzess(): WorkerProcess {
  return {
    onStdout: () => undefined,
    onStderr: () => undefined,
    onExit: () => undefined,
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise<{ code: number | null }>(() => undefined),
  };
}

function recording() {
  const spawned: string[][] = [];
  const ctx = makeRecordingContext({
    spawnWorker: async (cmd) => {
      spawned.push(cmd);
      return laufenderProzess();
    },
  });
  return { ctx, spawned };
}

describe("BUG-0261: Pi oeffnet keinen zweiten Lauf auf dieselbe native Sitzung", () => {
  it("sichert keine Mid-Turn-Eingabe zu — Lenken gilt bei Pi erst im naechsten Zug", () => {
    const caps = createAdapter({}).capabilities();
    expect(caps.promptDelivery).toBe("next-turn");
    expect(caps.midTurnInput).not.toBe(true);
  });

  it("lehnt eine Prompt-Eingabe waehrend eines laufenden Zug ab, statt neu zu starten", async () => {
    const adapter = createAdapter({});
    const { ctx, spawned } = recording();
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "erster Zug" }, ctx);

    const ack = await adapter.steer(handle, { kind: "prompt", text: "zweiter Auftrag" }, ctx);
    expect(ack.ok).toBe(false);
    expect(String(ack.detail ?? "")).toContain("läuft");
    // Der entscheidende Nachweis: es ist kein zweiter Pi-Prozess entstanden.
    expect(spawned).toHaveLength(1);
  });

  it("nach sauberem Zugende ist Lenken wieder normal moeglich", async () => {
    const adapter = createAdapter({});
    const spawned: string[][] = [];
    let beenden!: (code: number) => void;
    const proc: WorkerProcess = {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onExit: (cb) => { beenden = cb; },
      write: () => undefined,
      kill: async () => undefined,
      exited: () => new Promise<{ code: number | null }>(() => undefined),
    };
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return proc;
      },
    });
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "erster Zug" }, ctx);
    expect((await adapter.steer(handle, { kind: "prompt", text: "zu frueh" }, ctx)).ok).toBe(false);
    beenden(0);
    const spaet = await adapter.steer(handle, { kind: "prompt", text: "danach" }, ctx);
    expect(spaet.ok).toBe(true);
    expect(spawned).toHaveLength(2);
  });
});

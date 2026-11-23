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

  it("sperrt weitere Eingaben bereits bevor der Worker gestartet ist", async () => {
    const adapter = createAdapter({});
    let finish!: (code: number) => void;
    const worker = { ...laufenderProzess(), onExit: (cb: (code: number | null) => void) => { finish = cb; } };
    let resolve!: (proc: WorkerProcess) => void;
    const promise = new Promise<WorkerProcess>((complete) => { resolve = complete; });
    let spawns = 0;
    const ctx = makeRecordingContext({
      spawnWorker: () => ++spawns === 2 ? promise : Promise.resolve(worker),
    });
    const handle = await adapter.start({ adapter: "pi", project: ctx.workdir, prompt: "erster Zug" }, ctx);
    finish(0);
    const next = adapter.steer(handle, { kind: "prompt", text: "zweiter Zug" }, ctx);
    try {
      expect(await adapter.steer(handle, { kind: "prompt", text: "zu früh" }, ctx)).toMatchObject({ ok: false });
      expect(spawns).toBe(2);
    } finally {
      resolve(worker);
      await next;
      await adapter.stop(handle, ctx);
    }
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

/**
 * Dieselbe Leitlinie in der RPC-Betriebsart: dort ist der Prozess langlebig,
 * Lenken geht als Frame in ihn hinein — auch dann darf kein zweiter Pi-Prozess
 * entstehen (ADR-0114).
 */
describe("BUG-0261 in RPC-Betriebsart: Lenken bleibt ein Prozess", () => {
  it("lenkt im laufenden Zug durch denselben Prozess", async () => {
    const adapter = createAdapter({ mode: "rpc" });
    const gesendet: string[] = [];
    let ereignis!: (zeile: string) => void;
    const prozesse: number[] = [];
    let kills = 0;
    const ctx = makeRecordingContext({
      spawnWorker: async () => {
        prozesse.push(prozesse.length);
        return {
          onStdout: (cb) => { ereignis = cb; },
          onStderr: () => undefined,
          onExit: () => undefined,
          write: (daten) => {
            gesendet.push(String(daten));
            // pi antwortet auf jeden Frame mit einer Quittung — sonst wartete
            // der Adapter auf eine Antwort, die nie kommt.
            for (const zeile of String(daten).split("\n").filter(Boolean)) {
              const rahme = JSON.parse(zeile) as { id?: string; command?: string; type?: string };
              if (rahme.id === undefined) continue;
              // pi antwortet als eigene Zeile — das Rahmenformat ist LF.
              ereignis(`${JSON.stringify({
                type: "response",
                id: rahme.id,
                command: rahme.command ?? rahme.type,
                success: true,
                data: { sessionId: "pi-nativ", sessionFile: "/tmp/pi-nativ.jsonl" },
              })}\n`);
            }
          },
          kill: async () => { kills += 1; },
          exited: () => new Promise<{ code: number | null }>(() => undefined),
        };
      },
    });
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "erster Zug" }, ctx);
    await new Promise<void>((complete) => setTimeout(complete, 10));
    // pi meldet den Lauf — wieder als LF-umrahmte Zeile.
    ereignis(`${JSON.stringify({ type: "agent_start" })}\n`);

    const ack = await adapter.steer(handle, { kind: "prompt", text: "lenke mitten im Zug" }, ctx);
    expect(ack.ok).toBe(true);
    expect(gesendet.some((zeile) => zeile.includes('"type":"steer"'))).toBe(true);
    expect(gesendet.some((zeile) => zeile.includes('"type":"prompt"'))).toBe(true);
    // Der Nachweis, um den es geht: genau ein Pi-Prozess.
    expect(prozesse).toHaveLength(1);

    await adapter.stop(handle, ctx);
    // Abbruch zuerst im Prozess (`abort`), dann die Keule — und es war immer einer.
    expect(gesendet.some((zeile) => zeile.includes('"type":"abort"'))).toBe(true);
    expect(kills).toBeGreaterThan(0);
  });

  it("sichert Mid-Turn-Eingabe nur in der RPC-Betriebsart zu", () => {
    expect(createAdapter({ mode: "rpc" }).capabilities().midTurnInput).toBe(true);
    expect(createAdapter({}).capabilities().midTurnInput).not.toBe(true);
  });
});

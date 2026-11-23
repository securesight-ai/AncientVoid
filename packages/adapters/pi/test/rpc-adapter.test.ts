import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * Lenken mitten im Zug, ohne Zweitprozess (BUG-0261). Der nachgebaute
 * pi-Prozess spricht das echte RPC-Protokoll (`pi --mode rpc`, docs/rpc.md):
 * Antworten mit Id, Ereignisse ohne Id, Befehle beantwortet pi auch zwischen
 * Zügen. Der pi-Eigentest am 2026-11-23 lieferte genau diese Sätze: `prompt` →
 * `disposition: "started"`, dann `queue_update` mitten im `tool_execution_update`,
 * `steer` → `disposition: "queued"`.
 */
type Fake = WorkerProcess & {
  zustand: Record<string, unknown>;
  ereignis: (o: Record<string, unknown>) => void;
  gesendet: Record<string, unknown>[];
};

const BEANTWORDET = new Set(["get_state", "abort", "compact", "prompt", "steer"]);

function piProzess(): Fake {
  let stdout: ((chunk: string) => void) | undefined;
  const exit = new Set<(code: number | null) => void>();
  const gesendet: Record<string, unknown>[] = [];
  const fake: Fake = {
    zustand: { isStreaming: false, sessionId: "pi-uuid-1", sessionFile: "/p/pi-uuid-1.jsonl" },
    onStdout: (cb) => {
      stdout = cb;
    },
    onStderr: () => undefined,
    onExit: (cb) => exit.add(cb),
    write: (data) => {
      const befehl = JSON.parse(data) as Record<string, unknown>;
      gesendet.push(befehl);
      const id = typeof befehl.id === "string" ? befehl.id : undefined;
      const typ = String(befehl.type ?? "");
      if (!id || !BEANTWORDET.has(typ)) return;
      // pi antwortet auf jeden Befehl — asynchron, in beliebiger Reihenfolge.
      queueMicrotask(() => {
        const daten =
          typ === "get_state"
            ? fake.zustand
            : typ === "prompt" || typ === "steer"
              ? { disposition: typ === "steer" ? "queued" : fake.zustand.isStreaming === true ? "queued" : "started" }
              : undefined;
        stdout?.(`${JSON.stringify({ id, type: "response", command: typ, success: true, ...(daten ? { data: daten } : {}) })}\n`);
      });
    },
    kill: async () => {
      for (const cb of exit) cb(143);
    },
    exited: () => new Promise(() => undefined),
    ereignis: (o) => stdout?.(`${JSON.stringify(o)}\n`),
    gesendet,
  };
  return fake;
}

function sitzung(mode: "rpc" | "oneshot", opts?: { model?: string; laeuft?: boolean }) {
  const prozesse: Fake[] = [];
  const gestartet: string[][] = [];
  const ctx = makeRecordingContext({
    spawnWorker: async (cmd) => {
      gestartet.push(cmd);
      const p = piProzess();
      if (opts?.laeuft !== undefined) p.zustand.isStreaming = opts.laeuft;
      prozesse.push(p);
      return p;
    },
  });
  const adapter = createAdapter({ mode, ...(opts?.model ? { model: opts.model } : {}) });
  return { adapter, ctx, prozesse, gestartet };
}

describe("pi im RPC-Modus — ein Prozess, Lenken mitten im Zug", () => {
  it("startet den Steuerprozess und schickt den Prompt auf stdin, nicht ins Argv", async () => {
    const { adapter, ctx, prozesse, gestartet } = sitzung("rpc", { model: "strata/qwen" });
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "baue das" }, ctx);
    expect(gestartet[0]!.slice(0, 3)).toEqual(["pi", "--mode", "rpc"]);
    expect(gestartet[0]!.join(" ")).toContain("--model strata/qwen");
    expect(gestartet[0]!.join(" ")).not.toContain("baue das");
    const p = prozesse[0]!;
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.session"));
    expect(p.gesendet).toContainEqual({ type: "prompt", message: "baue das" });
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "pi.session")?.payload).toMatchObject({
      nativeSessionId: "pi-uuid-1",
      sessionFile: "/p/pi-uuid-1.jsonl",
    });
  });

  it("liefert die Ereignisse des Steuerprozesses als ganz normale Hub-Ereignisse", async () => {
    const { adapter, ctx, prozesse } = sitzung("rpc");
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "lies das" }, ctx);
    const p = prozesse[0]!;
    p.ereignis({ type: "agent_start" });
    p.ereignis({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "fertig gelesen" } });
    p.ereignis({ type: "tool_execution_end", toolCallId: "call_1", isError: false, result: { content: [{ type: "text", text: "Read image file [image/png]" }] } });
    p.ereignis({ type: "queue_update", steering: ["anders machen"] });
    p.ereignis({ type: "agent_settled" });
    await waitFor(() => ctx.events.some((e) => e.type === "tool_result"));
    expect(ctx.events.some((e) => e.type === "assistant" && (e.payload as { text?: string }).text === "fertig gelesen")).toBe(true);
    expect(ctx.events.find((e) => e.type === "tool_result")?.payload).toMatchObject({ toolUseId: "call_1" });
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "pi.queue")?.summary).toContain("vorgemerkt — 1 Lenkung");
  });

  it("Lenkung im laufenden Zug geht als `steer` an denselben Prozess", async () => {
    const { adapter, ctx, prozesse, gestartet } = sitzung("rpc", { laeuft: true });
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "start" }, ctx);
    const p = prozesse[0]!;
    p.ereignis({ type: "agent_start" });
    const ack = await adapter.steer(handle, { kind: "prompt", text: "Abbruch, stattdessen X" }, ctx);
    expect(ack.ok).toBe(true);
    expect(p.gesendet).toContainEqual({ type: "steer", message: "Abbruch, stattdessen X" });
    expect(p.gesendet.filter((r) => r.type === "prompt")).toHaveLength(1);
    expect(gestartet).toHaveLength(1); // kein Zweitprozess auf dieselbe native Session
  });

  it("Meldung nach Zugende ist ein normaler Prompt im selben Prozess", async () => {
    const { adapter, ctx, prozesse, gestartet } = sitzung("rpc");
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "start" }, ctx);
    const p = prozesse[0]!;
    p.ereignis({ type: "agent_start" });
    p.ereignis({ type: "agent_settled" });
    await adapter.steer(handle, { kind: "prompt", text: "noch was" }, ctx);
    expect(p.gesendet).toContainEqual({ type: "prompt", message: "noch was" });
    expect(p.gesendet.some((r) => r.type === "steer")).toBe(false);
    expect(gestartet).toHaveLength(1);
  });

  it("/compact braucht keinen Zweitprozess mehr", async () => {
    const { adapter, ctx, prozesse, gestartet } = sitzung("rpc");
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "start" }, ctx);
    const ack = await adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx);
    expect(ack.ok).toBe(true);
    expect(prozesse[0]!.gesendet.some((r) => r.type === "compact")).toBe(true);
    expect(gestartet).toHaveLength(1);
  });

  it("stop bricht über pi selbst ab (`abort`), nicht nur mit Signal", async () => {
    const { adapter, ctx, prozesse } = sitzung("rpc");
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "start" }, ctx);
    await adapter.stop(handle, ctx);
    expect(prozesse[0]!.gesendet.some((r) => r.type === "abort")).toBe(true);
  });

  it("meldet Zugrahmen an den Hub — ein persistenter Prozess endet nicht pro Zug", async () => {
    const { adapter, ctx, prozesse } = sitzung("rpc");
    const wendungen: string[] = [];
    (ctx as unknown as { turn: (zustand: string) => void }).turn = (zustand) => wendungen.push(zustand);
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "start" }, ctx);
    const p = prozesse[0]!;
    p.ereignis({ type: "agent_start" });
    p.ereignis({ type: "agent_settled" });
    await waitFor(() => wendungen.includes("idle"));
    expect(wendungen).toEqual(["working", "idle"]);
  });

  it("übernimmt nach einem Hub-Neustart denselben Steuerprozess", async () => {
    // Der Adapter darf nach einem Neustart nicht blind einen zweiten pi-Prozess
    // starten und schon gar nicht das One-Shot-Protokoll an einen RPC-Prozess
    // anhängen — sonst ist Lenken genau dann weg, wenn der Hub neu gestartet ist.
    const ordner = mkdtempSync(join(tmpdir(), "av-pi-sessions-"));
    mkdirSync(join(ordner, "projekt"));
    writeFileSync(join(ordner, "projekt", "p_11111111-2222-3333-4444-555555555555.jsonl"), "{}\n");
    const prozess = piProzess();
    prozess.zustand.isStreaming = true;
    const adapter = createAdapter({ mode: "rpc", sessionsDir: ordner });
    const neu = makeRecordingContext({
      adoptWorker: async () => prozess,
      spawnWorker: async () => {
        throw new Error("nach dem Neustart darf kein zweiter pi-Prozess starten");
      },
    });
    Object.defineProperty(neu, "nativeSessionId", { value: "11111111-2222-3333-4444-555555555555" });
    const handle = await adapter.recover!("sitzung-nach-neustart", 0, neu);
    expect(handle).not.toBeNull();
    const ack = await adapter.steer(handle!, { kind: "prompt", text: "lenke nach dem Neustart" }, neu);
    expect(ack.ok).toBe(true);
    expect(prozess.gesendet.some((rahme) => rahme.type === "steer")).toBe(true);
    expect(prozess.gesendet.some((rahme) => rahme.type === "prompt")).toBe(false);
  });

  it("Fähigkeiten: RPC verspricht Lenken mitten im Zug, One-Shot nicht", () => {
    const rpc = createAdapter({ mode: "rpc" }).capabilities();
    expect(rpc.midTurnInput).toBe(true);
    expect(rpc.promptDelivery).toBe("live");
    const einzug = createAdapter({}).capabilities();
    expect(einzug.midTurnInput).toBe(false);
    expect(einzug.promptDelivery).toBe("next-turn");
  });
});

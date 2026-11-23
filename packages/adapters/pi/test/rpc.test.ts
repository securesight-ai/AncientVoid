import { describe, it, expect } from "vitest";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { createPiRpc, type RpcRecord } from "../src/rpc.ts";

/**
 * Das Gespräch mit `pi --mode rpc` ist die Grundlage des Lenkens mitten im Zug
 * (BUG-0261: nie ein Zweitprozess auf dieselbe native Session). Geprüft wird
 * hier die Protokollschicht — Framing, Id-Zuordnung, Zeitgrenze — gegen einen
 * nachgebauten pi-Prozess, weil ein echter pi-Lauf im Test nicht deterministisch ist.
 */
function fakeProc(): WorkerProcess & {
  schreiben: (text: string) => void;
  beenden: () => void;
  gesendet: string[];
} {
  let stdout: ((chunk: string) => void) | undefined;
  let exit: (() => void) | undefined;
  const gesendet: string[] = [];
  return {
    onStdout: (cb) => {
      stdout = cb;
    },
    onStderr: () => undefined,
    onExit: (cb) => {
      exit = () => cb(0);
    },
    write: (data) => gesendet.push(data),
    kill: async () => undefined,
    exited: () => new Promise(() => undefined),
    schreiben: (text) => stdout?.(text),
    beenden: () => exit?.(),
    gesendet,
  };
}

describe("pi rpc — JSONL-Gespräch", () => {
  it("ordnet Antworten anhand der Id, auch in anderer Reihenfolge", async () => {
    const proc = fakeProc();
    const rpc = createPiRpc(proc, () => undefined);
    const a = rpc.request("get_state");
    const b = rpc.request("abort");
   // Die zweite Befehlsantwort kommt zuerst — wer auf die Reihenfolge baut, vertauscht das Ergebnis.
    proc.schreiben(`${JSON.stringify({ id: "av2", type: "response", command: "abort", success: true })}\n`);
    proc.schreiben(
      `${JSON.stringify({ id: "av1", type: "response", command: "get_state", success: true, data: { isStreaming: true, sessionFile: "/p/s.jsonl" } })}\n`,
    );
    expect(await b).toEqual({ command: "abort", success: true });
    expect(await a).toMatchObject({ command: "get_state", success: true, data: { isStreaming: true } });
    const befehl1 = JSON.parse(proc.gesendet[0]!) as RpcRecord;
    expect(befehl1).toMatchObject({ id: "av1", type: "get_state" });
  });

  it("setzt Sätze zusammen, die über mehrere Chunks verteilt ankommen", async () => {
    const proc = fakeProc();
    const empfangen: RpcRecord[] = [];
    const rpc = createPiRpc(proc, (r) => empfangen.push(r));
    const antwort = rpc.request("steer", { message: "anderer Weg" });
    proc.schreiben('{"id":"av1","type":"response","comm');
    proc.schreiben(`and":"steer","success":true,"data":{"disposition":"queued"}}\n`);
    expect(await antwort).toMatchObject({ success: true, data: { disposition: "queued" } });
    expect(JSON.parse(proc.gesendet[0]!)).toMatchObject({ type: "steer", message: "anderer Weg" });
  });

  it("trennt nur an LF — U+2028 mitten im Text zerreißt keinen Satz", () => {
    const proc = fakeProc();
    const empfangen: RpcRecord[] = [];
    createPiRpc(proc, (r) => empfangen.push(r));
    const text = "erste Zeile U+2028   U+2029   Ende";
    proc.schreiben(`${JSON.stringify({ type: "message_update", payload: { text } })}\n`);
    expect(empfangen).toHaveLength(1);
    expect((empfangen[0]!.payload as { text: string }).text).toBe(text);
  });

  it("Protokollsätze laufen durch, Nicht-JSON bleibt draußen", () => {
    const proc = fakeProc();
    const empfangen: RpcRecord[] = [];
    createPiRpc(proc, (r) => empfangen.push(r));
    proc.schreiben('{"type":"queue_update","payload":{"steering":1}}\n');
    proc.schreiben("plain text noise\n");
    proc.schreiben('{"type":"agent_settled"}\n');
    expect(empfangen.map((r) => r.type)).toEqual(["queue_update", "agent_settled"]);
  });

  it("eine offene Frage endet mit Grund, wenn pi stirbt — nichts bleibt hängen", async () => {
    const proc = fakeProc();
    const rpc = createPiRpc(proc, () => undefined);
    const frage = rpc.request("get_state");
    proc.beenden();
    expect(await frage).toMatchObject({ success: false, error: "pi-Prozess beendet" });
  });

  it("eine Antwort, die ausbleibt, wird nach der Zeitgrenze zu einem Grund", async () => {
    const proc = fakeProc();
    const rpc = createPiRpc(proc, () => undefined);
    const ohne = await rpc.request("compact", undefined, 10);
    expect(ohne).toMatchObject({ command: "compact", success: false });
    expect(ohne.error).toContain("antwortet nicht");
  });
});


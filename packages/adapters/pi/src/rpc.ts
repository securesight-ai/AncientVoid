import type { WorkerProcess } from "@ancientvoid/contracts";

/**
 * JSONL-Gespräch mit `pi --mode rpc` (pi docs/rpc.md, gemessen 2026-11-23).
 *
 * framing: eine Zeile = ein Datensatz, Trenner ist ausschließlich LF. Node's
 * `readline` wird bewusst nicht benutzt — es trennt auch an U+2028/U+2029, die
 * mitten in JSON-Strecken stehen dürfen und dann den Verlauf zerrissen hätten.
 *
 * Zuordnung: jeder Befehl bekommt eine Id; die Antwort kommt mit derselben Id
 * zurück, aber nicht in der Reihenfolge der Befehle (pi bearbeitet sie
 * nebenläufig). Befehle ohne Antwort (events) gehen an `onRecord`.
 */
export type RpcRecord = Record<string, unknown> & { type?: string; id?: string };

export type RpcResponse = { command: string; success: boolean; data?: unknown; error?: string };

export function createPiRpc(proc: WorkerProcess, onRecord: (record: RpcRecord) => void): {
  send: (record: RpcRecord) => void;
  request: (type: string, extra?: Record<string, unknown>, timeoutMs?: number) => Promise<RpcResponse>;
} {
  let puffer = "";
  let zaehler = 0;
  const offen = new Map<string, { loesen: (r: RpcResponse) => void; wachter?: ReturnType<typeof setTimeout> }>();

  proc.onStdout((chunk: string) => {
    puffer += chunk;
    for (;;) {
      const trenner = puffer.indexOf("\n");
      if (trenner < 0) break;
      const zeile = puffer.slice(0, trenner).replace(/\r$/, "");
      puffer = puffer.slice(trenner + 1);
      if (!zeile.trim()) continue;
      let datensatz: RpcRecord;
      try {
        datensatz = JSON.parse(zeile) as RpcRecord;
      } catch {
        // stdout ist für Protokollsätze reserviert; alles andere hier nicht werten.
        continue;
      }
      // Ein Echo der **eigenen** Zeile ist kein pi-Ereignis. Passiert real beim
      // Übernehmen eines tmux-Workers nach einem Hub-Neustart: der Puffer enthält
      // die vorher eingetippte Anfrage, und die landete als
      // `pi: unbekannter Stream-Typ "get_state"` im Chat (Fund 2026-11-23, 21:16).
      // Eigene Ids tragen das Präfix `av`; pi erzeugt UUIDs und `call_…`.
      if (typeof datensatz.id === "string" && datensatz.id.startsWith("av") && datensatz.type !== "response") {
        continue;
      }
      if (datensatz.type === "response") {
        const id = typeof datensatz.id === "string" ? datensatz.id : "";
        const wartend = id ? offen.get(id) : undefined;
        if (wartend) {
          offen.delete(id);
          if (wartend.wachter) clearTimeout(wartend.wachter);
          wartend.loesen({
            command: String(datensatz.command ?? ""),
            success: datensatz.success === true,
            ...(datensatz.data !== undefined ? { data: datensatz.data } : {}),
            ...(typeof datensatz.error === "string" ? { error: datensatz.error } : {}),
          });
        }
        continue;
      }
      onRecord(datensatz);
    }
  });

  proc.onExit(() => {
    for (const wartend of offen.values()) {
      if (wartend.wachter) clearTimeout(wartend.wachter);
      wartend.loesen({ command: "exit", success: false, error: "pi-Prozess beendet" });
    }
    offen.clear();
  });

  return {
    send: (record) => {
      proc.write(`${JSON.stringify(record)}\n`);
    },
    request: (type, extra, timeoutMs = 10_000) =>
      new Promise<RpcResponse>((loesen) => {
        const id = `av${(zaehler += 1)}`;
        const wachter = setTimeout(() => {
          offen.delete(id);
          loesen({ command: type, success: false, error: `pi antwortet nicht auf ${type} (${timeoutMs} ms)` });
        }, timeoutMs);
        offen.set(id, { loesen, wachter });
        proc.write(`${JSON.stringify({ id, type, ...extra })}\n`);
      }),
  };
}

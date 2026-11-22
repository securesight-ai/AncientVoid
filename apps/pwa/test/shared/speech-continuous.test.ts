import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { startContinuousStt } from "../../src/shared/speech.ts";
import { setLanguageSetting } from "../../src/shared/i18n/index.ts";

/**
 * BUG-0177: Diktat über Minuten statt eines 1-Sekunden-Stossts. Die Stelle, an der
 * es wirklich weh tut, ist die Zusammenarbeit mit Chrome: eine `continuous`-
 * Erkennung endet trotzdem von selbst (Stille, Endpointing, Netz). Diese Tests
 * halten fest, dass ein solches onend die Sitzung NICHT beendet, sondern neu
 * startet — ohne die bisherigen Segmente zu verlieren.
 */
type Emit = { transcript: string; isFinal: boolean };
type Script = { emits?: Emit[]; error?: string; endAfterEmits?: boolean };

const instances: FakeRecognition[] = [];

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  stoppedByUser = false;
  constructor(private script: Script) {
    instances.push(this);
  }
  start() {
    this.onstart?.();
    for (const e of this.script.emits ?? []) {
      // isFinal sitzt beim echten Web-Speech auf dem Ergebnis, nicht auf der Alternative
      this.onresult?.({ resultIndex: 0, results: [{ isFinal: e.isFinal, length: 1, 0: { transcript: e.transcript } }] });
    }
    if (this.script.error) this.onerror?.({ error: this.script.error });
    if (this.script.endAfterEmits !== false) this.onend?.();
  }
  stop() {
    this.stoppedByUser = true;
    this.onend?.();
  }
  abort() {
    this.stoppedByUser = true;
  }
}

function install(scripts: Script[]) {
  instances.length = 0;
  let n = 0;
  const Ctor = function (this: FakeRecognition) {
    const script = scripts[Math.min(n++, scripts.length - 1)];
    return new FakeRecognition(script);
  };
  (globalThis as unknown as { window: unknown }).window = { SpeechRecognition: Ctor };
}

function fakeStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeStorage();
  setLanguageSetting("de"); // die Meldung im Mikrofon-Fall ist deutsch festgemacht (EPIC-P61)
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("startContinuousStt (BUG-0177)", () => {
  it("sammelt Segmente und startet nach einem onend von Chrome neu", async () => {
    install([
      { emits: [{ transcript: "zuerst", isFinal: true }] },
      { emits: [{ transcript: "danach", isFinal: true }] },
    ]);
    const previews: string[] = [];
    const restarts: number[] = [];
    let ended: { reason: string; text: string } | null = null;
    const handle = startContinuousStt("de-DE", {
      onPreview: (t) => previews.push(t),
      onRestarts: (n) => restarts.push(n),
      onEnd: (info) => (ended = { reason: info.reason, text: info.text }),
    });
    expect(previews).toEqual(["zuerst"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(restarts[0]).toBe(1); // jedes zu Ende gehende onend zaehlt — Chrome macht das mehrfach
    expect(previews.at(-1)).toBe("zuerst danach");
    handle.stop();
    expect(ended).toEqual({ reason: "stopped", text: "zuerst danach" });
  });

  it("zeigt Zwischenstände als Vorschau, ohne etwas einzufügen", async () => {
    install([{ emits: [{ transcript: "bitte", isFinal: false }, { transcript: "bitte weitermachen", isFinal: true }] }]);
    const previews: string[] = [];
    const handle = startContinuousStt("de-DE", { onPreview: (t) => previews.push(t) });
    expect(previews).toEqual(["bitte", "bitte weitermachen"]);
    handle.stop();
  });

  it("bricht mit Meldung ab, wenn das Mikro verweigert wird — ohne Endlosschleife", async () => {
    install([{ error: "not-allowed" }]);
    let ended: { reason: string; message?: string } | null = null;
    startContinuousStt("de-DE", { onEnd: (info) => (ended = { reason: info.reason, message: info.message }) });
    expect(ended?.reason).toBe("fatal");
    expect(ended?.message).toContain("Mikrofon");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(instances.length).toBe(1);
  });

  it("doppelt den Text nicht, wenn Chrome beim Neustart das letzte Stück wiederholt", async () => {
    install([
      { emits: [{ transcript: "Die Kopfhörer sind gut", isFinal: true }] },
      { emits: [{ transcript: "Die Kopfhörer sind gut für Kinder", isFinal: true }] },
      { emits: [{ transcript: "Die Kopfhörer sind gut für Kinder", isFinal: true }] },
    ]);
    const previews: string[] = [];
    const handle = startContinuousStt("de-DE", { onPreview: (t) => previews.push(t) });
    await vi.advanceTimersByTimeAsync(1_000);
    handle.stop();
    expect(previews.at(-1)).toBe("Die Kopfhörer sind gut für Kinder");
    expect(previews.at(-1)).not.toContain("gut Die");
  });

  it("gibt nach vielen folgenlosen Neustarts sichtbar auf statt stumm weiterzulaufen", async () => {
    install([{}]);
    let ended: { reason: string; message?: string } | null = null;
    startContinuousStt("de-DE", { onEnd: (info) => (ended = { reason: info.reason, message: info.message }) });
    await vi.advanceTimersByTimeAsync(250 * 130);
    expect(ended?.reason).toBe("restarted-out");
    expect(instances.length).toBeGreaterThan(100);
  });
});

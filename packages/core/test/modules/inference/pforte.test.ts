import { describe, expect, it, vi } from "vitest";
import { createPforte, type Pforte, type PforteGesuch } from "../../../src/index.ts";

/**
 * BUG-0272 (ADR-0116): die Pforte pro Modell-Endpoint. Die Fälle sind die des
 * Bug-Reports —(serialisiert, Kontextbudget als Aufnahmeregel, Lease für die
 * KV-Wiederverwendung, Hintergrund wartet vor Interaktiv, Sichtbarkeit statt
 * Provider-Panne).
 */

const endpoint = "strata/qwen3.8-flash-next-iq3_s";

const gesuch = (teil: Partial<PforteGesuch> & { inhaber: string }): PforteGesuch => ({
  endpoint,
  priorität: "interaktiv",
  warum: "Zug",
  promptToken: null,
  maxToken: null,
  ...teil,
});

async function offen(): Promise<{ done: Promise<void>; freigeben: () => void }> {
  let freigeben!: () => void;
  const done = new Promise<void>((r) => (freigeben = r));
  return { done, freigeben };
}

describe("Pforte: ein Platz pro Einzelslot-Endpoint", () => {
  it("lässt zwei Gesuche nacheinander durch und meldet das Warten als Ereignis", async () => {
    const ereignisse: string[] = [];
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 0, maxWaitMs: 5_000 }],
    }, { onEreignis: (e) => ereignisse.push(e.art) });
    const erste = await offen();
    const zweite = await offen();

    const a = pforte.durchlassen(gesuch({ inhaber: "session-a" }), () => erste.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.plaetze.length).toBe(1));
    const b = pforte.durchlassen(gesuch({ inhaber: "session-b" }), () => zweite.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.wartende.length).toBe(1));

    // Noch während b wartet: kein Fehler, nur Warteschlange.
    expect(ereignisse).toContain("inference.slot_granted");
    expect(ereignisse).toContain("inference.slot_wait");
    expect(ereignisse).not.toContain("inference.slot_denied");

    erste.freigeben();
    await a;
    expect(pforte.zustand(endpoint)?.plaetze.map((p) => p.inhaber)).toEqual(["session-b"]);
    zweite.freigeben();
    await b;
    expect(pforte.zustand(endpoint)?.plaetze.length).toBe(0);
  });

  it("lehnt im Kontextbudget ab, bevor der Provider gefragt wird", async () => {
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, maxContext: 1_000, leaseMs: 0, maxWaitMs: 120 }],
    });
    const halte = await offen();
    const erste = pforte.durchlassen(
      { ...gesuch({ inhaber: "session-a" }), promptToken: 900 },
      () => halte.done,
    );
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.gehaltenToken).toBe(900));

    // Zu groß für das Modell: sofortige Absage, der Provider wird nie gefragt.
    let providerGefragt = false;
    let grund: string | null = null;
    await pforte
      .durchlassen({ ...gesuch({ inhaber: "session-c" }), promptToken: 1_500, maxToken: 100 }, async () => {
        providerGefragt = true;
        return "nie";
      })
      .catch((e: unknown) => (grund = (e as Error).message));
    expect(grund).toContain("context_budget");
    expect(providerGefragt).toBe(false);

    // Passt erst, wenn die andere Sitzung ihren KV abgibt: warten, dann der wahre Grund.
    const wartend = pforte.durchlassen(
      { ...gesuch({ inhaber: "session-b" }), promptToken: 300, maxToken: 100 },
      async () => "doch",
    );
    let zweiterGrund = "";
    await wartend.catch((e: unknown) => (zweiterGrund = (e as Error).message));
    expect(zweiterGrund).toContain("context_budget");

    halte.freigeben();
    await erste;
  });

  it("gibt demselben Inhaber seinen Platz wieder (Lease) — andere müssen warten", async () => {
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 20_000, maxWaitMs: 5_000 }],
    });
    const eins = await offen();
    const a = pforte.durchlassen(gesuch({ inhaber: "session-a" }), () => eins.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.plaetze.length).toBe(1));
    const fremde = pforte.durchlassen(gesuch({ inhaber: "session-b" }), async () => "fremd");
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.wartende.length).toBe(1));
    eins.freigeben();
    await a;

    // Lease gehört jetzt session-a: sie kommt vor session-b durch.
    const zwei = await offen();
    const wieder = pforte.durchlassen(gesuch({ inhaber: "session-a" }), () => zwei.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.plaetze.map((p) => p.inhaber)).toEqual(["session-a"]));
    expect(pforte.zustand(endpoint)?.wartende.map((w) => w.inhaber)).toEqual(["session-b"]);
    zwei.freigeben();
    await wieder;
    expect(await fremde).toBe("fremd");
  });

  it("Hintergrund ordnet sich ein, ohne einen laufenden Zug zu stören", async () => {
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 0, maxWaitMs: 5_000 }],
    });
    const zug = await offen();
    const laufend = pforte.durchlassen(gesuch({ inhaber: "session-a" }), () => zug.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.plaetze.length).toBe(1));

    const reihenfolge: string[] = [];
    const background = pforte.durchlassen(
      gesuch({ inhaber: "titel", priorität: "hintergrund", warum: "Titel" }),
      async () => { reihenfolge.push("hinten"); return "hinten"; },
    );
    const interaktiv = pforte.durchlassen(gesuch({ inhaber: "session-b" }), async () => {
      reihenfolge.push("vorn");
      return "vorn";
    });
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.wartende.length).toBe(2));
    expect(pforte.zustand(endpoint)?.wartende.map((w) => w.inhaber)).toEqual(["session-b", "titel"]);

    zug.freigeben();
    await laufend;
    expect(await interaktiv).toBe("vorn");
    expect(await background).toBe("hinten");
    expect(reihenfolge).toEqual(["vorn", "hinten"]);
  });

  it("entscheidet nach maxWaitMs statt unbegrenzt zu warten", async () => {
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 0, maxWaitMs: 40 }],
    });
    const halte = await offen();
    const laufend = pforte.durchlassen(gesuch({ inhaber: "session-a" }), () => halte.done);
    await vi.waitFor(() => expect(pforte.zustand(endpoint)?.plaetze.length).toBe(1));
    let grund = "";
    await pforte
      .durchlassen(gesuch({ inhaber: "titel", priorität: "hintergrund" }), async () => "nie")
      .catch((e: unknown) => (grund = (e as Error).message));
    expect(grund).toContain("gate_timeout");
    halte.freigeben();
    await laufend;
  });

  it("Zug-Belegung: reservieren hält den Platz, Lease schützt den KV, andere warten", async () => {
    const geweckt: string[] = [];
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 0, maxWaitMs: 5_000 }],
    });
    pforte.setzeWeckruf((endpoint, inhaber) => geweckt.push(`${endpoint}:${inhaber}`));
    const modell = "strata/qwen3.8-flash-next-iq3_s";

    expect(pforte.reservieren(gesuch({ inhaber: "session-a" }))).toBe(true);
    expect(pforte.frei(modell, "session-a")).toBe(true);
    expect(pforte.frei(modell, "session-b")).toBe(false);
    expect(pforte.reservieren(gesuch({ inhaber: "session-b" }))).toBe(false);

    pforte.freigeben(modell, "session-a");
    expect(geweckt).toEqual(["strata:session-a"]);
    expect(pforte.frei(modell, "session-b")).toBe(true);
    expect(pforte.reservieren(gesuch({ inhaber: "session-b" }))).toBe(true);
    pforte.freigeben(modell, "session-b");
  });

  it("Lease eines Zugs hält den Platz gegen eine andere Sitzung (KV bleibt warm)", () => {
    const pforte = createPforte({
      engines: [{ provider: "strata", slots: 1, leaseMs: 20_000, maxWaitMs: 5_000 }],
    });
    const modell = "strata/qwen3.8-flash-next-iq3_s";
    expect(pforte.reservieren(gesuch({ inhaber: "session-a" }))).toBe(true);
    pforte.freigeben(modell, "session-a");
    expect(pforte.frei(modell, "session-a")).toBe(true);
    expect(pforte.frei(modell, "session-b")).toBe(false);
    expect(pforte.zustand(modell)?.leaseInhaber).toBe("session-a");
  });

  it("ohne Pforten-Konfiguration ist der Endpoint ungedeckelt (Cloud bleibt direkt)", async () => {
    const pforte: Pforte = createPforte({ engines: [] });
    const wert = await pforte.durchlassen({ ...gesuch({ inhaber: "x" }), endpoint: "openai/gpt" }, async () => "direkt");
    expect(wert).toBe("direkt");
    expect(pforte.zustand("openai/gpt")).toBeNull();
  });
});

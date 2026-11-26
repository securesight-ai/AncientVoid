import type {
  InferenceGateConfig,
  InferenceGateEngine,
  InferenceGatePlatz,
  InferenceGateZustand,
  InferencePriorität,
  InferencePforteEvent,
} from "@ancientvoid/contracts";

/**
 * BUG-0272 (ADR-0116): **Pforte pro Modell-Endpoint.**
 *
 * Warum das keine Schönheitsfrage ist (Messwerte aus dem Bug-Report): Strata meldet
 * `max_context 262144` und hält pro Sitzung ~112 k Token im KV. Zwei lange Sitzungen
 * passen nicht gleichzeitig hindurch — die zweite bekommt einen Kontextüberlauf, und
 * die verdrängte muss ihren ganzen Verlauf neu vorbehandeln (gemessene KV-Wieder-
 * verwendung 85 %, sie bricht beim Wechsel komplett weg). Die Pforte entscheidet
 * deshalb *vor* der Anfrage: ein Platz pro Endpoint, FIFO mit Priorität, Kontext-
 * budget als Aufnahmeregel, und ein Lease, das einer Sitzung ihren KV-Cache erhält.
 *
 * Endpoints ohne Eintrag in `gate.engines` bleiben ungedeckelt — Cloud-Provider
 * haben dieses Problem nicht, und der Hub darf sie nicht ausbremsen.
 */

export interface PforteGesuch {
  /** Modellangabe (`strata/…`) oder Basis-URL; daran wird der Endpoint erkannt. */
  readonly endpoint: string;
  readonly inhaber: string;
  readonly priorität: InferencePriorität;
  /** Kurzer Grund für die Akte ("Zug", "Titel", "Gatekeeper"). */
  readonly warum: string;
  /** Erwartete Prompt-Größe; null = unbekannt (dann kein Budget-Block). */
  readonly promptToken: number | null;
  readonly maxToken: number | null;
}

export interface PforteEreignis {
  readonly art: InferencePforteEvent;
  readonly endpoint: string;
  readonly inhaber: string;
  readonly warum: string;
  readonly grund?: string;
  readonly wartetMs?: number;
}

export interface Pforte {
  /** Lässt `fn` nur auf einem freien Platz laufen; lehnt sichtbar ab, sonst nie. */
  durchlassen<T>(gesuch: PforteGesuch, fn: () => Promise<T>): Promise<T>;
  /** Wäre der Platz jetzt (oder für den Inhaber des Leases) frei? */
  frei(endpoint: string, inhaber: string): boolean;
  /** Platz fest belegen — für Züge, die länger laufen als ein Funktionsaufruf. */
  reservieren(gesuch: PforteGesuch): boolean;
  /** Belegung aufgeben; der Lease hält den Platz danach für denselben Inhaber frei. */
  freigeben(endpoint: string, inhaber: string): void;
  zustand(endpoint: string): InferenceGateZustand | null;
  /** Alle Endpointe mit Pforte (für Statusseiten). */
  abgedeckte(): string[];
  /** Zu welchem Pforten-Eintrag ein Modell/eine URL gehört (f�r Zuordnungen). */
  schluessel(endpoint: string): string | null;
  /** Wartende Sitzungen eines Endpoints — für die Frage "wer wartet auf Strata?" */
  wartendeFuer(endpoint: string): string[];
  /** Callback, damit der Hub Sitzungen wecken kann, wenn ein Platz frei wird. */
  setzeWeckruf(fn: ((endpoint: string, inhaber: string) => void) | null): void;
}

interface Wartend {
  readonly gesuch: PforteGesuch;
  readonly angemeldet: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Die Zahl passt nicht ins Kontextbudget — das ist kein normales Warten. */
  amBudgetGescheitert: boolean;
  abbrechen: (grund: string) => void;
  einlassen: () => void;
}

interface Platz {
  readonly gesuch: PforteGesuch;
  readonly seit: number;
}

interface Ende {
  readonly schlussel: string;
  readonly reg: InferenceGateEngine;
  readonly plaetze: Platz[];
  /** Wartende, bereits nach Priorität sortiert. */
  readonly wartende: Wartend[];
  /** Token, die ein Inhaber im KV hält — bleiben bis der Lease abläuft. */
  readonly gehalten: Map<string, number>;
  leaseInhaber: string | null;
  leaseBis: number;
  leaseTimer: ReturnType<typeof setTimeout> | null;
}

export interface PforteOptionen {
  onEreignis?: (e: PforteEreignis) => void;
  now?: () => number;
}

const zahl = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

/** Eintrag finden: erst Provider-Teil der Modellangabe, dann URL-Präfix. */
function regelfuer(regeln: readonly InferenceGateEngine[], endpoint: string): InferenceGateEngine | null {
  const provider = endpoint.includes("/") ? endpoint.slice(0, endpoint.indexOf("/")) : endpoint;
  for (const e of regeln) {
    if (e.provider && e.provider === provider) return e;
  }
  for (const e of regeln) {
    if (e.url && (endpoint === e.url || endpoint.startsWith(e.url))) return e;
  }
  return null;
}

/** Einordnung: interaktiv vor hintergrund, sonst Ankunftsreihenfolge. */
function einreihen(schlange: Wartend[], neuer: Wartend): void {
  const idx = schlange.findIndex(
    (w) => w.gesuch.priorität === "hintergrund" && neuer.gesuch.priorität === "interaktiv",
  );
  if (idx < 0) schlange.push(neuer);
  else schlange.splice(idx, 0, neuer);
}

export function createPforte(konfig: InferenceGateConfig, optionen: PforteOptionen = {}): Pforte {
  const enden = new Map<string, Ende>();
  let weckruf: ((endpoint: string, inhaber: string) => void) | null = null;
  const jetzt = optionen.now ?? (() => Date.now());
  const melden = (e: PforteEreignis): void => optionen.onEreignis?.(e);

  function ende(endpoint: string): Ende | null {
    const reg = regelfuer(konfig.engines, endpoint);
    if (!reg) return null;
    const schlussel = reg.provider ?? reg.url ?? endpoint;
    let e = enden.get(schlussel);
    if (!e) {
      e = {
        schlussel,
        reg,
        plaetze: [],
        wartende: [],
        gehalten: new Map(),
        leaseInhaber: null,
        leaseBis: 0,
        leaseTimer: null,
      };
      enden.set(schlussel, e);
    }
    return e;
  }

  /** Passt die Anfrage überhaupt je in den Kontext dieses Modells? */
  function groesse(e: Ende, g: PforteGesuch): boolean {
    if (e.reg.maxContext == null || g.promptToken == null) return true;
    return zahl(g.promptToken) + zahl(g.maxToken) <= e.reg.maxContext;
  }

  /** Passt sie *jetzt*, während andere schon Token im KV halten? */
  function zuweisbar(e: Ende, g: PforteGesuch): boolean {
    if (!groesse(e, g)) return true; // schon vorher abgelehnt
    if (e.reg.maxContext == null || g.promptToken == null) return true;
    const gesamt = [...e.gehalten.values()].reduce((a, b) => a + zahl(b), 0);
    return gesamt + zahl(g.promptToken) + zahl(g.maxToken) <= e.reg.maxContext;
  }

  /** Nach Ablauf des Leases neu entscheiden — sonst wartet die Schlange ins Leere. */
  function spaeter(e: Ende, ms: number): void {
    setTimeout(() => vergebe(e), Math.max(1, ms));
  }

  function vergebe(e: Ende): void {
    // Flag für alle Wartenden neu stellen: wer gerade nicht in den Kontext passt,
    // bekommt am Ende den wahren Grund zu hören statt eines pauschalen timeouts.
    for (const w of e.wartende) w.amBudgetGescheitert = !zuweisbar(e, w.gesuch);
    while (e.plaetze.length < (e.reg.slots ?? 1)) {
      // Der Lease-Inhaber geht vor — aber nur, wenn er selbst wartet. Sonst ist
      // die Reservierung gegenstandslos und darf niemanden aufhalten.
      const inhaberDa = e.leaseInhaber != null && e.wartende.some((w) => w.gesuch.inhaber === e.leaseInhaber);
      const kopf = inhaberDa
        ? (e.wartende.find((w) => w.gesuch.inhaber === e.leaseInhaber) as Wartend)
        : e.wartende[0];
      if (!kopf) {
        // Die Reservierung verfällt nur, wenn sie jemanden blockieren würde. Ist die
        // Schlange leer, bleibt der Lease stehen: er ist der Vorrang für die Sitzung,
        // deren KV gerade warm ist — genau das, was beim nächsten Zug zählt.
        if (e.leaseInhaber != null && e.wartende.length > 0) {
          e.leaseInhaber = null;
          e.leaseBis = 0;
        }
        return;
      }
      const leaseBlckt = e.leaseInhaber != null && e.leaseInhaber !== kopf.gesuch.inhaber && jetzt() < e.leaseBis;
      if (leaseBlckt) {
        const wartet = jetzt() - kopf.angemeldet;
        if (wartet <= (e.reg.maxWaitMs ?? 120_000) / 2) {
          // Weckruf: ohne diesen Termin bliebe die Schlange stehen, bis zufällig
          // jemand anderes freigibt — der Wartende wäre längst abgesprungen.
          const bisLease = e.leaseBis - jetzt();
          const bisBruch = kopf.angemeldet + (e.reg.maxWaitMs ?? 120_000) / 2 - jetzt();
          spaeter(e, Math.max(1, Math.min(bisLease, bisBruch)));
          return;
        }
        melden({
          art: "inference.lease_broken",
          endpoint: e.schlussel,
          inhaber: kopf.gesuch.inhaber,
          warum: kopf.gesuch.warum,
          grund: `Lease von ${String(e.leaseInhaber)} hält seit ${String(wartet)} ms`,
        });
        e.leaseInhaber = null;
        e.leaseBis = 0;
      }
      if (!zuweisbar(e, kopf.gesuch)) {
        // Der Platz wäre frei, aber der Kontext reicht nicht, solange eine andere
        // Sitzung ihn hält: das ist eine Ansage, kein Provider-Ausfall. Sie wartet
        // noch bis maxWaitMs, dann sagt die Pforte den wahren Grund.
        kopf.amBudgetGescheitert = true;
        spaeter(e, Math.max(1, (e.reg.maxWaitMs ?? 120_000) / 4));
        return;
      }
      e.wartende.splice(e.wartende.indexOf(kopf), 1);
      if (kopf.timer) clearTimeout(kopf.timer);
      e.plaetze.push({ gesuch: kopf.gesuch, seit: jetzt() });
      if (kopf.gesuch.promptToken != null) e.gehalten.set(kopf.gesuch.inhaber, kopf.gesuch.promptToken);
      melden({
        art: "inference.slot_granted",
        endpoint: e.schlussel,
        inhaber: kopf.gesuch.inhaber,
        warum: kopf.gesuch.warum,
        wartetMs: jetzt() - kopf.angemeldet,
      });
      kopf.einlassen();
    }
  }

  function freigeben(e: Ende, platz: Platz): void {
    const i = e.plaetze.indexOf(platz);
    if (i >= 0) e.plaetze.splice(i, 1);
    const leaseMs = e.reg.leaseMs ?? 0;
    if (leaseMs > 0) {
      e.leaseInhaber = platz.gesuch.inhaber;
      e.leaseBis = jetzt() + leaseMs;
      if (e.leaseTimer) clearTimeout(e.leaseTimer);
      e.leaseTimer = setTimeout(() => {
        if (e.leaseInhaber === platz.gesuch.inhaber) {
          e.leaseInhaber = null;
          e.leaseBis = 0;
          e.gehalten.delete(platz.gesuch.inhaber);
          // Der Vorrang ist vorbei: wer draußen wartet, muss es erfahren — der Hub
          // hängt seine eigene Warteschlange an diesen Weckruf.
          weckruf?.(e.schlussel, platz.gesuch.inhaber);
        }
        vergebe(e);
      }, leaseMs);
    } else {
      e.gehalten.delete(platz.gesuch.inhaber);
    }
    vergebe(e);
  }

  function platzVon(e: Ende, inhaber: string): Platz | undefined {
    return e.plaetze.find((x) => x.gesuch.inhaber === inhaber);
  }

  function frei(endpoint: string, inhaber: string): boolean {
    const e = ende(endpoint);
    if (!e) return true;
    if (platzVon(e, inhaber)) return true;
    if (e.leaseInhaber != null && e.leaseInhaber !== inhaber && jetzt() < e.leaseBis) return false;
    if (e.plaetze.length >= (e.reg.slots ?? 1)) return false;
    const gesuch: PforteGesuch = {
      endpoint, inhaber, priorität: "interaktiv", warum: "", promptToken: null, maxToken: null,
    };
    return zuweisbar(e, gesuch);
  }

  function reservieren(gesuch: PforteGesuch): boolean {
    const e = ende(gesuch.endpoint);
    if (!e) return true;
    if (platzVon(e, gesuch.inhaber)) return true;
    if (!zuweisbar(e, gesuch)) return false;
    if (e.leaseInhaber != null && e.leaseInhaber !== gesuch.inhaber && jetzt() < e.leaseBis) return false;
    if (e.plaetze.length >= (e.reg.slots ?? 1)) return false;
    e.plaetze.push({ gesuch, seit: jetzt() });
    melden({ art: "inference.slot_granted", endpoint: e.schlussel, inhaber: gesuch.inhaber, warum: gesuch.warum, wartetMs: 0 });
    return true;
  }

  function freigebenVon(endpoint: string, inhaber: string): void {
    const e = ende(endpoint);
    if (!e) return;
    const platz = platzVon(e, inhaber);
    if (!platz) {
      if (e.leaseInhaber === inhaber) {
        e.leaseInhaber = null;
        e.leaseBis = 0;
        e.gehalten.delete(inhaber);
      }
      return;
    }
    freigeben(e, platz);
    weckruf?.(e.schlussel, inhaber);
  }

  function durchlassen<T>(gesuch: PforteGesuch, fn: () => Promise<T>): Promise<T> {
    const e = ende(gesuch.endpoint);
    if (!e) return fn();
    return new Promise<T>((resolve, reject) => {
      if (!groesse(e, gesuch)) {
        // Diese Sitzung passt nie in das Modell — warten hilft nicht, Kompaktieren.
        melden({
          art: "inference.slot_denied",
          endpoint: e.schlussel,
          inhaber: gesuch.inhaber,
          warum: gesuch.warum,
          grund: "context_budget",
        });
        reject(new Error(`context_budget: ${String(gesuch.promptToken)} + ${String(gesuch.maxToken)} Token passen nicht in ${String(e.reg.maxContext)} von ${gesuch.endpoint} — Sitzung kompaktieren oder kleineres Modell`));
        return;
      }
      const wartend: Wartend = {
        gesuch,
        angemeldet: jetzt(),
        timer: null,
        amBudgetGescheitert: !zuweisbar(e, gesuch),
        einlassen: () => {
          void (async () => {
            try {
              resolve(await fn());
            } catch (err) {
              reject(err);
            } finally {
              const platz = e.plaetze.find((p) => p.gesuch === gesuch);
              if (platz) freigeben(e, platz);
            }
          })();
        },
        abbrechen: (grund) => reject(new Error(`${grund}: ${gesuch.endpoint} hält ${gesuch.warum} — Pforte`)),
      };
      einreihen(e.wartende, wartend);
      if (e.plaetze.length >= (e.reg.slots ?? 1) || e.wartende[0] !== wartend) {
        melden({
          art: "inference.slot_wait",
          endpoint: e.schlussel,
          inhaber: gesuch.inhaber,
          warum: gesuch.warum,
          wartetMs: 0,
        });
      }
      wartend.timer = setTimeout(() => {
        const idx = e.wartende.indexOf(wartend);
        if (idx < 0) return;
        e.wartende.splice(idx, 1);
        const grund = wartend.amBudgetGescheitert ? "context_budget" : "gate_timeout";
        melden({
          art: "inference.slot_denied",
          endpoint: e.schlussel,
          inhaber: gesuch.inhaber,
          warum: gesuch.warum,
          grund,
          wartetMs: jetzt() - wartend.angemeldet,
        });
        wartend.abbrechen(grund);
      }, e.reg.maxWaitMs ?? 120_000);
      vergebe(e);
    });
  }

  function zustand(endpoint: string): InferenceGateZustand | null {
    const e = ende(endpoint);
    if (!e) return null;
    const plaetze: InferenceGatePlatz[] = e.plaetze.map((p) => ({
      inhaber: p.gesuch.inhaber,
      priorität: p.gesuch.priorität,
      warum: p.gesuch.warum,
      seit: new Date(p.seit).toISOString(),
      gehalteneToken: e.gehalten.get(p.gesuch.inhaber) ?? null,
    }));
    return {
      endpoint: e.schlussel,
      slots: e.reg.slots ?? 1,
      maxContext: e.reg.maxContext ?? null,
      gehaltenToken: [...e.gehalten.values()].reduce((a, b) => a + zahl(b), 0),
      plaetze,
      wartende: e.wartende.map((w) => ({
        inhaber: w.gesuch.inhaber,
        priorität: w.gesuch.priorität,
        warum: w.gesuch.warum,
        wartetMs: jetzt() - w.angemeldet,
      })),
      leaseInhaber: e.leaseInhaber != null && jetzt() < e.leaseBis ? e.leaseInhaber : null,
      leaseBisMs: Math.max(0, e.leaseBis - jetzt()),
    };
  }

  return {
    durchlassen,
    frei,
    reservieren,
    freigeben: freigebenVon,
    zustand,
    abgedeckte: () => [...enden.keys()],
    schluessel: (endpoint) => {
      const reg = regelfuer(konfig.engines, endpoint);
      return reg ? reg.provider ?? reg.url ?? endpoint : null;
    },
    wartendeFuer: (endpoint) => {
      const e = ende(endpoint);
      return e ? e.wartende.map((w) => w.gesuch.inhaber) : [];
    },
    setzeWeckruf: (fn) => {
      weckruf = fn;
    },
  };
}

/**
 * BUG-0272 Rest: hub-interne Kurzanfragen (Gatekeeper, Sitzungstitel, Planer,
 * Analyse, Bild) laufen als **Hintergrund** durch dieselbe Pforte — sie reihen
 * sich hinter interaktive Züge ein und stören den Lauf nie. Der Endpoint wird
 * wie bei Zügen erkannt: erst Modellangabe (`strata/…`), sonst Basis-URL;
 * ohne Pforten-Eintrag bleibt der Aufruf direkt (Cloud).
 */
export function hintergrundAnfrage<T>(
  pforte: Pforte | undefined,
  modell: string | undefined,
  url: string,
  inhaber: string,
  warum: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!pforte) return fn();
  const endpoint = modell != null && pforte.schluessel(modell) != null ? modell : url;
  return pforte.durchlassen({ endpoint, inhaber, priorität: "hintergrund", warum, promptToken: null, maxToken: null }, fn);
}

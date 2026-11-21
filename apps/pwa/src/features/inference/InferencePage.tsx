import { useEffect, useState } from "preact/hooks";
import type { InferencePerfRow, InferenceSnapshot, InferenceSourceList } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Card, EmptyState } from "../../shared/ui/index.ts";
import { t } from "../../shared/i18n/index.ts";
import { alter, anteil, byteGroesse, dauer, tempo, verlauf, zahl } from "./format.ts";

/**
 * EPIC-P79 T79.4 (ADR-0102): Token-Tempo der Inferenz-Engines.
 *
 * Grundregeln, die diese Seite durchziehen: `null` ist „—“, nie 0 (ADR-0023);
 * Verteilungen zeigen nur Engines, die Einzel-Requests melden (sonst steht der
 * Grund da, nicht eine erfundene Kurve); ganze Blöcke verschwinden, wenn die
 * Quelle nichts meldet; eine fehlgeschlagene Probe bleibt als Fehler sichtbar
 * (K9), und bei ausbleibendem Poll stehen die letzten Werte weiter (K10).
 */

const FENSTER = [
  { h: 0.25, key: "15m" },
  { h: 1, key: "1h" },
  { h: 6, key: "6h" },
  { h: 24, key: "24h" },
  { h: 72, key: "72h" },
] as const;

const QUELLEN_KEY = "ancientvoid.inference.quelle";
const FENSTER_KEY = "ancientvoid.inference.fenster";
const POLL_MS = 2_000;
/** Einheiten-Kürzel bleiben außerhalb des JSX-Texts (check-i18n zählt sie sonst als String). */
const TOKS = "tok/s";

function hole(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function ablegen(key: string, wert: string): void {
  try {
    localStorage.setItem(key, wert);
  } catch {
    /* privater Modus: Auswahl bleibt(flüchtig) — kein Grund, die Seite zu blockieren */
  }
}

export function InferencePage() {
  const [quellen, setQuellen] = useState<InferenceSourceList | null>(null);
  const [snap, setSnap] = useState<InferenceSnapshot | null>(null);
  const [auswahl, setAuswahl] = useState<string>(() => hole(QUELLEN_KEY, ""));
  const [fensterH, setFensterH] = useState<number>(() => Number(hole(FENSTER_KEY, "24")) || 24);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let lebt = true;
    const tick = async () => {
      try {
        const liste = await hubApi.inferenceSources();
        if (!lebt) return;
        setQuellen(liste);
        const id = liste.quellen.find((q) => q.id === auswahl)?.id ?? liste.quellen[0]?.id ?? "";
        if (id && id !== auswahl) {
          setAuswahl(id);
          ablegen(QUELLEN_KEY, id);
        }
      } catch {
        if (lebt) setStale(true);
      }
    };
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      lebt = false;
      clearInterval(timer);
    };
  }, [auswahl]);

  useEffect(() => {
    if (!auswahl) return;
    let lebt = true;
    const poll = async () => {
      try {
        const s = await hubApi.inferenceSnapshot(auswahl, fensterH);
        if (!lebt) return;
        setSnap(s);
        setStale(false);
      } catch {
        if (lebt) setStale(true);
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      lebt = false;
      clearInterval(timer);
    };
  }, [auswahl, fensterH]);

  if (!quellen) return <EmptyState text={t("inference.empty.loading")} />;
  if (quellen.quellen.length === 0) return <EmptyState text={t("inference.empty.noEngines")} />;

  const alt = alter(snap?.sampledAt ?? null);
  return (
    <div class="inference status-page">
      <div class="inference-kopf">
        <div>
          <strong>{t("inference.title")}</strong>
          <p class="inference-hinweis">{t("inference.hint")}</p>
        </div>
        <div class="inference-quellen" role="group" aria-label={t("inference.dock")}>
          {quellen.quellen.map((q) => (
            <button
              type="button"
              class={q.id === auswahl ? "chip chip--on" : "chip"}
              onClick={() => {
                setAuswahl(q.id);
                ablegen(QUELLEN_KEY, q.id);
              }}
            >
              {q.label}
              {!q.status.ok ? " ✕" : ""}
            </button>
          ))}
        </div>
        <div class="inference-fenster" role="group" aria-label={t("inference.fenster")}>
          {FENSTER.map((f) => (
            <button
              type="button"
              class={fensterH === f.h ? "chip chip--on" : "chip"}
              title={t("inference.fenster.hint")}
              onClick={() => {
                setFensterH(f.h);
                ablegen(FENSTER_KEY, String(f.h));
              }}
            >
              {t(`inference.fenster.${f.key}`)}
            </button>
          ))}
        </div>
      </div>

      {stale && <p role="status" class="inference-fehler">{t("inference.stale")}</p>}
      {!snap && <EmptyState text={t("inference.empty.noSnapshot")} />}
      {snap && (
        <>
          {!snap.status.ok && (
            <p role="status" class="inference-fehler">
              {t("inference.probeFailed", { error: snap.status.error })}
            </p>
          )}
          <dl class="inference-hero">
            <Hero wert={tempo(snap.live?.decodeTokS ?? snap.totals?.window?.decodeTokS)} einheit="tok/s" label={t("inference.hero.decode")} />
            <Hero wert={tempo(snap.live?.prefillTokS ?? snap.totals?.window?.prefillTokS)} einheit="tok/s" label={t("inference.hero.prefill")} />
            <Hero wert={dauer(snap.live?.ttftS)} einheit={snap.live?.ttftS != null ? "" : ""} label={t("inference.hero.ttft")} />
            <Hero
              wert={zahl(snap.totals?.output)}
              einheit=""
              label={t("inference.hero.output")}
              unterzeile={`${t("inference.hero.requests", { n: zahl(snap.totals?.requests) })} · ${t("inference.hero.reuse", { pct: anteil(snap.totals?.reuseShare) })}`}
            />
          </dl>
          <p class="inference-hinweis">
            {t("inference.fenster")} {fensterH} h
            {alt != null ? ` · ${alt} s` : ""}
            {snap.engine.model ? ` · ${snap.engine.model}` : ""}
            {snap.engine.version ? ` ${snap.engine.version}` : ""}
          </p>

          <div class="inference-kacheln">
            <LiveCard snap={snap} />
            <TotalsCard snap={snap} />
            <PerfCard snap={snap} />
            {snap.cache && <CacheCard snap={snap} />}
            {snap.hardware && <HardwareCard snap={snap} />}
            <ProtocolCard snap={snap} />
          </div>
        </>
      )}
    </div>
  );
}

function Hero({ wert, einheit, label, unterzeile }: { wert: string; einheit: string; label: string; unterzeile?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {wert}
        {einheit ? <small> {einheit}</small> : null}
      </dd>
      {unterzeile ? <small>{unterzeile}</small> : null}
    </div>
  );
}

function Werte({ paare }: { paare: Array<[string, string]> }) {
  return (
    <dl class="inference-werte">
      {paare.map(([name, wert]) => (
        <div>
          <dt>{name}</dt>
          <dd>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveCard({ snap }: { snap: InferenceSnapshot }) {
  const linie = verlauf(snap.history.decodeTokS);
  return (
    <Card aria-label={t("inference.card.live")}>
      <strong>{t("inference.card.live")}</strong>
      <p class="inference-hinweis">{t("inference.card.liveHint")}</p>
      <Werte
        paare={[
          [t("inference.live.state"), snap.live?.state ?? "—"],
          [t("inference.live.phase"), snap.live?.phase ?? "—"],
          [t("inference.live.queued"), zahl(snap.live?.queued)],
          [t("inference.live.elapsed"), dauer(snap.live?.elapsedS)],
          [t("inference.live.read"), zahl(snap.live?.read)],
          [t("inference.live.prompt"), zahl(snap.live?.prompt)],
        ]}
      />
      {linie && (
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={t("inference.hero.decode")}>
          <polyline points={linie} fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      )}
    </Card>
  );
}

function TotalsCard({ snap }: { snap: InferenceSnapshot }) {
  const f = snap.totals?.window;
  return (
    <Card aria-label={t("inference.card.totals")}>
      <strong>{t("inference.card.totals")}</strong>
      <p class="inference-hinweis">{t("inference.card.totalsHint")}</p>
      <Werte
        paare={[
          [t("inference.totals.requests"), zahl(snap.totals?.requests)],
          [t("inference.totals.prompt"), zahl(snap.totals?.prompt)],
          [t("inference.totals.read"), zahl(snap.totals?.read)],
          [t("inference.totals.reused"), zahl(snap.totals?.reused)],
          [t("inference.totals.output"), zahl(snap.totals?.output)],
          [t("inference.totals.reuse"), anteil(snap.totals?.reuseShare)],
          [t("inference.totals.prefill"), `${tempo(snap.totals?.avgPrefillTokS)} tok/s`],
          [t("inference.totals.decode"), `${tempo(snap.totals?.avgDecodeTokS)} tok/s`],
          [t("inference.totals.draft"), anteil(snap.totals?.draftAcceptShare)],
          [t("inference.totals.expert"), anteil(snap.totals?.expertHitRate)],
        ]}
      />
      {f && (
        <p class="inference-hinweis">
          {t("inference.window.hint", {
            sekunden: zahl(f.seconds, 1),
            gelesen: zahl(f.read),
            prefill: `${tempo(f.prefillTokS)} tok/s`,
            decode: `${tempo(f.decodeTokS)} tok/s`,
          })}
        </p>
      )}
    </Card>
  );
}

function PerfRow({ titel, zeile, einheit }: { titel: string; zeile: InferencePerfRow; einheit: string }) {
  return (
    <tr>
      <td>
        {titel}
        <br />
        <small>{zeile.bereich}</small>
      </td>
      <td>{zahl(zeile.n)}</td>
      <td>{tempo(zeile.p10)}</td>
      <td>{tempo(zeile.p50)}</td>
      <td>{tempo(zeile.p90)}</td>
      <td>{tempo(zeile.mean)}</td>
      <td>
        {tempo(zeile.peak)}
        {einheit === "s" ? " s" : ""}
        {zeile.ausreisser > 0 && zeile.peakRobust != null ? (
          <br />
        ) : null}
        {zeile.ausreisser > 0 && zeile.peakRobust != null ? (
          <small>
            {t("inference.perf.peakOhne")} {tempo(zeile.peakRobust)}
            {einheit === "s" ? " s" : ""} · {t("inference.perf.ausreisser", { n: zeile.ausreisser })}
          </small>
        ) : null}
      </td>
    </tr>
  );
}

function PerfCard({ snap }: { snap: InferenceSnapshot }) {
  const perf = snap.perf;
  return (
    <Card aria-label={t("inference.card.perf")}>
      <strong>{t("inference.card.perf")}</strong>
      {!perf && <p class="inference-hinweis">{t("inference.perf.noRequests")}</p>}
      {perf && (
        <>
          <p class="inference-hinweis">{t("inference.card.perfHint", { anzahl: snap.requests.length, schwelle: zahl(perf.schwelleGelesen) })}</p>
          <table class="inference-tabelle">
            <thead>
              <tr>
                <th>{t("inference.perf.decode")}</th>
                <th>{t("inference.schichten.anzahl")}</th>
                <th>{t("inference.perf.p10")}</th>
                <th>{t("inference.perf.p50")}</th>
                <th>{t("inference.perf.p90")}</th>
                <th>{t("inference.perf.mean")}</th>
                <th>{t("inference.perf.peak")}</th>
              </tr>
            </thead>
            <tbody>
              {perf.decode.map((z) => (
                <PerfRow titel={t("inference.perf.decode")} zeile={z} einheit="tok/s" />
              ))}
              {perf.prefill.map((z) => (
                <PerfRow titel={t("inference.perf.prefill")} zeile={z} einheit="tok/s" />
              ))}
              {perf.ttft.map((z) => (
                <PerfRow titel={t("inference.perf.ttft")} zeile={z} einheit="s" />
              ))}
            </tbody>
          </table>
          <p class="inference-hinweis">{t("inference.schichten.title")} — {t("inference.schichten.hint")}</p>
          <table class="inference-tabelle">
            <tbody>
              {perf.groessenSchichten.map((s) => (
                <tr>
                  <td>{s.label}</td>
                  <td>{zahl(s.n)}</td>
                  <td>{tempo(s.p50)}</td>
                  <td>{tempo(s.p90)}</td>
                  <td>{tempo(s.peak)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {perf.asymptote && (
            <p class="inference-hinweis">
              {t("inference.asymptote.title")}: {tempo(perf.asymptote.tokS)} {TOKS} · {t("inference.asymptote.overhead")}{" "}
              {dauer((perf.asymptote.overheadMs ?? 0) / 1000)} · {t("inference.asymptote.guete")}{" "}
              {perf.asymptote.r2 == null ? "—" : zahl(perf.asymptote.r2, 2)}
            </p>
          )}
          {perf.engineHinweis && <p class="inference-hinweis">{perf.engineHinweis}</p>}
        </>
      )}
    </Card>
  );
}

function CacheCard({ snap }: { snap: InferenceSnapshot }) {
  const c = snap.cache!;
  return (
    <Card aria-label={t("inference.card.cache")}>
      <strong>{t("inference.card.cache")}</strong>
      <p class="inference-hinweis">{t("inference.card.cacheHint")}</p>
      <Werte
        paare={[
          [t("inference.cache.hitRate"), anteil(c.hitRate)],
          [t("inference.cache.tokenHitRate"), anteil(c.tokenHitRate)],
          [t("inference.cache.savedTokens"), zahl(c.savedTokens)],
          [t("inference.cache.entries"), zahl(c.entries)],
          [t("inference.cache.bytes"), byteGroesse(c.bytes)],
          [t("inference.cache.evictions"), zahl(c.evictions)],
          [t("inference.cache.budgetMib"), c.budgetMib == null ? "—" : `${zahl(c.budgetMib)} MiB`],
          [t("inference.cache.parked"), zahl(c.parked)],
          [t("inference.cache.restores"), zahl(c.restores)],
          [t("inference.cache.refusedTotal"), zahl(c.refusedTotal)],
          [t("inference.cache.longestWaitS"), dauer(c.longestWaitS)],
          [t("inference.cache.poolBelegung"), anteil(c.poolBelegung)],
        ]}
      />
    </Card>
  );
}

function Balken({ anteilWert, klassen }: { anteilWert: number | null; klassen?: string }) {
  if (anteilWert == null) return null;
  const breit = Math.max(0, Math.min(1, anteilWert)) * 100;
  return (
    <div class={["inference-balken", klassen].filter(Boolean).join(" ")}>
      <span style={`width:${breit}%`} />
    </div>
  );
}

function HardwareCard({ snap }: { snap: InferenceSnapshot }) {
  const h = snap.hardware!;
  const vramAnteil = h.vramTotalBytes ? (h.vramUsedBytes ?? 0) / h.vramTotalBytes : null;
  return (
    <Card aria-label={t("inference.card.hardware")}>
      <strong>{t("inference.card.hardware")}</strong>
      <p class="inference-hinweis">{t("inference.card.hardwareHint")}</p>
      <Werte
        paare={[
          [t("inference.hardware.gpu"), h.gpuName ?? "—"],
          [t("inference.hardware.util"), anteil(h.gpuUtil)],
          [t("inference.hardware.temp"), h.gpuTempC == null ? "—" : `${zahl(h.gpuTempC)} °C`],
          [t("inference.hardware.vram"), `${byteGroesse(h.vramUsedBytes)} / ${byteGroesse(h.vramTotalBytes)}`],
          [t("inference.hardware.power"), h.powerW == null ? "—" : `${zahl(h.powerW)} W${h.powerLimitW ? ` / ${zahl(h.powerLimitW)} W` : ""}`],
          [t("inference.hardware.pcie"), h.pcieGen == null ? "—" : `Gen ${h.pcieGen} × ${h.pcieWidth ?? "?"}`],
          [t("inference.hardware.ram"), `${byteGroesse(h.ramUsedBytes)} / ${byteGroesse(h.ramTotalBytes)}`],
        ]}
      />
      <Balken anteilWert={h.gpuUtil} />
      <Balken anteilWert={vramAnteil} klassen={vramAnteil != null && vramAnteil >= 0.9 ? "inference-balken--warn" : undefined} />
      <Balken anteilWert={h.gpuTempC == null ? null : h.gpuTempC / 100} klassen={h.gpuTempC != null && h.gpuTempC >= 85 ? "inference-balken--err" : undefined} />
    </Card>
  );
}

function ProtocolCard({ snap }: { snap: InferenceSnapshot }) {
  const reihen = [...snap.requests].reverse();
  return (
    <Card aria-label={t("inference.card.protocol")}>
      <strong>{t("inference.card.protocol")}</strong>
      <p class="inference-hinweis">{t("inference.card.protocolHint")}</p>
      {reihen.length === 0 && <p class="inference-hinweis">{t("inference.protocol.leer")}</p>}
      {reihen.length > 0 && (
        <table class="inference-tabelle">
          <thead>
            <tr>
              <th>{t("inference.protocol.read")}</th>
              <th>{t("inference.protocol.prompt")}</th>
              <th>{t("inference.protocol.output")}</th>
              <th>{t("inference.protocol.prefill")}</th>
              <th>{t("inference.protocol.decode")}</th>
              <th>{t("inference.protocol.ttft")}</th>
            </tr>
          </thead>
          <tbody>
            {reihen.map((r) => (
              <tr key={r.id}>
                <td>{zahl(r.read)}</td>
                <td>{zahl(r.prompt)}</td>
                <td>{zahl(r.output)}</td>
                <td>{tempo(r.prefillTokS)}</td>
                <td>{tempo(r.decodeTokS)}</td>
                <td>{dauer(r.ttftS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

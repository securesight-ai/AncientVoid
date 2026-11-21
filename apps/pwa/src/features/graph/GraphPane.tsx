import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GraphDiagnosis, GraphGroup, GraphReport } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";
import { ctxMotionOn } from "../../app/ui-scale.ts";
import { GalaxyPanel } from "./GalaxyPanel.tsx";
import { galaxyLayout, systemLabel } from "./galaxy-layout.ts";
import { ROOT_CATEGORY, categoriesOf, loadGalaxyView, neighborInDirection, neighborsOf, saveGalaxyView, searchFiles, type Compass } from "./galaxy-query.ts";
import { FLIGHT_MS, backingScale, baseName, detailLevel, fitCircle, flightAt, pinchStep, placeLabels, zoomAt, type Camera, type LabelCandidate, type PlacedLabel } from "./galaxy-view.ts";
import { Button } from "../../shared/ui/index.ts";

/** EPIC-P48 (ADR-0062 §3.4) + EPIC-P52: Repo-Graph als Galaxie auf einem Canvas.
 * Bereiche sind Sternsysteme, Dateien Sterne; je nach Zoom zeigt die Karte
 * Systeme und gebündelte Filamente, alle Sterne oder deren Namen. Layout wird
 * einmal pro Datenstand berechnet; ohne Motion gibt es genau ein statisches Bild. */

const GROUP_LABEL: Record<GraphGroup, string> = { doc: "Doc", code: "Code", config: "Config", other: "Sonstiges" };
const PULSE_MAX = 60;
const PULSE_BUDGET = 400; // Kanten mit eigenem Spawner — Deckel gegen 10k-Kanten-Graphs
const PULSE_DURATION = 700;
/** Über diesem gleitenden Mittel (ms pro Bild) schaltet die Karte sichtbar auf die vereinfachte Darstellung. */
const PHONE_MQ = "(max-width: 699px), (max-height: 699px)";
/** Über diesem gleitenden Mittel (ms pro Bild) schaltet die Karte sichtbar auf die vereinfachte Darstellung. */
const FRAME_BUDGET_MS = 16;
const LABEL_FONT_PX = 11;
const SYSTEM_FONT_PX = 13;

interface Pulse {
  edge: number; // Index in edges
  start: number;
  dir: 1 | -1;
}

function hashOf(path: string): number {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = (Math.imul(h, 33) ^ path.charCodeAt(i)) >>> 0;
  return h;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** BUG-0231: aktueller UI-Zoom (root.style.zoom, gespiegelt in --ui-zoom). */
function uiZoom(): number {
  const v = parseFloat(cssVar("--ui-zoom", "1"));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Schätzung statt measureText — pro Bild hunderte Namen, und die Schrift ist schmal genug. */
const textWidth = (text: string, px: number) => text.length * px * 0.58;

export function GraphPane({ target, hostId = null, onOpenFile, onFullscreen }: { target: string; hostId?: string | null; onOpenFile: (path: string) => void; onFullscreen?: (full: boolean) => void }) {
  const api = useMemo(() => hostApi(hostId), [hostId]);
  const [report, setReport] = useState<GraphReport | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [diag, setDiag] = useState<GraphDiagnosis | null>(null);
  const [diagErr, setDiagErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [hover, setHover] = useState<{ path: string; group: GraphGroup; in: number; out: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [colorsTick, setColorsTick] = useState(0);
  const [motionOn, setMotionOn] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches && ctxMotionOn());
  const [viewTick, setViewTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [twoHop, setTwoHop] = useState(false);
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  // BUG-0232: aktive Kategorie-Filter (dynamisch aus dem Repo erkannt).
  const [cats, setCats] = useState<string[]>([]);
  const [deadOnly, setDeadOnly] = useState(false);
  const [errorOnly, setErrorOnly] = useState(false);
  const [sheet, setSheet] = useState<"line" | "open">("line");
  const [full, setFull] = useState(() => matchMedia(PHONE_MQ).matches);
  const [narrow, setNarrow] = useState(() => matchMedia(PHONE_MQ).matches);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<Camera>({ scale: 1, tx: 0, ty: 0 });
  const fittedRef = useRef<object | null>(null);
  const flightRef = useRef(0);
  const drawRef = useRef<(() => void) | null>(null);
  const hoverRef = useRef<string | null>(null);
  const persistReady = useRef(false);
  const skipSave = useRef(true);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusRef = useRef<{ selected: string | null; bright: Set<string> | null; system: string | null; groups: GraphGroup[]; cats: string[]; deadOnly: boolean; errorOnly: boolean }>({
    selected: null, bright: null, system: null, groups: [], cats: [], deadOnly: false, errorOnly: false,
  });

  useEffect(() => {
    let alive = true;
    setReport(null);
    setLoadErr("");
    setDiag(null);
    setDiagErr("");
    api
      .graph(target)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [api, target]);

  const runCheck = () => {
    if (checking || !report) return;
    setChecking(true);
    setDiagErr("");
    api
      .graphDiagnose(target)
      .then((d) => {
        setDiag(d);
        setChecking(false);
      })
      .catch((e: unknown) => {
        setDiagErr(e instanceof Error ? e.message : String(e));
        setChecking(false);
      });
  };

  // Farben zur Laufzeit aus den CSS-Variablen — Akzent/Theme können wechseln.
  useEffect(() => {
    const bump = () => setColorsTick((t) => t + 1);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) bump();
    };
    window.addEventListener("ancientvoid:appearance", bump);
    window.addEventListener("ancientvoid:theme", bump);
    // BUG-0231: UI-Zoom ändert die Canvas-Auflösung — Backing-Store neu vermessen.
    window.addEventListener("ancientvoid:scale", bump);
    window.addEventListener("storage", onStorage);
    // ctxMotion wird ohne Event gesetzt — der Dataset-Attributwechsel ist das Signal.
    const mo = new MutationObserver(() => setMotionOn(!matchMedia("(prefers-reduced-motion: reduce)").matches && ctxMotionOn()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ctx-motion"] });
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setMotionOn(!mq.matches && ctxMotionOn());
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("ancientvoid:appearance", bump);
      window.removeEventListener("ancientvoid:theme", bump);
      window.removeEventListener("ancientvoid:scale", bump);
      window.removeEventListener("storage", onStorage);
      mo.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  useEffect(() => {
    const mq = matchMedia(PHONE_MQ);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    onFullscreen?.(full);
    return () => onFullscreen?.(false);
  }, [full, onFullscreen]);

  // Layout nur bei Datenwechsel — Größe und Kamera verschieben nie einen Stern.
  const layout = useMemo(() => (report ? galaxyLayout(report.nodes, report.edges) : null), [report]);
  const errorByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of diag?.byFile ?? []) if (f.errors > 0) m.set(f.path, f.errors);
    return m;
  }, [diag]);

  // Sterne als flache Felder — Draw und Hit-Test laufen pro Bild über alle Dateien.
  const geo = useMemo(() => {
    if (!report || !layout) return null;
    const nodes = report.nodes;
    const xs = new Float64Array(nodes.length);
    const ys = new Float64Array(nodes.length);
    const radii = new Float32Array(nodes.length);
    const core = new Uint8Array(nodes.length);
    const sysOf = new Int32Array(nodes.length).fill(-1);
    const sysIndex = new Map(layout.systems.map((s, i) => [s.id, i]));
    let maxDeg = 1;
    for (const n of nodes) maxDeg = Math.max(maxDeg, n.in + n.out);
    const groupCount = layout.systems.map(() => ({ doc: 0, code: 0, config: 0, other: 0 }) as Record<GraphGroup, number>);
    nodes.forEach((n, i) => {
      const star = layout.stars.get(n.path);
      if (!star) return;
      xs[i] = star.x;
      ys[i] = star.y;
      core[i] = star.core ? 1 : 0;
      radii[i] = 2.5 + 3.5 * Math.sqrt((n.in + n.out) / maxDeg);
      const s = sysIndex.get(star.system) ?? -1;
      sysOf[i] = s;
      if (s >= 0) groupCount[s][n.group]++;
    });
    const sysGroup = groupCount.map((c) => (Object.keys(c) as GraphGroup[]).reduce((a, b) => (c[b] > c[a] ? b : a)));
    const indexOf = new Map(nodes.map((n, i) => [n.path, i]));
    const edgeIdx = report.edges.map((e) => [indexOf.get(e.from) ?? -1, indexOf.get(e.to) ?? -1] as const);
    return { xs, ys, radii, core, sysOf, sysGroup, edgeIdx };
  }, [report, layout]);

  // Erste Ansicht je Datenstand: gespeicherte Kamera, sonst die ganze Galaxie.
  useEffect(() => {
    if (!layout || !report || size.w === 0 || size.h === 0 || fittedRef.current === report) return;
    fittedRef.current = report;
    const saved = loadGalaxyView(target);
    const star = (path: string | null) => !!path && layout.stars.has(path);
    if (saved) {
      viewRef.current = saved.camera;
      setSelected(star(saved.selected) ? saved.selected : null);
      setSystemId(saved.system && layout.systems.some((s) => s.id === saved.system) ? saved.system : null);
      setTwoHop(saved.twoHop);
      setGroups(saved.groups);
      // BUG-0232: nur Kategorien restaurieren, die es im aktuellen Repo noch gibt — sonst dimmt ein Relikt alles.
      const present = new Set(report.nodes.map((n) => n.category ?? ROOT_CATEGORY));
      setCats(saved.cats.filter((c) => present.has(c)));
      setDeadOnly(saved.deadOnly);
      setErrorOnly(saved.errorOnly);
      skipSave.current = true;
    } else {
      viewRef.current = fitCircle(0, 0, layout.radius, size.w, size.h);
      skipSave.current = false;
    }
    persistReady.current = true;
    setViewTick((t) => t + 1);
  }, [layout, report, size.w, size.h, target]);

  useEffect(() => {
    if (!persistReady.current || !report) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    saveGalaxyView(target, { camera: viewRef.current, selected, system: systemId, twoHop, groups, cats, deadOnly, errorOnly });
  }, [viewTick, selected, systemId, twoHop, groups, cats, deadOnly, errorOnly, target, report]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || !report || !geo) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const nodes = report.nodes;
    const edges = report.edges;
    const { xs, ys, radii, core, sysOf, sysGroup, edgeIdx } = geo;
    const w = size.w;
    const h = size.h;
    // BUG-0231: Backing-Store in Gerätepixeln × UI-Zoom — sonst zeichnet die Karte
    // bei erhöhtem UI-Zoom hochskaliert und wirkt unscharf.
    const dpr = backingScale(window.devicePixelRatio || 1, uiZoom());
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const colors: Record<GraphGroup, string> = {
      doc: cssVar("--accent", "#7aa2f7"),
      code: cssVar("--graph-code", "#9ece6a"),
      config: cssVar("--graph-config", "#e0af68"),
      other: cssVar("--graph-other", "#a9b1d6"),
    };
    const errColor = cssVar("--err", "#f7768e");
    const fg = cssVar("--fg", "#c0caf5");
    const font = cssVar("--font-ui", "system-ui, sans-serif");

    // Puls-Phasen deterministisch aus dem Pfad — kein Flackern bei Neulayout.
    const phases = new Float32Array(nodes.length);
    const speeds = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const hash = hashOf(nodes[i].path);
      phases[i] = ((hash % 997) / 997) * Math.PI * 2;
      speeds[i] = 0.5 + ((hash >>> 10) % 997) / 997; // 0.5–1.5
    }
    const errIdx = new Set<number>();
    for (let i = 0; i < nodes.length; i++) if (errorByPath.has(nodes[i].path)) errIdx.add(i);
    const sysPos = new Map(layout.systems.map((s) => [s.id, [s.x, s.y] as const]));

    // Lichtpulse: Spawner auf einem gestreuten Kanten-Ausschnitt (Budget-Deckel).
    const stride = Math.max(1, Math.ceil(edges.length / PULSE_BUDGET));
    const spawnAt = new Float64Array(PULSE_BUDGET).fill(-1);
    let pulses: Pulse[] = [];
    let frameMs = 0;
    let slow = false;
    // Namen nur neu platzieren, wenn sich die Kamera bewegt hat.
    let labelKey = "";
    let labels: PlacedLabel[] = [];

    const placeFor = (cam: Camera, detail: ReturnType<typeof detailLevel>, inView: (i: number) => boolean) => {
      const key = `${cam.scale}:${cam.tx}:${cam.ty}:${detail}`;
      if (key === labelKey) return labels;
      labelKey = key;
      const candidates: LabelCandidate[] = [];
      const sx = (x: number) => x * cam.scale + cam.tx;
      const sy = (y: number) => y * cam.scale + cam.ty;
      for (const s of layout.systems) {
        const top = sy(s.y - s.radius) - 4;
        candidates.push({ text: `${systemLabel(s.id)} (${s.files.length})`, x: sx(s.x), y: detail === "far" ? sy(s.y) - 8 : top, priority: 1e9 + s.files.length });
      }
      if (detail !== "far") {
        for (let i = 0; i < nodes.length; i++) {
          if (!inView(i)) continue;
          // mittel: nur Kernsterne beschriften, nah: alle sichtbaren.
          if (detail === "mid" && !core[i]) continue;
          candidates.push({ text: baseName(nodes[i].path), x: sx(xs[i]), y: sy(ys[i]) - radii[i] * cam.scale - 3, priority: nodes[i].in + nodes[i].out });
        }
      }
      labels = placeLabels(candidates, (t) => textWidth(t, LABEL_FONT_PX), LABEL_FONT_PX + 2);
      return labels;
    };

    const draw = (now: number | null) => {
      const t0 = performance.now();
      const cam = viewRef.current;
      const { scale, tx, ty } = cam;
      const detail = slow ? "far" : detailLevel(scale);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
      // Viewport in Weltkoordinaten (plus Rand) — Cull vor dem Zeichnen.
      const pad = 20 / scale;
      const vx0 = -tx / scale - pad;
      const vy0 = -ty / scale - pad;
      const vx1 = (w - tx) / scale + pad;
      const vy1 = (h - ty) / scale + pad;
      const inView = (i: number) => xs[i] >= vx0 && xs[i] <= vx1 && ys[i] >= vy0 && ys[i] <= vy1;
      const px = 1 / scale;

      // Nebel je System: Farbe der häufigsten Gruppe, nach außen auslaufend.
      layout.systems.forEach((s, si) => {
        if (s.x + s.radius < vx0 || s.x - s.radius > vx1 || s.y + s.radius < vy0 || s.y - s.radius > vy1) return;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius * 1.1);
        g.addColorStop(0, colors[sysGroup[si]]);
        g.addColorStop(1, "transparent");
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 1.1, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = fg;
      if (detail === "far") {
        // Filamente: gebündelte Kanten zwischen Systemen, Stärke nach Anzahl.
        for (const l of layout.links) {
          const a = sysPos.get(l.a), b = sysPos.get(l.b);
          if (!a || !b) continue;
          ctx.globalAlpha = Math.min(0.35, 0.08 + 0.04 * Math.log2(1 + l.count));
          ctx.lineWidth = (0.8 + Math.log2(1 + l.count) * 0.6) * px;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      } else {
        ctx.lineWidth = px;
        ctx.globalAlpha = detail === "near" ? 0.22 : 0.12;
        ctx.beginPath();
        for (const [a, b] of edgeIdx) {
          if (a < 0 || b < 0 || (!inView(a) && !inView(b))) continue;
          ctx.moveTo(xs[a], ys[a]);
          ctx.lineTo(xs[b], ys[b]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const dimOf = (i: number) => {
        const f = focusRef.current;
        const n = nodes[i];
        if (!n) return false;
        if (f.bright && !f.bright.has(n.path)) return true;
        if (f.system) {
          const star = layout.stars.get(n.path);
          if (star && star.system !== f.system) return true;
        }
        if (f.groups.length > 0 && !f.groups.includes(n.group)) return true;
        if (f.cats.length > 0 && !f.cats.includes(n.category ?? ROOT_CATEGORY)) return true;
        if (f.deadOnly && !(n.in === 0 && !n.entry)) return true;
        if (f.errorOnly && !errIdx.has(i)) return true;
        return false;
      };
      const fade = (i: number, alpha: number) => (dimOf(i) ? alpha * 0.15 : alpha);

      // Fokus: Kanten der Auswahl mit Pfeilspitze in Kantenrichtung. Farbe ist nur ein Kanal.
      const sel = focusRef.current.selected;
      if (sel && detail !== "far") {
        for (let ei = 0; ei < edges.length; ei++) {
          const e = edges[ei];
          if (!e || (e.from !== sel && e.to !== sel)) continue;
          const pair = edgeIdx[ei];
          if (!pair) continue;
          const [a, b] = pair;
          if (a < 0 || b < 0) continue;
          const incoming = e.to === sel;
          ctx.strokeStyle = incoming ? colors.doc : colors.code;
          ctx.fillStyle = incoming ? colors.doc : colors.code;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.6 * px;
          ctx.beginPath();
          ctx.moveTo(xs[a], ys[a]);
          ctx.lineTo(xs[b], ys[b]);
          ctx.stroke();
          const len = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) || 1;
          const ux = (xs[b] - xs[a]) / len;
          const uy = (ys[b] - ys[a]) / len;
          const tipR = Math.max(radii[b], 2 * px) + 3 * px;
          const tipX = xs[b] - ux * tipR;
          const tipY = ys[b] - uy * tipR;
          const head = 7 * px;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * head - uy * head * 0.45, tipY - uy * head + ux * head * 0.45);
          ctx.lineTo(tipX - ux * head + uy * head * 0.45, tipY - uy * head - ux * head * 0.45);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      const animate = now !== null && motionOn && !slow;
      for (let i = 0; i < nodes.length; i++) {
        if (sysOf[i] < 0 || !inView(i)) continue;
        const dead = nodes[i].in === 0 && !nodes[i].entry;
        const isErr = errIdx.has(i);
        ctx.fillStyle = isErr ? errColor : colors[nodes[i].group];
        if (detail === "far" && !core[i] && !isErr) {
          // Armsterne von fern als Staub — ein Pixel, kein Pfad.
          ctx.globalAlpha = fade(i, dead ? 0.35 : 0.75);
          ctx.fillRect(xs[i] - px * 0.75, ys[i] - px * 0.75, px * 1.5, px * 1.5);
          continue;
        }
        const r = Math.max(radii[i], 1.2 * px);
        if (animate) {
          const speed = isErr ? speeds[i] * 2.2 : speeds[i];
          const osc = 0.5 + 0.5 * Math.sin((now / 1000) * speed * Math.PI * 2 + phases[i]);
          ctx.globalAlpha = fade(i, dead ? 0.55 : 0.55 + 0.45 * osc);
          ctx.beginPath();
          ctx.arc(xs[i], ys[i], r + osc * 1.2 * Math.min(1, scale), 0, Math.PI * 2);
        } else {
          ctx.globalAlpha = fade(i, dead ? 0.55 : 0.85);
          ctx.beginPath();
          ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
        }
        // Leuchten nur für Doc-Kernsterne — shadowBlur ist pro Stern teuer.
        if (nodes[i].group === "doc" && core[i] && !dead) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = colors.doc;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      if (animate && detail !== "far") {
        // Fällige Spawner abräumen, max. PULSE_MAX gleichzeitig aktiv.
        for (let s = 0; s < spawnAt.length; s++) {
          const edge = s * stride;
          if (edge >= edges.length) break;
          if (spawnAt[s] < 0) spawnAt[s] = now + 2000 + (hashOf(String(edge) + s) % 6000);
          else if (now >= spawnAt[s] && pulses.length < PULSE_MAX) {
            const [a, b] = edgeIdx[edge];
            const selNow = focusRef.current.selected;
            const touch = !selNow || nodes[a]?.path === selNow || nodes[b]?.path === selNow;
            if (a >= 0 && b >= 0 && touch && (inView(a) || inView(b))) {
              const dir: 1 | -1 = selNow ? 1 : hashOf(String(now) + edge) % 2 === 0 ? 1 : -1;
              pulses.push({ edge, start: now, dir });
            }
            spawnAt[s] = now + 2000 + (hashOf(String(s) + String(now)) % 6000); // 2–8 s unregelmäßig
          }
        }
        pulses = pulses.filter((pu) => now - pu.start < PULSE_DURATION);
        for (const pu of pulses) {
          const [a, b] = edgeIdx[pu.edge];
          const t = (now - pu.start) / PULSE_DURATION;
          const eased = pu.dir === 1 ? t : 1 - t;
          ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
          ctx.fillStyle = colors.doc;
          ctx.beginPath();
          ctx.arc(xs[a] + (xs[b] - xs[a]) * eased, ys[a] + (ys[b] - ys[a]) * eased, Math.max(1.8, 1.5 * px), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (sel) {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].path !== sel) continue;
          ctx.strokeStyle = fg;
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.arc(xs[i], ys[i], Math.max(radii[i], 1.2 * px) + 4 * px, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
      ctx.globalAlpha = 1;

      // Namen in Bildschirmkoordinaten — gleich groß bei jedem Zoom, nie überdeckt.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const l of placeFor(cam, detail, inView)) {
        const isSystem = l.priority >= 1e9;
        ctx.font = `${isSystem ? SYSTEM_FONT_PX : LABEL_FONT_PX}px ${font}`;
        ctx.globalAlpha = isSystem ? 0.85 : 0.7;
        ctx.fillStyle = fg;
        ctx.fillText(l.text, l.x, l.y);
      }
      ctx.globalAlpha = 1;

      // Leistungsdeckel: gleitendes Mittel, Umschalten sichtbar statt still ruckeln.
      frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
      if (!slow && now !== null && frameMs > FRAME_BUDGET_MS) {
        slow = true;
        setSimplified(true);
      }
    };
    drawRef.current = () => draw(null);

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || !motionOn || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (motionOn) {
      start();
      document.addEventListener("visibilitychange", onVisibility);
    } else {
      draw(null);
    }
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      drawRef.current = null;
      pulses = [];
    };
  }, [layout, report, geo, size.w, size.h, motionOn, colorsTick, errorByPath]);

  const neighborList = useMemo(
    () => (selected && report ? neighborsOf(selected, report.edges, twoHop ? 2 : 1) : []),
    [selected, report, twoHop],
  );
  focusRef.current = {
    selected,
    bright: selected ? new Set([selected, ...neighborList.map((n) => n.path)]) : null,
    system: systemId,
    groups,
    cats,
    deadOnly,
    errorOnly,
  };
  useEffect(() => {
    drawRef.current?.();
  }, [selected, systemId, twoHop, groups, cats, deadOnly, errorOnly, neighborList]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(flightRef.current);
    };
  }, []);

  /** Kamera fliegt zum Ziel; ohne Motion springt sie. */
  const flyTo = (to: Camera) => {
    cancelAnimationFrame(flightRef.current);
    const from = { ...viewRef.current };
    if (!motionOn) {
      viewRef.current = to;
      drawRef.current?.();
      setViewTick((t) => t + 1);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / FLIGHT_MS;
      viewRef.current = flightAt(from, to, t, size.w, size.h);
      if (t < 1) flightRef.current = requestAnimationFrame(step);
      else setViewTick((v) => v + 1);
    };
    flightRef.current = requestAnimationFrame(step);
  };
  const fitAll = () => {
    setSystemId(null);
    if (layout && size.w > 0) flyTo(fitCircle(0, 0, layout.radius, size.w, size.h));
  };
  const selectPath = (path: string) => {
    setSelected(path);
    setSheet("line");
    const star = layout?.stars.get(path);
    if (!star || size.w === 0) return;
    const scale = Math.max(viewRef.current.scale, 1.2);
    flyTo({ scale, tx: size.w / 2 - star.x * scale, ty: size.h / 2 - star.y * scale });
  };
  /** BUG-0233: Datei anklicken heißt anschauen — Auswahl plus Viewer/Editor. */
  const openPath = (path: string) => {
    selectPath(path);
    onOpenFile(path);
  };
  const enterSystem = (id: string) => {
    const s = layout?.systems.find((x) => x.id === id);
    if (!s || size.w === 0) return;
    setSystemId(id);
    setSelected(null);
    flyTo(fitCircle(s.x, s.y, s.radius, size.w, size.h));
  };
  const exitSystem = () => {
    setSystemId(null);
    fitAll();
  };

  const hitTest = (mx: number, my: number): number => {
    if (!report || !geo) return -1;
    const { scale, tx, ty } = viewRef.current;
    const wx = (mx - tx) / scale;
    const wy = (my - ty) / scale;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < report.nodes.length; i++) {
      if (geo.sysOf[i] < 0) continue;
      const d = (geo.xs[i] - wx) ** 2 + (geo.ys[i] - wy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    const limit = geo.radii[best] + 4 / scale;
    return bestD <= limit * limit ? best : -1;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || !report) return;
    cancelAnimationFrame(flightRef.current);
    const rect = canvas.getBoundingClientRect();
    const v = viewRef.current;
    viewRef.current = zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, v.scale * Math.exp(-e.deltaY * 0.0015));
    drawRef.current?.();
    setViewTick((t) => t + 1);
  };

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // BUG-0231: aktive Zeiger für Pinch (zwei Finger = Zoom + Schwenk um den Mittelpunkt).
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const pinchGeom = () => {
    const [a, b] = [...pointersRef.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  // Nach einem Pan darf der browser-eigene Klick auf dem Stern-Knopf nicht mehr als Auswahl zählen.
  const suppressClickRef = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      pinchRef.current = pinchGeom();
      if (dragRef.current) dragRef.current.moved = true;
      return;
    }
    // BUG-0229: Capture nur außerhalb der Treffer-Knöpfe — sonst schluckt sie der Wrap-Klick.
    if (!(e.target as Element).closest?.("button")) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cancelAnimationFrame(flightRef.current);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    suppressClickRef.current = false;
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !report) return;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // BUG-0231: zwei Zeiger = Pinch — Zoom um den Mittelpunkt, Schwenk um dessen Bewegung.
    if (pointersRef.current.size >= 2) {
      const geom = pinchGeom();
      if (pinchRef.current) {
        viewRef.current = pinchStep(viewRef.current, pinchRef.current, geom);
        drawRef.current?.();
      }
      pinchRef.current = geom;
      if (dragRef.current) dragRef.current.moved = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        const v = viewRef.current;
        viewRef.current = { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
        drag.x = e.clientX;
        drag.y = e.clientY;
        drawRef.current?.();
      }
      return;
    }
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) {
      const n = report.nodes[idx];
      hoverRef.current = n.path;
      setHover({ path: n.path, group: n.group, in: n.in, out: n.out, x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else if (hoverRef.current !== null) {
      hoverRef.current = null;
      setHover(null);
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      // Pinch wird Ein-Finger-Pan: Anker auf den verbleibenden Finger, ohne Klick.
      const [p] = [...pointersRef.current.values()];
      dragRef.current = { x: p.x, y: p.y, moved: true };
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.moved) setViewTick((t) => t + 1);
    suppressClickRef.current = drag?.moved === true;
    if (!drag || drag.moved || !report) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) openPath(report.nodes[idx].path);
  };
  const onPointerLeave = () => {
    hoverRef.current = null;
    setHover(null);
    // Drag ohne Capture (Start auf einem Treffer-Knopf): beim Verlassen der Fläche sauber enden.
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<GraphGroup, number> = { doc: 0, code: 0, config: 0, other: 0 };
    let dead = 0;
    for (const n of report?.nodes ?? []) {
      c[n.group]++;
      if (n.in === 0 && !n.entry) dead++;
    }
    return { c, dead };
  }, [report]);
  // BUG-0232: Kategorie-Bereiche dynamisch aus dem Datenstand — nicht einbrennen.
  const categories = useMemo(() => categoriesOf(report?.nodes ?? []), [report]);
  const errorTotal = diag ? diag.byFile.reduce((sum, f) => sum + f.errors, 0) : 0;
  // DOM-Hit-Flächen für E2E/Tastatur: die ~400 grad-stärksten Knoten, viewport-gecullt,
  // reines Overlay — Positionen werden nach Zoom/Pan-Ende nachgezogen, nicht pro Frame.
  const hitNodes = useMemo(() => {
    if (!report || !geo) return [];
    const { scale, tx, ty } = viewRef.current;
    const inside = (i: number) => {
      const x = geo.xs[i] * scale + tx, y = geo.ys[i] * scale + ty;
      return geo.sysOf[i] >= 0 && x >= -10 && x <= size.w + 10 && y >= -10 && y <= size.h + 10;
    };
    return report.nodes
      .map((n, i) => ({ n, i, deg: n.in + n.out }))
      .filter(({ i }) => inside(i))
      .sort((a, b) => b.deg - a.deg)
      .slice(0, 400)
      .map(({ n, i }) => {
        // BUG-0231: Deckel — bei tiefem Zoom würden die Knöpfe sonst halbe Karte überlappen.
        const side = Math.min(120, Math.max(10, (geo.radii[i] + 4) * scale));
        return {
          path: n.path,
          dead: n.in === 0 && !n.entry,
          hasError: errorByPath.has(n.path),
          style: { left: `${geo.xs[i] * scale + tx - side / 2}px`, top: `${geo.ys[i] * scale + ty - side / 2}px`, width: `${side}px`, height: `${side}px` },
        };
      });
  }, [report, geo, errorByPath, size.w, size.h, viewTick]);

  const hits = report ? searchFiles(report.nodes, query) : [];
  const selectedNode = report?.nodes.find((n) => n.path === selected) ?? null;
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (narrow && sheet === "open") setSheet("line");
      else if (selected) setSelected(null);
      else if (systemId) exitSystem();
      else if (full) setFull(false);
      return;
    }
    if (e.key === "Enter" && selected && e.target === e.currentTarget) {
      e.preventDefault();
      onOpenFile(selected);
      return;
    }
    const arrow: Record<string, Compass> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const dir = arrow[e.key];
    if (dir && selected && report && layout) {
      e.preventDefault();
      const next = neighborInDirection(selected, report.edges, (p) => {
        const s = layout.stars.get(p);
        return s ? { x: s.x, y: s.y } : undefined;
      }, dir);
      if (next) selectPath(next);
    }
  };

  return (
    <div class="graph-pane" data-motion={motionOn ? "on" : "off"} data-fullscreen={full ? "1" : "0"} tabIndex={0} onKeyDown={onKey}>
      <div class="graph-toolbar">
        {report && (
          <div class="graph-legend" data-testid="graph-legend">
            {(Object.keys(GROUP_LABEL) as GraphGroup[]).map((g) =>
              counts.c[g] > 0 ? (
                <span class="graph-chip" key={g}>
                  <span class={`graph-dot graph-dot-${g}`} />
                  {GROUP_LABEL[g]} {counts.c[g]}
                </span>
              ) : null,
            )}
            {counts.dead > 0 && (
              <span class="graph-chip graph-chip-dead">
                {t("graph.dead_files")} {counts.dead}
              </span>
            )}
            {layout && (
              <span class="graph-chip" data-testid="graph-systems">
                {t("graph.systems")} {layout.systems.length}
              </span>
            )}
            <nav class="graph-crumb" aria-label={t("graph.location")}>
              <button type="button" onClick={() => { setSystemId(null); fitAll(); }}>{t("graph.repo")}</button>
              {systemId && <span> › {systemLabel(systemId)}</span>}
            </nav>
            {simplified && (
              <span class="graph-chip graph-chip-simplified" data-testid="graph-simplified" title={t("graph.low_framerate")}>
                {t("graph.simplified")}
              </span>
            )}
          </div>
        )}
        {report && (
          <div class="graph-actions">
            <Button aria-label={t("graph.show_entire")} onClick={fitAll} class="graph-fit">
              {t("graph.fit")}
            </Button>
            <Button aria-label={t("graph.check_graph")} onClick={runCheck} disabled={checking} class="graph-check">
              {checking ? "Prüfe …" : "Prüfen"}
            </Button>
            {!full && (
              <Button aria-label={t("graph.fullscreen")} onClick={() => setFull(true)}>
                {t("graph.fullscreen")}
              </Button>
            )}
            <input
              ref={searchRef}
              class="graph-search"
              type="search"
              aria-label={t("graph.search_files")}
              placeholder={t("graph.search_file")}
              value={query}
              onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setSheet("open"); }}
              onFocus={() => setSheet("open")}
            />
          </div>
        )}
      </div>
      {query.trim() && hits.length === 0 && <p class="graph-empty">{t("graph.no_match")}</p>}
      {hits.length > 0 && (
        <ul class="graph-results">
          {hits.map((h) => (
            <li key={h.path}>
              <button type="button" aria-label={`Treffer ${h.path}`} onClick={() => { setQuery(""); selectPath(h.path); }}>
                {h.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      {report?.meta.truncated && (
        <div class="graph-banner">
          {t("graph.graph_capped")} {report.meta.files}/{report.meta.maxFiles} {t("graph.files_shown")}
          {report.meta.unresolved > 0 && ` (${report.meta.unresolved} Spezifikatoren unaufgelöst)`}
        </div>
      )}
      {diag && (
        <div class="graph-diag">
          <div>
            {diag.sources.map((s) => (
              <div class={`graph-diag-source-${s.state}`} key={s.name}>
                {s.name}: {s.state}
                {s.detail ? ` — ${s.detail}` : ""}
              </div>
            ))}
          </div>
          <div data-testid="graph-errors">{errorTotal} {t("graph.errors_in")} {diag.byFile.filter((f) => f.errors > 0).length} {t("graph.files")}</div>
        </div>
      )}
      {loadErr && <div class="files-error">{t("graph.graph_not_loadable")} {loadErr}</div>}
      {diagErr && <div class="files-error">{t("graph.check_failed")} {diagErr}</div>}
      <div class="graph-body">
      {/* Zoom an der ganzen Fläche: über einem Stern liegt dessen Klick-Knopf, nicht das Canvas. */}
      <div class="graph-wrap" ref={wrapRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerLeave}>
        {full && (
          <Button aria-label={t("graph.exit_fullscreen")} title={t("graph.exit_fullscreen_esc")} onClick={() => setFull(false)} class="graph-fullclose">
            {t("graph.exit_fullscreen_x")}
          </Button>
        )}
        {!report && !loadErr && <div class="graph-state">{t("graph.loading_graph")}</div>}
        {report && report.nodes.length === 0 && <div class="graph-state">{t("graph.no_files_target")}</div>}
        <canvas ref={canvasRef} class="graph-canvas" />
        <div class={`graph-node-hits${dragging ? " graph-node-hits-dragging" : ""}`}>
          {!systemId && layout && layout.systems.map((s) => {
            const { scale, tx, ty } = viewRef.current;
            const side = 44;
            return (
              <button
                type="button"
                key={s.id}
                class="graph-system-hit"
                aria-label={`System ${systemLabel(s.id)}`}
                style={{ left: `${s.x * scale + tx - side / 2}px`, top: `${(s.y - s.radius) * scale + ty - side}px`, width: `${side}px`, height: `${side}px` }}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  enterSystem(s.id);
                }}
              />
            );
          })}
          {hitNodes.map((h) => (
            <button
              type="button"
              key={h.path}
              class={`graph-node-hit${h.hasError ? " has-error" : ""}${h.dead ? " dead" : ""}`}
              aria-label={`Datei ${h.path} auswählen`}
              style={h.style}
              onClick={() => {
                if (suppressClickRef.current) return;
                openPath(h.path);
              }}
            />
          ))}
        </div>
        {hover && (
          <div class="graph-tooltip" style={{ left: `${hover.x + 12}px`, top: `${hover.y + 12}px` }}>
            <div class="graph-tooltip-path">{hover.path}</div>
            <div>
              {GROUP_LABEL[hover.group]} {t("graph.inflow_frag")} {hover.in} {t("graph.outgoing_frag")} {hover.out}
            </div>
          </div>
        )}
      </div>
      {report && layout && (!narrow || sheet === "open" || !!selected || !!query.trim()) && (
        <GalaxyPanel
          narrow={narrow}
          sheet={sheet}
          onSheet={setSheet}
          systems={layout.systems}
          systemId={systemId}
          onEnterSystem={enterSystem}
          selected={selectedNode}
          neighbors={neighborList}
          twoHop={twoHop}
          onTwoHop={setTwoHop}
          groups={groups}
          onToggleGroup={(g) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))}
          categories={categories}
          cats={cats}
          onToggleCategory={(c) => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
          deadOnly={deadOnly}
          onDeadOnly={setDeadOnly}
          errorOnly={errorOnly}
          onErrorOnly={setErrorOnly}
          onSelect={selectPath}
          onOpen={onOpenFile}
        />
      )}
      </div>
    </div>
  );
}

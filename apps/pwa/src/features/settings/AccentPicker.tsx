import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { getTheme, type Theme } from "../../app/theme.ts";
import {
  accentWarnings,
  APPEARANCE_EVENT,
  DEFAULT_ACCENT,
  getAppearance,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  normalizeHex,
  previewAppearance,
  rgbToHex,
  setAppearance,
  type Appearance,
  type Hsv,
} from "../../app/appearance.ts";
import { SettingRow } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * EPIC-P34 T34.5: Akzentfarbe wählen wie in GIMP — Fläche für Sättigung/Helligkeit, Leiste für den
 * Farbton, Felder für Hex, RGB und HSV. Die Seite färbt sich während der Auswahl live ein; gespeichert
 * wird erst mit „Übernehmen“, Abbrechen und Esc stellen den Ausgangszustand exakt wieder her.
 */
const RECENT_KEY = "ancientvoid.accentRecent";
const RECENT_MAX = 6;

const PRESETS: Record<Theme, string[]> = {
  dark: ["#4da3ff", "#a78bfa", "#f472b6", "#e879f9", "#2dd4bf", "#a3e635", "#94a3b8"],
  light: ["#1d6fd6", "#6d4fd6", "#c2306f", "#b02fc4", "#0f8f82", "#5f8a0c", "#5b6b82"],
};

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.flatMap((v) => (typeof v === "string" ? [normalizeHex(v)].filter((h): h is string => h !== null) : [])).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(hex: string): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...readRecent().filter((h) => h !== hex)].slice(0, RECENT_MAX)));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const themeLabel = (t: Theme) => (t === "dark" ? "Dunkel" : "Hell");

/** Die Zeile in „Darstellung“: zeigt die aktuelle Farbe und öffnet den Wähler. */
export function AccentSetting() {
  const [appearance, setAppearanceState] = useState<Appearance>(getAppearance());
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      setAppearanceState(getAppearance());
      setTheme(getTheme());
    };
    window.addEventListener(APPEARANCE_EVENT, sync);
    window.addEventListener("ancientvoid:theme", sync);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener("ancientvoid:theme", sync);
    };
  }, []);
  const hex = appearance.accent[theme] ?? DEFAULT_ACCENT[theme];
  return (
    <SettingRow label={t("settings.accent_color")} hint="Dunkel und Hell haben je eine eigene">
      <button type="button" class="accent-trigger" aria-label={`Akzentfarbe wählen, aktuell ${hex}`} onClick={() => setOpen(true)}>
        <span class="cp-swatch" style={{ background: hex }} />
        <span class="mono">{hex}</span>
      </button>
      {open && <AccentDialog theme={theme} original={appearance} onClose={() => setOpen(false)} />}
    </SettingRow>
  );
}

function AccentDialog({ theme, original, onClose }: { theme: Theme; original: Appearance; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = original.accent[theme] ?? DEFAULT_ACCENT[theme];
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(start));
  const [hexText, setHexText] = useState(start);
  const [useDefault, setUseDefault] = useState(original.accent[theme] === null);
  const hex = normalizeHex(hexText);
  const recent = useRef(readRecent()).current;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Live: die Seite zeigt immer, was gerade gewählt ist.
  useEffect(() => {
    if (hex === null) return;
    previewAppearance({ ...original, accent: { ...original.accent, [theme]: useDefault ? null : hex } });
  }, [hex, useDefault]);

  const close = () => {
    ref.current?.close();
    onClose();
  };
  const cancel = () => {
    previewAppearance(original);
    close();
  };
  const apply = () => {
    if (hex === null) return;
    setAppearance({ ...original, accent: { ...original.accent, [theme]: useDefault ? null : hex } });
    if (!useDefault) pushRecent(hex);
    close();
  };

  const pick = (next: Hsv) => {
    setHsv(next);
    setHexText(hsvToHex(next));
    setUseDefault(false);
  };
  const pickHex = (value: string) => {
    const n = normalizeHex(value);
    setHexText(n ?? value);
    if (n !== null) {
      // Ein Grau hat keinen eigenen Farbton: der gewählte bleibt, damit die Leiste nicht springt.
      const next = hexToHsv(n);
      setHsv(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
      setUseDefault(false);
    }
  };
  const setRgb = (channel: "r" | "g" | "b", value: string) => {
    const rgb = hexToRgb(hex ?? hexText);
    pickHex(rgbToHex({ ...rgb, [channel]: clamp(Number(value) || 0, 0, 255) }));
  };
  const setHsvField = (part: keyof Hsv, value: string) => pick({ ...hsv, [part]: clamp(Number(value) || 0, 0, part === "h" ? 360 : 100) });

  const rgb = hexToRgb(hex ?? hexText);
  const warnings = hex ? accentWarnings(hex, theme) : [];
  const defaultHex = DEFAULT_ACCENT[theme];

  return (
    <dialog
      ref={ref}
      class="color-dialog"
      aria-labelledby="accent-title"
      onKeyDown={(e) => {
        // Esc gehört dem Dialog: die Werkzeugfläche dahinter bleibt offen (ToolPane beachtet defaultPrevented).
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onClick={(e) => e.target === e.currentTarget && cancel()}
    >
      <div class="color-dialog-body">
        <h3 id="accent-title">{t("settings.accent_frag")} {themeLabel(theme)}</h3>
        <SvPlane hsv={hsv} onChange={pick} />
        <HueBar hsv={hsv} onChange={pick} />
        <div class="cp-compare">
          <button type="button" class="cp-old" aria-label={t("settings.restore_old_color")} title={t("settings.restore_old_color")} onClick={() => pickHex(start)} style={{ background: start }}>
            {t("settings.alt")}
          </button>
          <span class="cp-new" style={{ background: hex ?? "transparent", color: hex ? (hexToHsv(hex).v > 60 && hexToHsv(hex).s < 70 ? "#000" : "#fff") : "inherit" }}>
            {t("settings.new")}
          </span>
        </div>
        <div class="cp-fields">
          <label class="cp-field cp-hex">
            <span>{t("settings.hex")}</span>
            <input value={hexText} aria-invalid={hex === null} spellcheck={false} autocapitalize="off" autocomplete="off" onInput={(e) => pickHex((e.currentTarget as HTMLInputElement).value)} />
          </label>
          {(["r", "g", "b"] as const).map((c) => (
            <label key={c} class="cp-field">
              <span>{c.toUpperCase()}</span>
              <input type="number" min="0" max="255" value={rgb[c]} onInput={(e) => setRgb(c, (e.currentTarget as HTMLInputElement).value)} />
            </label>
          ))}
          {(["h", "s", "v"] as const).map((c) => (
            <label key={c} class="cp-field">
              <span>{c.toUpperCase()}</span>
              <input type="number" min="0" max={c === "h" ? 360 : 100} value={Math.round(hsv[c])} onInput={(e) => setHsvField(c, (e.currentTarget as HTMLInputElement).value)} />
            </label>
          ))}
        </div>
        <div class="cp-swatches" role="group" aria-label={t("settings.presets")}>
          <button type="button" class="cp-preset" aria-label={`Vorgabe ${defaultHex}`} title={`Standard ${defaultHex}`} style={{ background: defaultHex }} onClick={() => pickHex(defaultHex)} />
          {PRESETS[theme].map((p) => (
            <button key={p} type="button" class="cp-preset" aria-label={`Vorgabe ${p}`} title={p} style={{ background: p }} onClick={() => pickHex(p)} />
          ))}
        </div>
        {recent.length > 0 && (
          <div class="cp-swatches" role="group" aria-label={t("settings.recently_used")}>
            <span class="dim cp-recent-label">{t("settings.last ")}</span>
            {recent.map((p) => (
              <button key={p} type="button" class="cp-preset" aria-label={`Zuletzt ${p}`} title={p} style={{ background: p }} onClick={() => pickHex(p)} />
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div class="cp-warnings" role="status">
            {warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </div>
        )}
        <div class="cp-actions">
          <Button onClick={() => { setHexText(defaultHex); setHsv(hexToHsv(defaultHex)); setUseDefault(true); }}>
            {t("common.standard")}
          </Button>
          <span class="cp-spacer" />
          <Button onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={hex === null} onClick={apply} variant="primary">
            {t("common.apply")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Fläche: waagerecht Sättigung, senkrecht Helligkeit. Maus, Touch (Pointer Events) und Pfeiltasten. */
function SvPlane({ hsv, onChange }: { hsv: Hsv; onChange: (next: Hsv) => void }) {
  const dragging = useRef(false);
  const from = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onChange({ h: hsv.h, s: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), v: 100 - clamp(((e.clientY - r.top) / r.height) * 100, 0, 100) });
  };
  return (
    <div
      class="cp-plane"
      role="slider"
      tabIndex={0}
      aria-label={t("settings.saturation_brightness")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.s)}
      aria-valuetext={`Sättigung ${Math.round(hsv.s)} %, Helligkeit ${Math.round(hsv.v)} %`}
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}deg 100% 50%))` }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        from(e);
      }}
      onPointerMove={(e) => dragging.current && from(e)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const move: Record<string, Partial<Hsv> | undefined> = {
          ArrowLeft: { s: hsv.s - step },
          ArrowRight: { s: hsv.s + step },
          ArrowUp: { v: hsv.v + step },
          ArrowDown: { v: hsv.v - step },
        };
        const d = move[e.key];
        if (!d) return;
        e.preventDefault();
        onChange({ ...hsv, s: clamp(d.s ?? hsv.s, 0, 100), v: clamp(d.v ?? hsv.v, 0, 100) });
      }}
    >
      <span class="cp-handle" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
    </div>
  );
}

function HueBar({ hsv, onChange }: { hsv: Hsv; onChange: (next: Hsv) => void }) {
  const dragging = useRef(false);
  const from = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onChange({ ...hsv, h: clamp(((e.clientX - r.left) / r.width) * 360, 0, 360) });
  };
  return (
    <div
      class="cp-hue"
      role="slider"
      tabIndex={0}
      aria-label={t("settings.hue")}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        from(e);
      }}
      onPointerMove={(e) => dragging.current && from(e)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const delta = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : e.key === "ArrowRight" || e.key === "ArrowUp" ? step : 0;
        if (!delta) return;
        e.preventDefault();
        onChange({ ...hsv, h: clamp(hsv.h + delta, 0, 360) });
      }}
    >
      <span class="cp-handle" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%" }} />
    </div>
  );
}

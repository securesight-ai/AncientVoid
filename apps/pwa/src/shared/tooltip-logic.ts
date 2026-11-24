/**
 * Tooltip-Logik ohne DOM: Long-Press-Erkennung für Touch und die Textwahl.
 * Getrennt von Tooltip.tsx, damit Schwelle, Click-Unterdrückung und Abbruch
 * ohne Browser testbar sind.
 */

export const LONG_PRESS_MS = 450;
/** Wer den Finger weiter als das bewegt, scrollt oder wischt — kein Long-Press. */
export const MOVE_TOLERANCE_PX = 10;
/** Der Click, den der Browser nach dem Loslassen eines Long-Press noch schickt, kommt sofort; danach ist ein Tap wieder ein Tap. */
export const CLICK_SUPPRESS_MS = 600;

export interface LongPressOptions {
  onLongPress: () => void;
  delayMs?: number;
  tolerancePx?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface LongPress {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  /** Finger weg. `true`, wenn der Druck lang genug war — der folgende Click wird dann geschluckt. */
  end(): boolean;
  /** Abbruch (Scroll, pointercancel, Fokuswechsel). */
  cancel(): void;
  /** Für den Click-Handler: `true` = Click gehört zu einem Long-Press und darf nichts auslösen. */
  shouldSuppressClick(): boolean;
}

export function createLongPress(options: LongPressOptions): LongPress {
  const delay = options.delayMs ?? LONG_PRESS_MS;
  const tolerance = options.tolerancePx ?? MOVE_TOLERANCE_PX;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  let suppressUntil = 0;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  return {
    start(x, y) {
      stopTimer();
      origin = { x, y };
      fired = false;
      timer = setTimer(() => {
        timer = null;
        fired = true;
        // Schon beim Auslösen sperren: manche Browser schicken den Click ohne eigenes pointerup-Ende.
        suppressUntil = Number.POSITIVE_INFINITY;
        options.onLongPress();
      }, delay);
    },
    move(x, y) {
      if (!origin || fired) return;
      if (Math.hypot(x - origin.x, y - origin.y) > tolerance) {
        stopTimer();
        origin = null;
      }
    },
    end() {
      stopTimer();
      const wasLong = fired;
      origin = null;
      fired = false;
      if (wasLong) suppressUntil = now() + CLICK_SUPPRESS_MS;
      return wasLong;
    },
    cancel() {
      stopTimer();
      origin = null;
      fired = false;
      suppressUntil = 0;
    },
    shouldSuppressClick() {
      if (now() <= suppressUntil) {
        suppressUntil = 0;
        return true;
      }
      return false;
    },
  };
}

export interface TipSource {
  dataTip?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  text?: string | null;
}

/** Tooltip-Text eines Elements: ausdrücklicher `data-tip` vor `aria-label`, `title`, sichtbarem Text. */
export function tipText(source: TipSource): string {
  for (const candidate of [source.dataTip, source.ariaLabel, source.title, source.text]) {
    const clean = candidate?.replace(/\s+/g, " ").trim();
    if (clean) return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
  }
  return "";
}

/** Abstand des Tooltips zum Viewport-Rand und zum Ziel (BUG-0255). */
const TIP_MARGIN_PX = 8;
/** Weniger Platz darüber (CSS-px) → Tooltip unter dem Ziel. */
const TIP_BELOW_PX = 40;

export interface TipAnchor {
  /** Horizontale Mitte des Ziels. */
  x: number;
  top: number;
  bottom: number;
  /** Rechte Kante des Ziels — Startpunkt der Neben-Platzierung. */
  right: number;
}

export interface TipPlacement {
  left: number;
  /** `above`/`below`: Kante des Ziels; `side`: vertikale Mitte des Tooltips. */
  top: number;
  mode: "above" | "below" | "side";
}

/**
 * Platzierung des Tooltips im Viewport, ohne DOM (BUG-0255): Ziele am linken
 * Rand (Icon-Leiste) bekommen den Tooltip **rechts daneben**, statt mittig
 * über dem Anker mit `translate(-50%)` links aus dem Bildschirm zu ragen.
 * Alle Koordinaten in CSS-px (Aufrufer teilt Render-px durch `zoom`).
 */
export function placeTip(
  anchor: TipAnchor,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): TipPlacement {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const overflowsLeft = anchor.x - size.width / 2 < TIP_MARGIN_PX;
  const fitsRight = anchor.right + TIP_MARGIN_PX + size.width <= viewport.width - TIP_MARGIN_PX;
  if (overflowsLeft && fitsRight) {
    const center = (anchor.top + anchor.bottom) / 2;
    return {
      mode: "side",
      left: anchor.right + TIP_MARGIN_PX,
      top: clamp(center, TIP_MARGIN_PX + size.height / 2, viewport.height - TIP_MARGIN_PX - size.height / 2),
    };
  }
  const below = anchor.top < TIP_BELOW_PX;
  return {
    mode: below ? "below" : "above",
    left: clamp(anchor.x - size.width / 2, TIP_MARGIN_PX, viewport.width - TIP_MARGIN_PX - size.width),
    top: below ? anchor.bottom : anchor.top,
  };
}

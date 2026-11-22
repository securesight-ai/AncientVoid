import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { createLongPress, placeTip, tipText } from "./tooltip-logic.ts";

/** Alles, was sich anklicken lässt. Ein ausdrückliches `data-tip` macht auch andere Elemente zum Ziel. */
const TIP_TARGET = 'button, a[href], summary, select, [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], [data-tip]';
const HOVER_DELAY_MS = 350;
const TOUCH_SHOW_MS = 2200;

interface Shown {
  text: string;
  x: number;
  top: number;
  bottom: number;
  right: number;
}

function targetOf(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? (node.closest(TIP_TARGET) as HTMLElement | null) : null;
}

/**
 * Wandelt `title` bei klickbaren Elementen in `data-tip` um: sonst erscheint neben
 * unserem Tooltip noch der native. Hat das Element sonst keinen Namen, wird der Text
 * zum `aria-label` — der Name darf durch das Entfernen nicht verloren gehen.
 *
 * Preact setzt `title` bei State-Wechseln erneut (vdom-Diff, nicht DOM-Abgleich):
 * Ein adoptierter Tooltip folgt daher dem jeweils aktuellen Titel, statt beim
 * ersten Wort stehen zu bleiben (Nyx-Orb „Tippen zum Sprechen“/„Nochmal“).
 * Ein von der App ausdrücklich gesetztes `data-tip`/`aria-label` gewinnt weiter.
 */
const adopted = new WeakSet<HTMLElement>();
/** Ob aria-label von uns stammt (Element war/bleibt textlos) — nur dann darf es dem Titel folgen. */
const labeled = new WeakSet<HTMLElement>();

function adoptTitle(el: HTMLElement): void {
  const title = el.getAttribute("title");
  if (!title) return;
  const wasAdopted = adopted.has(el);
  if (wasAdopted || !el.hasAttribute("data-tip")) el.setAttribute("data-tip", title);
  // aria-label ausschließlich für textlose Ziele (Icon-Buttons wie der Nyx-Orb).
  // Einem Button mit sichtbarem Text den Titel als Namen zu geben stiehlt ihm den
  // Namen (getByRole/Screenreader) — reale Wirkung: „Mit Modell straffen“ hieß danach
  // „Der Text geht dafür an opencode“ (harness.spec T21.2, 2026-11-12).
  const textless = !(el.textContent ?? "").trim();
  if (!el.hasAttribute("aria-label") && textless) {
    el.setAttribute("aria-label", title);
    labeled.add(el);
  } else if (labeled.has(el)) {
    if (textless) el.setAttribute("aria-label", title);
    else {
      el.removeAttribute("aria-label");
      labeled.delete(el);
    }
  }
  el.removeAttribute("title");
  adopted.add(el);
}

function textFor(el: HTMLElement): string {
  return tipText({ dataTip: el.getAttribute("data-tip"), ariaLabel: el.getAttribute("aria-label"), title: el.getAttribute("title"), text: el.textContent });
}

/**
 * Ein Tooltip für die ganze App (Wurzel einmal mounten). Desktop: Hover und Tastaturfokus.
 * Touch: Gedrückthalten zeigt ihn, ohne die Aktion auszulösen (Click, Kontextmenü und
 * Textmarkierung werden dabei unterdrückt); ein kurzer Tap löst weiter aus.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Nach dem Loslassen schickt der Browser noch Maus-Kompatibilitätsereignisse (Fokuswechsel): die dürfen den Touch-Tooltip nicht schließen.
    let touchShown = false;
    const clearTimers = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hideTimer.current = hoverTimer.current = null;
    };
    const hide = () => {
      touchShown = false;
      clearTimers();
      setShown(null);
    };
    const show = (el: HTMLElement) => {
      adoptTitle(el);
      const text = textFor(el);
      if (!text) return;
      const r = el.getBoundingClientRect();
      setShown({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, right: r.right });
    };

    let touchTarget: HTMLElement | null = null;
    let lastTouchAt = 0;
    const press = createLongPress({
      onLongPress: () => {
        if (!touchTarget) return;
        show(touchTarget);
        touchShown = true;
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
      },
    });

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = targetOf(e.target);
      if (!el) return;
      adoptTitle(el);
      clearTimers();
      hoverTimer.current = setTimeout(() => show(el), HOVER_DELAY_MS);
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = targetOf(e.target);
      // Wechsel zwischen Kind (Icon) und Button desselben Ziels ist kein Verlassen.
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = targetOf(e.target);
      // Nur Tastaturfokus: ein Mausklick fokussiert auch, soll aber keinen Tooltip stehen lassen.
      if (el && el.matches(":focus-visible")) show(el);
    };
    const onFocusOut = () => {
      if (!touchShown) hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        hide();
        return;
      }
      lastTouchAt = Date.now();
      hide();
      touchTarget = targetOf(e.target);
      if (touchTarget) press.start(e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") press.move(e.clientX, e.clientY);
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      lastTouchAt = Date.now();
      if (e.type === "pointercancel") {
        press.cancel();
        hide();
        return;
      }
      if (press.end()) hideTimer.current = setTimeout(hide, TOUCH_SHOW_MS);
    };
    const onClick = (e: MouseEvent) => {
      if (!targetOf(e.target) || !press.shouldSuppressClick()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onContextMenu = (e: MouseEvent) => {
      // Android zeigt beim Gedrückthalten das Kontextmenü; ein Rechtsklick mit der Maus bleibt erlaubt.
      if (Date.now() - lastTouchAt < 1500 && targetOf(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    const options = { capture: true } as const;
    document.addEventListener("pointerover", onPointerOver, options);
    document.addEventListener("pointerout", onPointerOut, options);
    document.addEventListener("focusin", onFocusIn, options);
    document.addEventListener("focusout", onFocusOut, options);
    document.addEventListener("pointerdown", onPointerDown, options);
    document.addEventListener("pointermove", onPointerMove, options);
    document.addEventListener("pointerup", onPointerEnd, options);
    document.addEventListener("pointercancel", onPointerEnd, options);
    document.addEventListener("click", onClick, options);
    document.addEventListener("contextmenu", onContextMenu, options);
    document.addEventListener("keydown", onKey, options);

    // Titel aus später gerenderten Elementen übernehmen, bevor der Browser seinen eigenen Tooltip zeigt.
    const adoptAll = (root: ParentNode) => root.querySelectorAll<HTMLElement>(`${TIP_TARGET.split(", ").map((s) => `${s}[title]`).join(", ")}`).forEach(adoptTitle);
    adoptAll(document);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.target instanceof HTMLElement && r.target.matches(TIP_TARGET)) adoptTitle(r.target);
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.matches(TIP_TARGET)) adoptTitle(n);
          adoptAll(n);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

    return () => {
      observer.disconnect();
      clearTimers();
      for (const [type, fn] of [
        ["pointerover", onPointerOver], ["pointerout", onPointerOut], ["focusin", onFocusIn], ["focusout", onFocusOut],
        ["pointerdown", onPointerDown], ["pointermove", onPointerMove], ["pointerup", onPointerEnd], ["pointercancel", onPointerEnd],
        ["click", onClick], ["contextmenu", onContextMenu], ["keydown", onKey],
      ] as const) document.removeEventListener(type, fn as EventListener, options);
    };
  }, []);

  // BUG-0255: die Box-Klemmung braucht die echte Tooltip-Größe — erst messen
  // (Layout-Effect, vor dem Paint), dann zeigen. Bis dahin unsichtbar, damit
  // er keinen Frame am falschen Ort steht.
  useLayoutEffect(() => {
    if (!shown) {
      setSize(null);
      return;
    }
    const el = tipRef.current;
    if (!el) return;
    const zoom = Number(document.documentElement.style.zoom) || 1;
    const r = el.getBoundingClientRect();
    setSize({ width: r.width / zoom, height: r.height / zoom });
  }, [shown]);

  if (!shown) return null;
  // Platzierung nach placeTip: am linken Rand (Icon-Leiste) rechts neben das
  // Icon, sonst mittig über dem Ziel, Box komplett im Viewport (BUG-0255).
  const zoom = Number(document.documentElement.style.zoom) || 1;
  const placement = placeTip(
    { x: shown.x / zoom, top: shown.top / zoom, bottom: shown.bottom / zoom, right: shown.right / zoom },
    { width: window.innerWidth / zoom, height: window.innerHeight / zoom },
    size ?? { width: 0, height: 0 },
  );
  return (
    <div
      ref={tipRef}
      class="tooltip"
      role="tooltip"
      data-below={placement.mode === "below" ? "1" : undefined}
      data-side={placement.mode === "side" ? "1" : undefined}
      style={{ left: `${placement.left}px`, top: `${placement.top}px`, visibility: size ? undefined : "hidden" }}
    >
      {shown.text}
    </div>
  );
}

import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { NyxSprite } from "../nyx/Nyx.tsx";
import { clampFabPos, fabBreakpoint, hasStoredFabPos, isKeyboardResize, loadFabPos, saveFabPos, type FabPos } from "./fab-position.ts";
import { placeFabAvoiding, type FabRect } from "./fab-clearance.ts";
import { installFocusTracker } from "./paste-target.ts";
import { recordingSupported } from "../../shared/local-stt.ts";
import { speechRecognitionSupported } from "../../shared/speech.ts";
import { usePushToTalk } from "./use-push-to-talk.ts";
import { SttModeMenu } from "./SttModeMenu.tsx";

const DRAG_THRESHOLD = 8;
// ADR-0095: wer den Knopf **gehalten** drueckt, will die Quelle waehlen — kurzes
// Tippen nimmt weiter auf. 1500 ms (Kais Entscheidung nach dem ersten Live-Test):
// 500 ms waren zu knapp — beim normalen Diktat-Start haelt man den Daumen leicht
// laenger und landete im Menue statt in der Aufnahme.
const HALTEN_MS = 1500;

/**
 * Zuletzt gemessene Fenstergröße ohne Tastatur — der „stabile Rahmen“ für alles, was den FAB
 * platziert oder klemmt. Die Bildschirmtastatur schrumpft nur den sichtbaren Ausschnitt;
 * dagegen gerechnet wäre der FAB jedes Mal auf- und zugesprungen (Nutzerwunsch 27.11.2026:
 * er bleibt an derselben Stelle stehen, auch hinter der Tastatur).
 */
const stableFrame = (): { w: number; h: number } => ({ w: window.innerWidth, h: window.innerHeight });

/** Halten die Tasten gerade ein Editierfeld? Nur dann kann die Bildschirmtastatur auf sein. */
const editableFocused = (): boolean => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
};

/**
 * Globaler, verschiebbarer Nyx-FAB: einziger Auslöser für Speech-to-Text in die
 * fokussierte Eingabe (+ Zwischenablage). Position je Breakpoint persistiert.
 */
export function NyxFab() {
  const stt = usePushToTalk();
  const [bp, setBp] = useState(() => fabBreakpoint());
  const [pos, setPos] = useState<FabPos>(() => loadFabPos(fabBreakpoint(), window.innerWidth, window.innerHeight));
  const posRef = useRef(pos);
  posRef.current = pos;
  // Stabiler Rahmen: letzte Groesse ohne Tastatur — Platzierung, Klemmen und Toast rechnen
  // gegen ihn, nicht gegen die gerade zusammengeschrumpfte sichtbare Hoehe.
  const frame = useRef(stableFrame());
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const [quellenMenue, setQuellenMenue] = useState(false);
  const halten = useRef<{ timer: ReturnType<typeof setTimeout>; ausgeloest: boolean } | null>(null);
  // BUG-0199: Ausweichplatz (wenn der FAB sonst ein Bedienelement zudecken wuerde) und ob
  // er ueberhaupt nicht zeigen kann. Die Nutzerposition `pos` bleibt davon unberuehrt.
  const [ausweg, setAusweg] = useState<FabPos | null>(null);
  const [verdeckt, setVerdeckt] = useState(false);
  // Wer selbst platziert hat (gemerkt oder gerade gezogen), dem wird nichts weggeschoben —
  // ausgewichen wird nur der automatisch gewaehlten Platzierung (BUG-0199).
  const userPlaced = useRef(false);

  useEffect(() => installFocusTracker(), []);

  useEffect(() => {
    // Ohne eigene Platzierung folgt der FAB der Dock-Oberkante (BUG-0138): beim Laden, Seitenwechsel,
    // Fenstergröße und wenn der Dock selbst wächst (Steuerzeilen kommen/gehen).
    let observed: Element | null = null;
    const place = () => {
      if (drag.current) return; // Handy: Adressleiste/Tastatur feuern resize mitten im Ziehen
      // Tastatur auf (Breite gleich, Hoehe geschrumpft, Editierfeld fokussiert, Touchgeraet):
      // der FAB bleibt stehen — der Browser bewegt fixe Elemente nicht, nur das Neuplatzieren
      // gegen die geschrumpfte Hoehe wuerde ihn springen lassen (gemessen 158 px).
      if (isKeyboardResize(frame.current, stableFrame(), { coarse: matchMedia("(pointer: coarse)").matches, editableFocused: editableFocused() })) return;
      frame.current = stableFrame();
      const vw = frame.current.w;
      const vh = frame.current.h;
      const next = fabBreakpoint(vw);
      const dock = document.querySelector(".dock-stack");
      if (dock !== observed) {
        if (observed) dockObserver.unobserve(observed);
        if (dock) dockObserver.observe(dock);
        observed = dock;
      }
      const rect = dock?.getBoundingClientRect();
      // Nur ein Dock, der unten über die Breite liegt — die senkrechte Icon-Leiste am Desktop zählt nicht.
      const bottomDock = rect && rect.width >= vw / 2 && rect.bottom >= vh - 4;
      const target = loadFabPos(next, vw, vh, bottomDock ? rect.top : undefined);
      userPlaced.current = hasStoredFabPos(next);
      setBp(next);
      setPos((prev) => (prev.x === target.x && prev.y === target.y ? prev : target));
    };
    const dockObserver = new ResizeObserver(place);
    let settle: number[] = [];
    const placeSoon = () => {
      place();
      settle.forEach(clearTimeout);
      // Die Seite rendert ihren Dock erst nach Hash-Wechsel bzw. geladenen Daten.
      settle = [300, 1000, 2500].map((ms) => window.setTimeout(place, ms));
    };
    placeSoon();
    window.addEventListener("resize", place);
    window.addEventListener("hashchange", placeSoon);
    return () => {
      settle.forEach(clearTimeout);
      dockObserver.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("hashchange", placeSoon);
    };
  }, []);

  useEffect(() => {
    // Der FAB deckt nichts zu: trifft seine Flaeche ein interaktives Element, weicht er auf
    // die naechste freie Stelle aus; ist alles belegt, verschwindet er (und kommt beim
    // Weiterscrollen wieder). Getestet wird per Touch-Trefferprobe, nicht per Geometrie —
    // nur die beweist, dass der Tipp wirklich beim Control ankaeme.
    // Der FAB deckt nichts zu: trifft seine Flaeche den Mittelpunkt eines Bedienelements,
    // weicht er auf die naechste freie Stelle aus; ist alles belegt, verschwindet er (und
    // kommt beim Weiterscrollen wieder). Geprueft wird per Touch-Trefferprobe am Control —
    // nur die beweist, dass der Tipp dort ankaeme (Bug: eigene Mitte zu testen fuehrt immer
    // auf den FAB selbst und heisst „frei“).
    let controls: HTMLElement[] = [];
    const collect = () => {
      controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, a[href], [role="switch"], [role="button"], [role="checkbox"], [role="slider"], summary',
        ),
      );
    };
    // Belegt ist ein Kandidat, wenn der Mittelpunkt eines sichtbaren Bedienelements in
    // seiner 64x64-Flaeche liegt — der FAB liegt als festes Element obenauf, also deckt er
    // es zu. Reine Geometrie (kein Trefferertest im laufenden Stand): der Kandidat ist ja
    // gerade noch nicht die wirkliche Position, sonst pruefte man gegen den FAB von vorher.
    const blockedAt = (r: FabRect): boolean => {
      for (const el of controls) {
        if (el.closest("[data-nyx-fab]")) continue;
        const c = el.getBoundingClientRect();
        if (c.width === 0 || c.height === 0) continue;
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) continue;
        return true;
      }
      return false;
    };

    let wartend = 0;
    const pruefen = () => {
      if (drag.current) return;
      // Tastatur offen (sichtbare Hoehe unter dem stabilen Rahmen): nichts verschieben —
      // der FAB bleibt an derselben Stelle, das Ausweichen kehrt mit der Tastatur zurueck.
      if (window.innerHeight < frame.current.h - 8) return;
      if (userPlaced.current) {
        setAusweg(null);
        setVerdeckt(false);
        return;
      }
      collect(); // frisch: beim Scrollen kommen neue Controls ins Bild
      const base = posRef.current;
      const fund = placeFabAvoiding(base, blockedAt, frame.current.w, frame.current.h);
      setAusweg((prev) => (prev?.x === fund.pos?.x && prev?.y === fund.pos?.y ? prev : fund.pos));
      setVerdeckt(fund.pos === null);
    };
    const spaeter = () => {
      if (wartend) clearTimeout(wartend);
      // Nachrollen abwarten: eine Messung pro Scroll-Schub reicht, und sie muss den
      // frischen Control-Stand sehen.
      wartend = window.setTimeout(() => {
        wartend = 0;
        pruefen();
      }, 140);
    };

    pruefen();
    // BUG-0283: Scroll-Events blubbern nicht — die Übersichtsliste (BUG-0099) und der
    // Chat-Verlauf scrollen intern, window-scroll feuert dort nie. Capture am Dokument
    // sieht jeden Scroller; der MutationObserver fängt datengetriebene Umbrüche
    // (Abschnittswechsel, wachsender Verlauf), die ohne jedes Event Karten unter den
    // FAB schieben. Beides läuft in dieselbe Entprellung.
    document.addEventListener("scroll", spaeter, { capture: true, passive: true });
    const umbreche = new MutationObserver(spaeter);
    umbreche.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", spaeter);
    window.addEventListener("hashchange", spaeter);
    const timers = [200, 800, 2000].map((ms) => window.setTimeout(pruefen, ms));
    return () => {
      clearTimeout(wartend);
      timers.forEach(clearTimeout);
      umbreche.disconnect();
      document.removeEventListener("scroll", spaeter, { capture: true });
      window.removeEventListener("resize", spaeter);
      window.removeEventListener("hashchange", spaeter);
    };
  }, [pos]);

  const shownPos = ausweg ?? pos;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const knopf = e.currentTarget as HTMLElement;
    knopf.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: posRef.current.x, oy: posRef.current.y, moved: false };
    setDragging(true);
    const timer = setTimeout(() => {
      const d = drag.current;
      if (d && d.moved) return;
      // Auf einem Gerat ohne jedes Mikro und ohne Browser-Erkennung fragt das Menue
      // nach nichts Sinnvollem. Aber: die Gerate-Faehigkeit zaehlt, nicht die gerade
      // gewaehlte Quelle — sonst sperrt eine "lokal"-Wahl bei krankem Hub den Weg zurueck.
      if (!recordingSupported() && !speechRecognitionSupported()) return;
      if (halten.current) halten.current.ausgeloest = true;
      drag.current = null;
      setDragging(false);
      setQuellenMenue(true);
    }, HALTEN_MS);
    halten.current = { timer, ausgeloest: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      d.moved = true;
      // Wer zieht, will nicht waehlen.
      if (halten.current) {
        clearTimeout(halten.current.timer);
        halten.current = null;
      }
    }
    if (d.moved) {
      // Gegen den stabilen Rahmen klemmen: feuert die Tastatur mitten im Ziehen resize,
      // soll der Knopf nicht auf einmal in den geschrumpften Bereich rutschen.
      const next = clampFabPos({ x: d.ox + dx, y: d.oy + dy }, frame.current.w, frame.current.h);
      posRef.current = next;
      setPos(next);
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    const h = halten.current;
    halten.current = null;
    if (h) clearTimeout(h.timer);
    if (h?.ausgeloest) suppressClick.current = true;
    if (!d) return;
    if (d.moved) {
      suppressClick.current = true;
      const next = clampFabPos(posRef.current, frame.current.w, frame.current.h);
      posRef.current = next;
      userPlaced.current = true;
      setPos(next);
      setAusweg(null);
      setVerdeckt(false);
      saveFabPos(bp, next);
    }
  };

  const unavailable = !stt.supported;
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (unavailable) return;
    void stt.toggle();
  };

  const state = stt.active ? "question" : "quiet";
  const mmss = `${Math.floor(stt.seconds / 60)}:${String(stt.seconds % 60).padStart(2, "0")}`;
  const label = stt.recording ? "Aufnahme stoppen" : stt.listening ? "Diktat stoppen" : "Spracheingabe";

  return (
    <>
      {quellenMenue && <SttModeMenu onClose={() => setQuellenMenue(false)} />}
      <button
        type="button"
        data-nyx-fab
        data-testid="nyx-fab"
        data-bp={bp}
        class={`nyx-fab${dragging ? " dragging" : ""}${stt.recording ? " recording" : ""}${stt.listening ? " busy" : ""}`}
        style={{ left: `${shownPos.x}px`, top: `${shownPos.y}px` }}
        hidden={verdeckt && !stt.active}
        aria-label={label}
        aria-busy={stt.active}
        title={stt.title}
        aria-disabled={unavailable}
        aria-pressed={stt.active}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        <NyxSprite state={state} size={48} />
        {stt.active && <span class="nyx-fab-stop" data-testid="nyx-fab-stop" aria-hidden="true">■</span>}
      </button>
      {(stt.active || stt.error || stt.info || stt.partial) && (
        <div
          class={`nyx-fab-toast${stt.active ? " live" : ""}`}
          role="status"
          aria-live="polite"
          data-testid="nyx-fab-toast"
          /* Stabiler Rahmen statt window.*: der Toast springt nicht mit der Tastatur mit. */
          style={{ left: `${Math.max(8, Math.min(shownPos.x, frame.current.w - Math.min(320, frame.current.w - 16) - 8))}px`, bottom: `${frame.current.h - shownPos.y + 12}px` }}
        >
          {stt.active && (
            <div class="nyx-fab-state" data-testid="nyx-fab-state">
              ⏹ {stt.recording ? "Aufnahme" : "Diktat"} {t("session.running")} {mmss} {t("stt.stops_typing")}
            </div>
          )}
          {stt.active && stt.browserPfad && <div class="dim" data-testid="nyx-fab-cloud">{t("stt.browser_recognition")}</div>}
          {stt.active && stt.streamNotice && <div class="dim">{stt.streamNotice}</div>}
          {stt.active && stt.restarts > 0 && <div class="dim">{t("stt.recognition")} {stt.restarts}{t("stt.restarted")}</div>}
          {stt.partial && <div class="dim">{t("stt.word_for_word")}</div>}
          {stt.partial && <div class="nyx-fab-words" data-testid="nyx-fab-words">{stt.partial}</div>}
          {stt.info && !stt.error && <div class="dim">{stt.info}</div>}
          {stt.error && <div class="err">{stt.error}</div>}
        </div>
      )}
    </>
  );
}

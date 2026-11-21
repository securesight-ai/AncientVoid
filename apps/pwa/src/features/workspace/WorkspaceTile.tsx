import { useEffect, useState } from "preact/hooks";
import { hostApi, type SessionRecord } from "../../shared/api.ts";
import type { Page } from "../../app/Dock.tsx";
import { SessionTail } from "../session/SessionTail.tsx";
import { pointerOutside, type DropPoint } from "../windows/drag.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";
import type { TileRef } from "./tiles.ts";
import { ContentCard } from "./ContentCard.tsx";

export function WorkspaceTile({
  index,
  tileRef,
  focused,
  active,
  compact,
  onFocus,
  onClose,
  onPopout,
  onNavigate,
  onSwitchToken,
}: {
  onSwitchToken: () => void;
  onPopout?: (drop?: DropPoint) => void;
  index: number;
  tileRef: TileRef | null;
  focused: boolean;
  active: boolean;
  compact: boolean;
  onFocus: () => void;
  onClose: () => void;
  onNavigate: (page: Page) => void;
}) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [missing, setMissing] = useState(false);
  // EPIC-P34 T34.11: am Griff aus dem Fenster ziehen. Der Zeiger bleibt erfasst, auch außerhalb des Fensters.
  const [dragOut, setDragOut] = useState(false);
  const startGrip = (e: PointerEvent) => {
    if (!onPopout || e.button !== 0) return;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const outside = (ev: PointerEvent) => pointerOutside(ev.clientX, ev.clientY, { width: window.innerWidth, height: window.innerHeight });
    const move = (ev: PointerEvent) => setDragOut(outside(ev));
    const end = (ev: PointerEvent, drop: boolean) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      setDragOut(false);
      if (drop && outside(ev)) onPopout({ left: ev.screenX, top: ev.screenY });
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
  };
  useEffect(() => {
    setSession(null);
    setMissing(false);
    if (!tileRef || (tileRef.content && tileRef.content.kind !== "session")) return;
    let alive = true;
    hostApi(tileRef.hostId)
      .session(tileRef.sessionId)
      .then((s) => alive && setSession(s))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [tileRef?.sessionId, tileRef?.hostId]);

  // EPIC-P43 T43.6: ein Kopf je Kachel — mit Session trägt ihn SessionTail (Titel, Zustand, Reiter dazwischen).
  const headStart = (
    <>
      <span class="tile-no">{index + 1}</span>
      {onPopout && (
        <span class={`tile-grip${dragOut ? " dragging" : ""}`} aria-hidden="true" title="Aus dem Fenster ziehen: eigenes Fenster (Alternative: ⧉)" onPointerDown={startGrip}>
          ⠿{dragOut ? " Loslassen öffnet ein eigenes Fenster" : ""}
        </span>
      )}
    </>
  );
  const headEnd = (
    <>
      {onPopout && (
        <button type="button" class="tile-popout" aria-label={`Kachel ${index + 1} in eigenem Fenster öffnen`} title="In eigenem Fenster öffnen" onClick={() => onPopout()}>
          ⧉
        </button>
      )}
      <button type="button" class="tile-close" aria-label={`Kachel ${index + 1} schließen`} title="Kachel schließen (Alt+W)" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        ×
      </button>
    </>
  );
  return (
    <section
      class={`tile${focused ? " focused" : ""}${dragOut ? " drag-out" : ""}`}
      data-tile={index + 1}
      aria-label={`Kachel ${index + 1}`}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      {tileRef && !session && (!tileRef.content || tileRef.content.kind === "session") && (
        <div class="tile-head">
          {headStart}
          {headEnd}
        </div>
      )}
      {tileRef?.content && tileRef.content.kind !== "session" ? (
        <ContentCard card={tileRef} active={active} onClose={onClose} onSwitchToken={onSwitchToken} onPopout={onPopout ? () => onPopout() : undefined} />
      ) : !tileRef ? (
        <div class="ui-empty tile-empty">
          Kachel {index + 1} ist frei — Session links wählen
          {index > 0 && <div class="dim">Inhalte aus der Liste öffnen zusätzliche Kacheln</div>}
        </div>
      ) : missing ? (
        // P18 premortem 4: a remembered session that is gone says so.
        <div class="ui-empty tile-empty" data-testid="tile-missing">
          Diese Session gibt es nicht mehr oder sie ist nicht erreichbar.
          <Button onClick={onClose}>
            Kachel schließen
          </Button>
        </div>
      ) : session ? (
        <SessionTail key={JSON.stringify(tileRef)} session={session} onNavigate={onNavigate} onArchived={onClose} {...(tileRef?.content?.kind === "session" ? { workspaceTab: tileRef.content.tab, ...(tileRef.content.file ? { initialFile: tileRef.content.file } : {}), ...(tileRef.content.code ? { initialCode: tileRef.content.code } : {}) } : {})} tile={{ active, compact, head: { start: headStart, end: headEnd } }} />
      ) : (
        <EmptyState class="tile-empty dim" text="lädt…" />
      )}
    </section>
  );
}

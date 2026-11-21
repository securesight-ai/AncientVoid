import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { SessionRecord } from "../../shared/api.ts";
import { isDetached, type TileRef, type Workspace } from "../workspace/tiles.ts";
import { targetKey, windowFor, type WindowTarget } from "./protocol.ts";
import { useOpenWindows } from "./windows.ts";
import { Button } from "../../shared/ui/index.ts";

/** Wie lange nach dem Start des Hauptfensters offene Fenster Zeit haben, sich auf `ping` zu melden. */
const SETTLE_MS = 3500;

function targetOf(ref: TileRef): WindowTarget {
  return { kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) };
}

/**
 * EPIC-P34 T34.12: Fenster, die laut Arbeitsbereich abgelöst wurden, aber nicht mehr antworten (Fenster geschlossen,
 * abgestürzt, Browser neu gestartet). Ein Klick öffnet genau eines — Browser erlauben nach einer Nutzeraktion nur ein
 * Pop-up —, „Verwerfen“ gibt die Sessions wieder frei. Erst nach kurzer Wartezeit, damit ein Neuladen des Hauptfensters
 * die noch offenen Fenster nicht als verloren anzeigt.
 */
export function RestoreBar({
  ws,
  sessions,
  onOpen,
  onDiscard,
}: {
  ws: Workspace;
  sessions: SessionRecord[];
  onOpen: (ref: TileRef) => void;
  onDiscard: (refs: TileRef[]) => void;
}) {
  const open = useOpenWindows();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  const missing = (ws.detached ?? []).filter((ref) => isDetached(ws, ref) && !windowFor(open, targetOf(ref)));
  if (!settled || missing.length === 0) return null;
  const label = (ref: TileRef) => sessions.find((s) => s.id === ref.sessionId)?.title ?? `Session ${ref.sessionId.slice(0, 8)}`;
  return (
    <div class="restore-bar" role="status">
      <span>
        {missing.length} {t("common.windows")} {missing.length === 1 ? "ist" : "sind"} {t("windows.no_longer_open")}
      </span>
      {missing.map((ref) => (
        <Button key={targetKey(targetOf(ref))} onClick={() => onOpen(ref)}>
          ⧉ {label(ref)} {t("windows.open")}
        </Button>
      ))}
      <button type="button" class="link-btn" onClick={() => onDiscard(missing)}>
        {t("composer.discard")}
      </button>
    </div>
  );
}

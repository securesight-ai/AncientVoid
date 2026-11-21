import { useEffect } from "preact/hooks";
import { setHere } from "../../shared/command-context.ts";
import { CommandBar } from "../commands/CommandBar.tsx";
import type { TileRef } from "./tiles.ts";
import { ToolPane } from "../shell/ToolPane.tsx";
import { BrowserPanel } from "../browser/BrowserLayer.tsx";
import { DevicePanel } from "../devices/DeviceLayer.tsx";
import { FileViewer } from "../files/FileViewer.tsx";
import { HistoricalBlobView } from "../files/HistoricalBlobView.tsx";

export function ContentCard({ card, active, onClose, onSwitchToken, onPopout }: { card: TileRef; active: boolean; onClose: () => void; onSwitchToken: () => void; onPopout?: () => void }) {
  const content = card.content;
  useEffect(() => {
    if (active && content?.kind === "page") setHere({ page: content.page, sessionId: null, hostId: null, sessionRevision: null });
  }, [active, content]);
  if (!content || content.kind === "session") return null;
  if (content.kind === "page") return <ToolPane closeButton initialHash={content.hash} page={content.page} onClose={onClose} onSwitchToken={onSwitchToken} onPopout={onPopout} vaultFile={content.vaultFile ?? null} vaultTab={content.vaultTab ?? "notizen"} escCloses={active} />;
  if (content.kind === "search") return <CommandBar embedded active onClose={onClose} />;
  if (content.kind === "browser") return <BrowserPanel sessionId={card.sessionId || null} label={card.sessionId || null} hostId={card.hostId ?? null} onClose={onClose} />;
  if (content.kind === "devices") return <DevicePanel sessionId={card.sessionId || null} label={card.sessionId || null} hostId={card.hostId ?? null} onClose={onClose} />;
  return <div class="file-card">
    <header class="tile-head"><strong>{content.path}</strong><button type="button" aria-label="Dateikarte schließen" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button></header>
    {content.sha ? <HistoricalBlobView target={content.target} hostId={card.hostId ?? null} path={content.path} sha={content.sha} /> : <FileViewer target={content.target} path={content.path} hostId={card.hostId ?? null} sessionId={card.sessionId || null} />}
  </div>;
}

import { t } from "../../shared/i18n/index.ts";
import { openWorkspaceContent } from "../workspace/open-content.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TreeEntry, TreeListing } from "@ancientvoid/contracts";
import { hostApi, remoteHost } from "../../shared/api.ts";
import { FileViewer } from "./FileViewer.tsx";
import { HistoricalBlobView } from "./HistoricalBlobView.tsx";
import { openPopout } from "../windows/windows.ts";
import { pointerOutside, type DropPoint } from "../windows/drag.ts";
import { canDetach } from "../windows/DetachButton.tsx";
import { rootKey, rootTarget, saveFilesState, type FilesRoot, type FilesState } from "./files-model.ts";
import { projectTail } from "../../shared/project-name.ts";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";

export interface FocusedSession {
  id: string;
  label: string;
  hostId?: string | null;
}

const GIT_MARK: Record<NonNullable<TreeEntry["git"]>, string> = { modified: "M", added: "A", deleted: "D", untracked: "U", ignored: "I", conflict: "!" };

/** Tooltip-Text je Statuspunkt-Kategorie (ADR-0089: blocked braucht den Menschen). */
const EPIC_DOT_LABEL: Record<NonNullable<TreeEntry["epic"]>, string> = {
  done: "abgeschlossen",
  code: "Code steht, Abnahme/Exit offen",
  wip: "in Umsetzung",
  open: "offen",
  blocked: "blockiert — braucht Menschen (Entscheid/Abnahme)",
};

/** Kinder eines geöffneten Ordners, seitenweise nachgeladen — nie rekursiv (ADR-0058 §2). */
function Folder({ hostId, target, path, depth, showIgnored, onOpenFile, activePath }: { hostId: string | null; target: string; path: string; depth: number; showIgnored: boolean; onOpenFile: (path: string) => void; activePath: string | null }) {
  const [pages, setPages] = useState<TreeListing[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const api = hostApi(hostId);
  const load = (offset: number, fresh: boolean) =>
    api
      .codeTree(target, path, offset, showIgnored)
      .then((l) => {
        setError("");
        setPages((prev) => (fresh ? [l] : [...prev, l]));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Ordner nicht lesbar"));
  useEffect(() => {
    setPages([]);
    void load(0, true);
  }, [target, path, showIgnored]);
  // Agentenänderungen: gezielte Revalidierung des geöffneten Ordners (ADR-0058 §2), ohne Watch-Abhängigkeit.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && pages.length <= 1) void load(0, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [target, path, showIgnored, pages.length]);
  const last = pages[pages.length - 1];
  const entries = pages.flatMap((p) => p.entries);
  return (
    <ul class="files-tree" role={depth === 0 ? "tree" : "group"}>
      {error && <li class="files-error" role="alert">{error}</li>}
      {entries.map((e) => {
        const isDir = e.kind === "dir" && e.blocked === null;
        const expanded = open.has(e.path);
        return (
          <li key={e.path} role="treeitem" aria-expanded={isDir ? expanded : undefined}>
            <button
              type="button"
              class={`files-row${activePath === e.path ? " active" : ""}${e.blocked ? " blocked" : ""}`}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              disabled={e.blocked !== null}
              title={e.blocked ?? e.path}
              data-path={e.path}
              onClick={() => {
                if (isDir) {
                  const next = new Set(open);
                  if (expanded) next.delete(e.path);
                  else next.add(e.path);
                  setOpen(next);
                } else if (e.kind === "file") onOpenFile(e.path);
              }}
            >
              <span class="files-glyph" aria-hidden="true">{isDir ? (expanded ? "▾" : "▸") : e.blocked ? "⛔" : e.symlink ? "↪" : "·"}</span>
              {e.epic && (
                <span
                  class={`epic-dot epic-${e.epic}`}
                  aria-hidden="true"
                  title={`${/^bug-\d/i.test(e.name) ? "Bug" : "Epic"}: ${EPIC_DOT_LABEL[e.epic] ?? e.epic} — ${e.epicStatus ?? ""}`}
                >
                  {e.epic === "blocked" ? "H" : ""}
                </span>
              )}
              <span class="files-name">{e.name}</span>
              {e.blocked && <span class="dim files-why">{e.blocked}</span>}
              {e.git && <span class={`files-git git-${e.git}`} title={e.git}>{GIT_MARK[e.git]}</span>}
            </button>
            {isDir && expanded && <Folder hostId={hostId} target={target} path={e.path} depth={depth + 1} showIgnored={showIgnored} onOpenFile={onOpenFile} activePath={activePath} />}
          </li>
        );
      })}
      {last?.nextOffset != null && (
        <li>
          <Button style={{ marginLeft: `${depth * 12 + 6}px` }} onClick={() => void load(last.nextOffset!, false)}>
            {t("files.further")} {last.total - entries.length} {t("files.load_entries")}
          </Button>
        </li>
      )}
      {pages.length > 0 && entries.length === 0 && !error && <li class="dim" style={{ paddingLeft: `${depth * 12 + 6}px` }}>{t("files.empty")}</li>}
      {depth === 0 && last && !last.filters.ignored && last.filters.ignoredHidden > 0 && (
        <li class="dim">{last.filters.ignoredHidden} {t("files.ignored_hidden")}</li>
      )}
    </ul>
  );
}

/**
 * EPIC-P46 T46.4 (ADR-0058): rechte Projekt-Sidebar (Desktop) bzw. Drawer (Touch). Root, Branch und Checkout
 * stehen sichtbar oben; die Root ist gepinnt und wechselt nie heimlich mit der Kachel.
 */
export function FilesSidebar({
  state,
  onChange,
  focused,
  projects,
  mobile,
  windowed = false,
}: {
  state: FilesState;
  onChange: (next: FilesState) => void;
  focused: FocusedSession | null;
  projects: { name: string; path: string; hostId?: string; hostLabel?: string }[];
  mobile: boolean;
  /** BUG-0128: im Dateibaum-Fenster füllt die Seitenleiste die Fläche; ✕ schließt das Fenster. */
  windowed?: boolean;
}) {
  const [identity, setIdentity] = useState<TreeListing["identity"] | null>(null);
  const root = state.root;
  const rKey = root ? rootKey(root) : "";
  const tabs = state.tabs.filter((t) => t.rootKey === rKey);
  const activeTab = state.active >= 0 ? state.tabs[state.active] : undefined;
  const viewing = activeTab && activeTab.rootKey === rKey ? activeTab : undefined;
  const [view, setView] = useState<"tree" | "file">(viewing ? "file" : "tree");
  const widthRef = useRef(state.width);
  widthRef.current = state.width;
  // ADR-0071: wenn ein Tab von außen gesetzt wurde, Dateiansicht zeigen.
  useEffect(() => {
    if (viewing) setView("file");
  }, [viewing?.path, viewing?.rootKey]);

  const roots = useMemo(() => {
    const list: FilesRoot[] = [];
    if (focused) list.push({ kind: "session", id: focused.id, label: `Session: ${focused.label}${remoteHost(focused.hostId) ? " (andere Maschine)" : ""}`, ...(remoteHost(focused.hostId) ? { hostId: remoteHost(focused.hostId) } : {}) });
    for (const p of projects) list.push({ kind: "project", path: p.path, label: `Projekt: ${p.name}${p.hostLabel ? ` (${p.hostLabel})` : ""}`, ...(p.hostId ? { hostId: p.hostId } : {}) });
    return list;
  }, [focused?.id, focused?.hostId, projects]);

  const update = (patch: Partial<FilesState>) => {
    const next = { ...state, ...patch };
    saveFilesState(next);
    onChange(next);
  };

  useEffect(() => {
    if (!root) return setIdentity(null);
    let alive = true;
    hostApi(root.hostId).codeTree(rootTarget(root), "", 0, false).then((l) => alive && setIdentity(l.identity)).catch(() => alive && setIdentity(null));
    return () => {
      alive = false;
    };
  }, [rKey]);

  const openFile = (path: string) => {
    if (root && openWorkspaceContent({ sessionId: root.kind === "session" ? root.id : "", ...(root.hostId ? { hostId: root.hostId } : {}), content: { kind: "file", target: rootTarget(root), path } })) return;
    const existing = state.tabs.findIndex((t) => t.rootKey === rKey && t.path === path && !t.sha);
    if (existing >= 0) update({ active: existing });
    else update({ tabs: [...state.tabs, { rootKey: rKey, path }], active: state.tabs.length });
    setView("file");
  };
  const closeTab = (index: number) => {
    const tabsNext = state.tabs.filter((_, i) => i !== index);
    update({ tabs: tabsNext, active: Math.min(state.active >= index ? state.active - 1 : state.active, tabsNext.length - 1) });
  };

  // BUG-0128: Herauslösen bündelt Baum und alle offenen Dateien in genau einem Fenster (nie Einzeldateien).
  const [dragOut, setDragOut] = useState(false);
  const [popoutBlocked, setPopoutBlocked] = useState(false);
  const detachTree = async (drop?: DropPoint) => {
    const result = await openPopout({ kind: "filetree" }, drop);
    if (result === "blocked") setPopoutBlocked(true);
    else {
      setPopoutBlocked(false);
      update({ open: false }); // verschoben: die Seitenleiste lebt jetzt im Fenster
    }
  };
  // EPIC-P34 T34.11-Muster: am Griff (oder am Datei-Tab) aus dem Fenster ziehen; der Zeiger bleibt erfasst.
  const startGrip = (e: PointerEvent) => {
    if (!canDetach() || e.button !== 0) return;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const outside = (ev: PointerEvent) => pointerOutside(ev.clientX, ev.clientY, { width: window.innerWidth, height: window.innerHeight });
    const move = (ev: PointerEvent) => setDragOut(outside(ev));
    const end = (ev: PointerEvent, drop: boolean) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      setDragOut(false);
      if (drop && outside(ev)) void detachTree({ left: ev.screenX, top: ev.screenY });
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
  };

  const startResize = (ev: PointerEvent) => {
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = widthRef.current;
    const move = (e: PointerEvent) => update({ width: Math.min(Math.max(startW + (startX - e.clientX), 280), 1100) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!state.open) return null;
  const showFile = view === "file" && viewing;
  return (
    <aside
      class={`files-sidebar${mobile ? " drawer" : ""}${dragOut ? " drag-out" : ""}`}
      style={mobile ? undefined : { width: windowed ? "100%" : `${state.width}px` }}
      aria-label={t("session.file_tree")}
      data-testid="files-sidebar"
    >
      {!mobile && !windowed && <div class="files-resize" role="separator" aria-orientation="vertical" aria-label={t("files.resize_width")} onPointerDown={startResize as never} />}
      <header class="files-head">
        {!windowed && canDetach() && (
          <span class={`files-grip${dragOut ? " dragging" : ""}`} aria-hidden="true" title={t("files.drag_out_tree")} onPointerDown={startGrip}>
            ⠿{dragOut ? " Loslassen bündelt Baum und Dateien in einem Fenster" : ""}
          </span>
        )}
        <select
          aria-label={t("files.file_source")}
          value={rKey}
          onChange={(e) => {
            const next = roots.find((r) => rootKey(r) === (e.target as HTMLSelectElement).value) ?? null;
            update({ root: next });
            setView("tree");
          }}
        >
          {!root && <option value="">{t("files.choose_source")}</option>}
          {root && !roots.some((r) => rootKey(r) === rKey) && <option value={rKey}>{root.label}</option>}
          {roots.map((r) => (
            <option key={rootKey(r)} value={rootKey(r)}>{r.label}</option>
          ))}
        </select>
        {!windowed && canDetach() && (
          <button
            type="button"
            class="files-detach"
            aria-label={t("files.tree_open_own")}
            title={t("files.tree_open_move")}
            onClick={() => void detachTree()}
          >
            ⧉
          </button>
        )}
        <Button aria-label={t("files.close_files")} onClick={() => (windowed ? window.close() : update({ open: false }))}>✕</Button>
      </header>
      {popoutBlocked && (
        <div class="files-error" role="alert">
          {t("app.popup_blocked")}
        </div>
      )}
      {identity && (
        <div class="files-identity dim" title={identity.root} data-tip={identity.root} data-testid="files-identity">
          {identity.kind === "session" ? "Worktree der Session" : "Projektordner"} · {projectTail(identity.root, 2)}
          {identity.branch ? ` · ${identity.branch}` : ""}
        </div>
      )}
      {!root && <EmptyState text={t("files.choose_session_project")} />}
      {root && (
        <>
          <div class="files-tabs" role="tablist">
            <Chip role="tab" aria-selected={!showFile}  onClick={() => setView("tree")} active={!showFile}>{t("files.tree")}</Chip>
            {tabs.map((tab) => {
              const index = state.tabs.indexOf(tab);
              return (
                <span key={tab.path} class="files-tab">
                  <Chip
                    role="tab"
                    aria-selected={Boolean(showFile) && state.active === index}
                    title={tab.sha ? `${tab.path} @ ${tab.sha.slice(0, 7)}` : tab.path}
                    onClick={() => { update({ active: index }); setView("file"); }}
                    onPointerDown={startGrip}
                    active={Boolean(showFile) && state.active === index}
                  >
                    {tab.path.split("/").pop()}
                    {tab.sha ? ` @${tab.sha.slice(0, 7)}` : ""}
                  </Chip>
                  {!windowed && canDetach() && (
                    <button
                      type="button"
                      class="files-tab-popout"
                      aria-label={`${tab.path} herauslösen: ein Fenster mit Baum und allen offenen Dateien`}
                      title={t("files.detach_tree")}
                      onClick={() => void detachTree()}
                    >
                      ⧉
                    </button>
                  )}
                  <button type="button" class="files-tab-close" aria-label={`${tab.path} schließen`} onClick={() => closeTab(index)}>×</button>
                </span>
              );
            })}
            {!showFile && (
              <label class="dim files-ignored">
                <input type="checkbox" checked={state.showIgnored} onChange={(e) => update({ showIgnored: (e.target as HTMLInputElement).checked })} /> {t("files.ignored")}
              </label>
            )}
          </div>
          <div class="files-body">
            {showFile && viewing?.sha ? (
              <HistoricalBlobView key={`${viewing.rootKey}:${viewing.path}:${viewing.sha}`} hostId={root.hostId ?? null} target={rootTarget(root)} path={viewing.path} sha={viewing.sha} />
            ) : showFile && viewing ? (
              <FileViewer key={`${viewing.rootKey}:${viewing.path}`} hostId={root.hostId ?? null} sessionId={root.kind === "session" ? root.id : null} target={rootTarget(root)} path={viewing.path} />
            ) : (
              <Folder key={`${rKey}:${state.showIgnored}`} hostId={root.hostId ?? null} target={rootTarget(root)} path="" depth={0} showIgnored={state.showIgnored} onOpenFile={openFile} activePath={viewing?.path ?? null} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

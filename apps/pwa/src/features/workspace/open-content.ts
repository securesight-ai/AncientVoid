import type { TileRef } from "./tiles.ts";

const EVENT = "ancientvoid:workspace-open";
/** A mounted grid claims the request; phone and popout callers keep their existing fallback. */
export function openWorkspaceContent(ref: TileRef): boolean {
  return !window.dispatchEvent(new CustomEvent<TileRef>(EVENT, { detail: ref, cancelable: true }));
}
export function onWorkspaceOpen(open: (ref: TileRef) => boolean): () => void {
  const listener = (e: Event) => {
    if (open((e as CustomEvent<TileRef>).detail)) e.preventDefault();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

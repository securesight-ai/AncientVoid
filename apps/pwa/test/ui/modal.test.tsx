import { describe, expect, it, vi } from "vitest";

/** Base-Modal (zentriert, App-Style) als Ersatz für Browser-Standard-Dialoge:
 * ConfirmDialog ersetzt confirm(), PromptDialog ersetzt window.prompt().
 * Hooks stubben wie sheet.test.tsx; `render` führt die Komponenten-Vnodes
 * (Modal → Sheet) aus, bis die Blatt-Knoten mit role=dialog dastehen. */

vi.mock("../../src/shared/overlay-focus.ts", () => ({
  useOverlayFocus: () => ({ ref: { current: null } }),
}));

vi.mock("preact/hooks", () => ({
  useEffect: () => undefined,
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => undefined] as const,
}));

// Dynamisch: vi.mock wird gehoistet, der Import muss danach landen (Muster sheet.test.tsx).
const { ConfirmDialog, Modal, PromptDialog } = await import("../../src/shared/ui/Modal.tsx");

type Node = { props?: Record<string, unknown> } | null | undefined;

function propsOf(node: Node): Record<string, unknown> | null {
  return node?.props ?? null;
}

/** Komponenten-Vnode ausführen (Modal → Sheet → …), bis Blatt-Knoten dastehen. */
function render(node: unknown): unknown {
  const fn = (node as { type?: unknown } | null)?.type;
  const p = propsOf(node as Node);
  if (typeof fn !== "function" || p === null) return node;
  return render((fn as (props: Record<string, unknown>) => unknown)(p));
}

/** Das Dialog-Kind (role=dialog) aus den gerenderten Kindern eines Modals. */
function dialogProps(node: unknown): Record<string, unknown> | null {
  const kids = propsOf(node as Node)?.children ?? node;
  const list = Array.isArray(kids) ? kids : kids != null ? [kids] : [];
  const dialog = list.find((c) => propsOf(c as Node)?.role === "dialog");
  return propsOf(dialog as Node);
}

/** Knoten mit Klasse sammeln (über den VDOM-Baum). */
function collect(children: unknown, cls: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  for (const c of Array.isArray(children) ? children : children != null ? [children] : []) {
    const p = propsOf(c as Node);
    if (p && typeof p.class === "string" && p.class.includes(cls)) out.push(p);
    if (p && p.children !== undefined) collect(p.children, cls, out);
  }
  return out;
}

function confirmNode(extra: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  return render(ConfirmDialog({ open: true, onClose: () => undefined, onConfirm: () => undefined, title: "L", body: "b", ...extra }));
}

describe("Modal (Base-Baustein, zentriert)", () => {
  it("geschlossen rendert nichts; offen: zentrierter Dialog mit aria-modal und Testanker", () => {
    expect(render(Modal({ open: false, onClose: () => undefined, label: "M", title: "Rückfrage" }))).toBeNull();
    const p = dialogProps(render(Modal({ open: true, onClose: () => undefined, label: "Rückfrage", title: "Wirklich?" })));
    expect(p?.role).toBe("dialog");
    expect(p?.["aria-modal"]).toBe("true");
    expect(p?.class).toContain("ui-sheet--modal");
    expect(p?.class).toContain("ui-modal");
    expect(p?.["data-testid"]).toBe("modal");
  });
});

describe("ConfirmDialog (confirm()-Ersatz)", () => {
  it("zeigt Titel, Text, Abbrechen und Bestätigen", () => {
    const p = dialogProps(confirmNode({ title: "Löschen?", body: "Endgültig weg." }));
    expect(JSON.stringify(p?.children)).toContain("Löschen?");
    expect(JSON.stringify(p?.children)).toContain("Endgültig weg.");
    expect(collect(p?.children, "ui-modal-cancel")).toHaveLength(1);
    expect(collect(p?.children, "ui-modal-confirm")).toHaveLength(1);
  });

  it("Bestätigen ist danger nur auf Verlangen", () => {
    expect(collect(dialogProps(confirmNode())?.children, "ui-modal-confirm")[0]?.class).not.toContain("danger");
    expect(collect(dialogProps(confirmNode({ danger: true }))?.children, "ui-modal-confirm")[0]?.class).toContain("danger");
  });

  it("Abbrechen ruft onClose, Bestätigen ruft onConfirm", () => {
    let confirmed = 0;
    let closed = 0;
    const p = dialogProps(render(ConfirmDialog({ open: true, onClose: () => (closed += 1), onConfirm: () => (confirmed += 1), title: "L", body: "b" })));
    (collect(p?.children, "ui-modal-cancel")[0]?.onClick as () => void)();
    (collect(p?.children, "ui-modal-confirm")[0]?.onClick as () => void)();
    expect(closed).toBe(1);
    expect(confirmed).toBe(1);
  });
});

describe("PromptDialog (window.prompt-Ersatz)", () => {
  it("Eingabefeld trägt die Vorbelegung; die Form reicht den getrimmten Text weiter", () => {
    let submitted = "(nicht gesendet)";
    const p = dialogProps(render(PromptDialog({ open: true, onClose: () => undefined, onSubmit: (text) => (submitted = text), title: "Notiz bearbeiten", label: "Text", value: "  vorhanden  " })));
    expect(collect(p?.children, "ui-modal-input")).toHaveLength(1);
    expect((collect(p?.children, "ui-modal-input")[0] as { value?: string }).value).toBe("  vorhanden  ");
    const form = collect(p?.children, "ui-modal-form")[0] as { onSubmit?: (e: { preventDefault: () => void }) => void };
    form.onSubmit?.({ preventDefault: () => undefined });
    expect(submitted).toBe("vorhanden");
  });

  it("leerer Text sendet nicht (wie window.prompt: Abbruch ohne Eingabe)", () => {
    let sent = false;
    const p = dialogProps(render(PromptDialog({ open: true, onClose: () => undefined, onSubmit: () => (sent = true), title: "T", value: "   " })));
    const form = collect(p?.children, "ui-modal-form")[0] as { onSubmit?: (e: { preventDefault: () => void }) => void };
    form.onSubmit?.({ preventDefault: () => undefined });
    expect(sent).toBe(false);
  });
});

void vi;

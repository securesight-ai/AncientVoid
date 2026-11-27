import { describe, expect, it, vi } from "vitest";

/** EPIC-P63 T63.8: Blatt-Baustein — Varianten, ARIA, Schließen-Callback.
 * Hooks (useOverlayFocus/useEffect) brauchen einen Preact-Baum; hier stubben
 * wir sie, damit die VDOM-Props prüfbar bleiben. Fokusfalle/Esc decken
 * fokus.spec.ts und shortcuts.spec.ts ab. */

vi.mock("../../src/shared/overlay-focus.ts", () => ({
  useOverlayFocus: () => ({ ref: { current: null } }),
}));

vi.mock("preact/hooks", () => ({
  useEffect: () => undefined,
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => undefined] as const,
}));

const { Sheet } = await import("../../src/shared/ui/Sheet.tsx");

function dialogProps(node: ReturnType<typeof Sheet>) {
  if (!node) return null;
  const kids = (node as { props?: { children?: unknown } }).props?.children;
  const list = Array.isArray(kids) ? kids : kids != null ? [kids] : [];
  const dialog = list.find((c) => (c as { props?: { role?: string } })?.props?.role === "dialog") as
    | { props: Record<string, unknown> & { class?: string } }
    | undefined;
  return dialog?.props ?? null;
}

describe("Sheet (EPIC-P63 T63.8)", () => {
  it("geschlossen rendert nichts", () => {
    expect(Sheet({ open: false, onClose: () => undefined, label: "X", children: "y" })).toBeNull();
  });

  it("offen: Dialog mit aria-modal, Label und ui-sheet", () => {
    const p = dialogProps(Sheet({ open: true, onClose: () => undefined, label: "Nyx", children: "Inhalt" }));
    expect(p?.role).toBe("dialog");
    expect(p?.["aria-modal"]).toBe("true");
    expect(p?.["aria-label"]).toBe("Nyx");
    expect(p?.class).toBe("ui-sheet");
  });

  it("variant modal setzt den Modifikator", () => {
    const p = dialogProps(Sheet({ open: true, onClose: () => undefined, label: "Sammelversand", variant: "modal", children: "x" }));
    expect(p?.class).toContain("ui-sheet--modal");
  });

  it("testid und eigene Klasse werden angehängt", () => {
    const p = dialogProps(Sheet({ open: true, onClose: () => undefined, label: "X", testid: "modal", class: "nyx-sheet", children: "x" }));
    expect(p?.["data-testid"]).toBe("modal");
    expect(p?.class).toBe("ui-sheet nyx-sheet");
  });

  it("Backdrop-Klick ruft onClose", () => {
    let closed = 0;
    const node = Sheet({ open: true, onClose: () => (closed += 1), label: "X", children: "y" })!;
    const kids = (node as { props: { children: unknown } }).props.children;
    const list = Array.isArray(kids) ? kids : [kids];
    const backdrop = list.find((c) => ((c as { props?: { class?: string } })?.props?.class ?? "").includes("ui-sheet-backdrop")) as {
      props: { onClick: () => void };
    };
    backdrop.props.onClick();
    expect(closed).toBe(1);
  });
});

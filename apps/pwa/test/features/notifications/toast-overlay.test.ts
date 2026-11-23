import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOAST_MS } from "../../../src/features/notifications/Notifications.tsx";

const cssDir = join(dirname(fileURLToPath(import.meta.url)), "../../../src/app/styles");

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} fehlt`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`${selector}: Block nicht geschlossen`);
}

describe("Toast-Overlay (kein Layout-Shift)", () => {
  it(".toast-stack ist fixed overlay mit --z-toast, nicht im Flow", () => {
    const css = readFileSync(join(cssDir, "14-notifications.css"), "utf8");
    const block = ruleBlock(css, ".toast-stack");
    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/z-index:\s*var\(--z-toast\)/);
    expect(block).toMatch(/pointer-events:\s*none/);
    expect(block).not.toMatch(/margin:\s*calc\(env\(safe-area-inset-top\)/);
  });

  it("Auto-Dismiss bleibt kurz (Overlay soll nicht dauerhaft hängen)", () => {
    expect(TOAST_MS.success).toBeLessThanOrEqual(5_000);
    expect(TOAST_MS.info).toBeLessThanOrEqual(5_000);
    expect(TOAST_MS.warning).toBeLessThanOrEqual(10_000);
    expect(TOAST_MS.error).toBeLessThanOrEqual(15_000);
    expect(TOAST_MS.error).toBeGreaterThan(TOAST_MS.success);
  });
});

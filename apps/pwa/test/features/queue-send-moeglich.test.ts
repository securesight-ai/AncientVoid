import { describe, expect, it } from "vitest";
import { sendNowPossible } from "../../src/features/session/QueueList.tsx";

/**
 * Nutzerfund 23.11.2026: „Jetzt senden“ gab auf dem PC nur Fehler, weil Pi
 * mitten im laufenden Zug nichts annimmt (BUG-0261: lenken = nächster Zug).
 */
describe("„Jetzt senden“ nur anbieten, wenn es klappen kann", () => {
  it("im Leerlauf geht immer, auch ohne Lenk-Zusage", () => {
    expect(sendNowPossible(false, false)).toBe(true);
    expect(sendNowPossible(false, true)).toBe(true);
  });
  it("im laufenden Zug nur, wenn der Adapter mitten im Zug annimmt", () => {
    expect(sendNowPossible(true, true)).toBe(true);
    expect(sendNowPossible(true, false)).toBe(false);
  });
});

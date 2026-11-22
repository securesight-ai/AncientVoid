import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { statusMock, speakMock } = vi.hoisted(() => ({ statusMock: vi.fn(), speakMock: vi.fn() }));
vi.mock("../../src/shared/api.ts", () => ({ hubApi: { ttsStatus: statusMock, ttsSpeak: speakMock } }));

/** Wie ein Browser-<audio>: play() startet, pause() stoppt, „ended" feuert von außen. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = true;
  private endedListeners: Array<() => void> = [];
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  async play(): Promise<void> {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(_type: "ended", listener: () => void): void {
    this.endedListeners.push(listener);
  }
  fireEnded(): void {
    this.paused = true;
    for (const l of this.endedListeners) l();
  }
}

/** EPIC-P75 T75.4: Status-Cache, Cap-Kürzung, Wiedergabe mit Stop und LRU. */
describe("Sprachausgabe-Client (T75.4)", () => {
  let objectUrls: string[];
  let revoked: string[];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    statusMock.mockReset();
    speakMock.mockReset();
    FakeAudio.instances = [];
    objectUrls = [];
    revoked = [];
    URL.createObjectURL = ((blob: Blob) => {
      const url = `blob:tts-${objectUrls.length}-${blob.size}`;
      objectUrls.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url);
    }) as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it("merkt sich die Verfügbarkeit, holt sie nach Aufforderung neu — und nie endlos (BUG-0214-Analogie)", async () => {
    const { ttsStatus, refreshTtsStatus } = await import("../../src/shared/tts.ts");
    statusMock.mockResolvedValue({ available: true, engine: "Qwen3-TTS" });
    expect((await ttsStatus()).available).toBe(true);
    await ttsStatus();
    expect(statusMock).toHaveBeenCalledTimes(1); // gemerkt, nicht jeder Knopf fragt den Hub

    statusMock.mockResolvedValue({ available: false, reason: "Sprachausgabedienst nicht erreichbar", checkedMsAgo: 0 });
    expect((await refreshTtsStatus()).available).toBe(false);
    expect(statusMock).toHaveBeenCalledTimes(2);

    statusMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await refreshTtsStatus()).available).toBe(false); // Hub weg ist „nicht verfügbar", kein Crash
  });

  it("kürzt am Byte-Cap, ohne ein Zeichen zu zerschneiden", async () => {
    const { clipToTtsCap } = await import("../../src/shared/tts.ts");
    const { TTS_MAX_TEXT_BYTES } = await import("@ancientvoid/contracts");
    expect(clipToTtsCap("a".repeat(TTS_MAX_TEXT_BYTES))).toEqual({ text: "a".repeat(TTS_MAX_TEXT_BYTES), truncated: false });
    const ascii = clipToTtsCap(`a${"b".repeat(TTS_MAX_TEXT_BYTES)}`);
    expect(ascii.truncated).toBe(true);
    expect(Buffer.byteLength(ascii.text, "utf8")).toBe(TTS_MAX_TEXT_BYTES);
    const umlaut = clipToTtsCap("ä".repeat(TTS_MAX_TEXT_BYTES)); // 2 Bytes je Zeichen
    expect(umlaut.truncated).toBe(true);
    expect(Buffer.byteLength(umlaut.text, "utf8")).toBe(TTS_MAX_TEXT_BYTES);
    expect(umlaut.text.endsWith("ä")).toBe(true);
    const emoji = clipToTtsCap("x".repeat(TTS_MAX_TEXT_BYTES - 2) + "🙂🙂"); // 4 Bytes je Emoji
    expect(emoji.text).not.toContain("\u{FFFD}");
    expect(Buffer.byteLength(emoji.text, "utf8")).toBeLessThanOrEqual(TTS_MAX_TEXT_BYTES);
    expect(emoji.text.endsWith("🙂") || emoji.text.endsWith("x")).toBe(true);
  });

  it("der Knopf-Grund unterscheidet nicht eingerichtet von Dienst weg (AC-P75-3)", async () => {
    const { ttsBlockReason } = await import("../../src/shared/SpeakButton.tsx");
    expect(ttsBlockReason({ available: true })).toBeNull();
    expect(ttsBlockReason({ available: false })).toBe("tts.reason_unconfigured");
    expect(ttsBlockReason({ available: false, checkedMsAgo: 0 })).toBe("tts.reason_unreachable");
  });

  it("checkedAgo wechselt bei zwei Minuten auf Minuten", async () => {
    const { checkedAgo } = await import("../../src/shared/tts.ts");
    expect(checkedAgo(0)).toEqual({ key: "tts.checked_ago_sec", n: 0 });
    expect(checkedAgo(45_000)).toEqual({ key: "tts.checked_ago_sec", n: 45 });
    expect(checkedAgo(119_499)).toEqual({ key: "tts.checked_ago_sec", n: 119 });
    expect(checkedAgo(120_000)).toEqual({ key: "tts.checked_ago_min", n: 2 });
    expect(checkedAgo(-5)).toEqual({ key: "tts.checked_ago_sec", n: 0 });
  });

  it("spielt synthetisiertes WAV ab und meldet das Ende", async () => {
    const { createTtsPlayer } = await import("../../src/shared/tts.ts");
    speakMock.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));
    const player = createTtsPlayer({ speak: speakMock as unknown as (text: string) => Promise<Blob>, makeAudio: (url) => new FakeAudio(url) });
    const handle = await player.speak("Lauf fertig.");
    expect(speakMock).toHaveBeenCalledWith("Lauf fertig.");
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe(objectUrls[0]);
    expect(audio.paused).toBe(false);
    audio.fireEnded();
    expect(await handle.ended).toBe("finished");
  });

  it("Stop pausiert und beendet; ein neuer Vorlese-Auftrag stoppt den alten", async () => {
    const { createTtsPlayer } = await import("../../src/shared/tts.ts");
    speakMock.mockImplementation(async (text: string) => new Blob([new TextEncoder().encode(text)], { type: "audio/wav" }));
    const player = createTtsPlayer({ speak: speakMock as unknown as (text: string) => Promise<Blob>, makeAudio: (url) => new FakeAudio(url) });
    const first = await player.speak("eins");
    const second = await player.speak("zwei");
    const firstAudio = FakeAudio.instances[0]!;
    expect(firstAudio.paused).toBe(true); // vom zweiten Auftrag gestoppt
    expect(await first.ended).toBe("stopped");
    const audio2 = FakeAudio.instances.at(-1)!;
    expect(audio2.paused).toBe(false);
    second.stop();
    expect(audio2.paused).toBe(true);
    expect(await second.ended).toBe("stopped");
  });

  it("derselbe Text kommt aus dem LRU-Cache; überzählige Blob-URLs werden freigegeben", async () => {
    const { createTtsPlayer } = await import("../../src/shared/tts.ts");
    speakMock.mockImplementation(async (text: string) => new Blob([new TextEncoder().encode(text)], { type: "audio/wav" }));
    const player = createTtsPlayer({ speak: speakMock as unknown as (text: string) => Promise<Blob>, makeAudio: (url) => new FakeAudio(url) });
    await player.speak("gleich");
    const again = await player.speak("gleich");
    expect(speakMock).toHaveBeenCalledTimes(1); // zweites Vorlesen: keine neue Synthese
    again.stop();
    for (let i = 0; i < 4; i += 1) await player.speak(`text-${i}`);
    expect(revoked).toContain(objectUrls[0]); // älteste URL freigegeben, nicht still geleakt
    expect(speakMock).toHaveBeenCalledTimes(5);
  });
});

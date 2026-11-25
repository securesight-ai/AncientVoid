/**
 * EPIC-P65 T65.1: kleiner WebAudio-Spieler für Status-Sounds — reine Synthese
 * (Oszillator + Hüllkurve), keine Assets, deshalb offline trivial (K10).
 * Autoplay-Policy: der Context startet suspended; die erste Nutzer-Geste
 * (global, einmalig via installSoundUnlock) resumed ihn — vor ihr wird nichts
 * gespielt (Premortem P65-1, dokumentiert statt stiller Ausfall). Der
 * Vorschau-Knopf in den Einstellungen ist die bewusste Geste.
 */

export type SoundCategory = "error" | "action" | "done" | "info";

export interface SoundVariant {
  id: string;
  label: string;
}

/** Je Kategorie 3–4 Varianten (AC-P65-2): der Nutzer wählt, was gefällt. */
export const SOUND_OPTIONS: Record<SoundCategory, readonly SoundVariant[]> = {
  error: [
    { id: "gong", label: "Gong, tief" },
    { id: "double", label: "Doppelsignal" },
    { id: "knock", label: "Klopfen" },
    { id: "horn", label: "Horn" },
  ],
  action: [
    { id: "bell", label: "Klingel" },
    { id: "double", label: "Doppelton" },
    { id: "blip", label: "Blip, hoch" },
    { id: "chime", label: "Glockenspiel" },
  ],
  done: [
    { id: "rise", label: "Aufsteigend" },
    { id: "bell", label: "Glocke" },
    { id: "chord", label: "Akkord" },
    { id: "trill", label: "Triller" },
  ],
  info: [
    { id: "blip", label: "Blip" },
    { id: "tick", label: "Tick" },
    { id: "ping", label: "Ping" },
  ],
};

/** Ein Ton: Frequenz Hz, Startversatz s, Dauer s, relative Lautstärke 0–1. */
type Note = [freq: number, at: number, dur: number, gain?: number];

const NOTES: Record<SoundCategory, Record<string, Note[]>> = {
  error: {
    gong: [[196, 0, 0.7, 1], [147, 0.02, 0.9, 0.7]],
    double: [[440, 0, 0.12], [440, 0.2, 0.22]],
    knock: [[220, 0, 0.07], [220, 0.12, 0.07], [196, 0.26, 0.16]],
    horn: [[311, 0, 0.45], [233, 0.05, 0.55, 0.8]],
  },
  action: {
    bell: [[880, 0, 0.35], [1174, 0.16, 0.45, 0.8]],
    double: [[784, 0, 0.1], [1046, 0.14, 0.22]],
    blip: [[1318, 0, 0.09], [1568, 0.12, 0.16, 0.8]],
    chime: [[1046, 0, 0.3], [1318, 0.12, 0.3], [1568, 0.24, 0.45, 0.8]],
  },
  done: {
    rise: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.3, 0.9]],
    bell: [[1046, 0, 0.5, 0.9], [1568, 0.03, 0.4, 0.35]],
    chord: [[523, 0, 0.5], [659, 0, 0.5, 0.8], [784, 0, 0.55, 0.7]],
    trill: [[880, 0, 0.09], [1108, 0.1, 0.09], [880, 0.2, 0.09], [1108, 0.3, 0.22]],
  },
  info: {
    blip: [[880, 0, 0.08]],
    tick: [[1760, 0, 0.04, 0.7]],
    ping: [[1568, 0, 0.25, 0.8]],
  },
};

interface CategorySound {
  enabled: boolean;
  variant: string;
  volume: number;
}

export interface SoundSettings {
  master: boolean;
  categories: Record<SoundCategory, CategorySound>;
}

const SOUNDS_KEY = "ancientvoid.sounds";
/** AC-P65-3: höchstens ein Sound je Kategorie pro 10 s — die Fleet soll kein
 * Glockenspiel veranstalten; Meldungen im Fenster verfallen still. */
export const RATE_LIMIT_MS = 10_000;
/** Synthese-Peak bei Lautstärke 1 — pure WebAudio-Trigger sind sonst brutal laut. */
const MASTER_GAIN = 0.25;
const VIBRATE_MS = 60;

/** Defaults (Epic §3.2): error/action/done an, info aus. */
export function defaultSoundSettings(): SoundSettings {
  const on = (variant: string): CategorySound => ({ enabled: true, variant, volume: 1 });
  return {
    master: true,
    categories: {
      error: on("gong"),
      action: on("bell"),
      done: on("rise"),
      info: { enabled: false, variant: "blip", volume: 1 },
    },
  };
}

export function loadSoundSettings(): SoundSettings {
  const fallback = defaultSoundSettings();
  try {
    const raw = localStorage.getItem(SOUNDS_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<SoundSettings>;
    const settings = structuredClone(fallback);
    if (typeof stored.master === "boolean") settings.master = stored.master;
    for (const cat of Object.keys(settings.categories) as SoundCategory[]) {
      const row = stored.categories?.[cat];
      if (!row) continue;
      if (typeof row.enabled === "boolean") settings.categories[cat]!.enabled = row.enabled;
      if (typeof row.variant === "string" && SOUND_OPTIONS[cat].some((o) => o.id === row.variant)) settings.categories[cat]!.variant = row.variant;
      if (typeof row.volume === "number" && row.volume >= 0 && row.volume <= 1) settings.categories[cat]!.volume = row.volume;
    }
    return settings;
  } catch {
    return fallback;
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(SOUNDS_KEY, JSON.stringify(settings));
  } catch {
    // Speicher voll oder privat — Sound-Einstellungen dürfen nichts werfen.
  }
}

export function volumeGain(volume: number): number {
  return Math.max(0, Math.min(1, volume)) * MASTER_GAIN;
}

/** Minimaler Schnitt durch die WebAudio-Teile, die der Spieler benutzt —
 * Tests injizieren eine Attrappe, der Browser liefert die echten Typen. */
interface AudioLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume?: () => Promise<void>;
  createOscillator: () => {
    type: string;
    frequency: { value: number };
    connect: (dest: unknown) => void;
    start: (when: number) => void;
    stop: (when: number) => void;
  };
  createGain: () => {
    gain: {
      value: number;
      setValueAtTime: (v: number, t: number) => void;
      linearRampToValueAtTime: (v: number, t: number) => void;
      exponentialRampToValueAtTime: (v: number, t: number) => void;
    };
    connect: (dest: unknown) => void;
  };
}

export interface SoundPlayer {
  /** true, wenn wirklich gespielt wurde (Master/Kategorie/Entsperrung/Rate-Limit). */
  playCategory: (category: SoundCategory) => boolean;
  /** Vorschau in den Einstellungen: entsperrt den Context und spielt sofort. */
  preview: (category: SoundCategory, variantId: string) => boolean;
  unlock: () => void;
}

function playNotes(ctx: AudioLike, notes: Note[], gainPeak: number): void {
  for (const [freq, at, dur, noteGain] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + at;
    const peak = gainPeak * (noteGain ?? 1);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

export interface SoundPlayerDeps {
  settings?: () => SoundSettings;
  now?: () => number;
  audioContext?: () => AudioLike | null;
  events?: EventTarget | null;
  vibrate?: (ms: number) => void;
}

export function createSoundPlayer(deps: SoundPlayerDeps = {}): SoundPlayer {
  const getSettings = deps.settings ?? loadSoundSettings;
  const now = deps.now ?? (() => Date.now());
  const audioContext = deps.audioContext ?? (() => (typeof window !== "undefined" ? new AudioContext() as unknown as AudioLike : null));
  const events = deps.events ?? (typeof window !== "undefined" ? window : null);
  const vibrate = deps.vibrate ?? ((ms: number) => {
    // Best effort (AC-P65-5): wo die API fehlt, ist das kein Fehler.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  });
  const lastPlayed: Partial<Record<SoundCategory, number>> = {};
  let ctx: AudioLike | null | undefined;
  let unlocked = false;

  if (events) {
    const unlock = () => {
      unlocked = true;
      void ctx?.resume?.();
    };
    events.addEventListener("pointerdown", unlock, { once: true });
    events.addEventListener("keydown", unlock, { once: true });
  }

  const context = (): AudioLike | null => {
    if (ctx === undefined) ctx = audioContext();
    return ctx;
  };

  const play = (category: SoundCategory, variantId: string, gainPeak: number, allowResume = false): boolean => {
    const c = context();
    if (!c) return false;
    if (!unlocked && !allowResume) return false;
    if (c.state !== "running") {
      // Ohne entsperrende Geste bleibt es beim Versuch (Premortem P65-1).
      if (!unlocked || !c.resume) return false;
    }
    const notes = NOTES[category][variantId];
    if (!notes) return false;
    playNotes(c, notes, gainPeak);
    return true;
  };

  return {
    playCategory: (category) => {
      const settings = getSettings();
      if (!settings.master) return false;
      const row = settings.categories[category];
      if (!row?.enabled) return false;
      const last = lastPlayed[category] ?? -Infinity;
      if (now() - last < RATE_LIMIT_MS) return false;
      const played = play(category, row.variant, volumeGain(row.volume));
      if (played) {
        lastPlayed[category] = now();
        if (category === "error" || category === "action") vibrate(VIBRATE_MS);
      }
      return played;
    },
    preview: (category, variantId) => {
      const c = context();
      if (!c) return false;
      const settings = getSettings();
      unlocked = true; // der Klick auf Vorschau ist selbst die Geste
      void c.resume?.();
      return play(category, variantId, volumeGain(settings.categories[category]?.volume ?? 1), true);
    },
    unlock: () => {
      unlocked = true;
      void context()?.resume?.();
    },
  };
}

/** App-weiter Spieler (main.tsx sperrt ihn über die erste Geste frei). */
export const soundPlayer = createSoundPlayer();

/** Einmalige globale Entsperrung (Muster wie installShortcutHints). */
export function installSoundUnlock(): void {
  if (typeof window === "undefined") return;
  const unlock = () => soundPlayer.unlock();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

/**
 * ADR-0090: die mehrstufige Zwischenablage („Ablage“).
 *
 * Alles, was die App irgendwo in die System-Zwischenablage legt (Diktat, markierte
 * Chat-Stelle, einzelner Ereignistext, Befehl, Kennung), liegt danach zusätzlich in einer
 * lokalen, mehrstufigen Ablage — damit ein überschriebener Text nicht weg ist, sondern nur
 * eine Stufe tiefer liegt. Sechs Stufen sind sichtbar, darüber hinaus rollt sie ab.
 *
 * Die Ablage ist **Gerät und Sitzung dieses Browsers**: sie geht nie zum Hub, sie wird nicht
 * über Sessions hinweg geteilt, und Geheimes (Token) kommt erst gar nicht hinein.
 */

export type ShelfOrigin = "diktat" | "markierung" | "eintrag" | "befehl" | "kennung" | "text" | "andere-app";

export interface ShelfEntry {
  id: string;
  text: string;
  origin: ShelfOrigin;
  /** ISO-Zeitpunkt der letzten Benutzung. */
  at: string;
  /** Wie oft dieser Text schon in die Zwischenablage zurückgeholt wurde. */
  uses: number;
  /** Langtext ist gekürzt gespeichert — die Ablage zeigt das offen an. */
  cut: boolean;
  /** ADR-0093: eine Stufe kann auch ein Bild sein (Screenshot aus einer anderen App). */
  kind?: "text" | "bild";
  /** Schlussel des Bildrohpixels in IndexedDB (`clipboard-images.ts`). */
  asset?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

/** Sichtbare Stufen der Ablage. */
export const SHELF_LEVELS = 6;
/** Harte Obergrenze im Speicher: was darüber liegt, ist weg (rollt ab). */
export const SHELF_MAX = 24;
/** Ein gespeicherter Langtext wird darüber gekürzt (Speicherplatz im Browser). */
export const SHELF_MAX_CHARS = 20_000;

const KEY = "ancientvoid.clipboard-shelf.v1";
export const SHELF_EVENT = "ancientvoid:clipboard-shelf";
export const OPEN_SHELF_EVENT = "ancientvoid:clipboard-shelf-open";

/** Woher ein Ablage-Stück kommt — in Menschenworten, für die Zeile im Blatt. */
export const SHELF_ORIGIN_LABEL: Record<ShelfOrigin, string> = {
  diktat: "Diktat",
  markierung: "Markierung",
  eintrag: "Eintrag",
  befehl: "Befehl",
  kennung: "Kennung",
  text: "Text",
  "andere-app": "Andere App",
};

let entries: ShelfEntry[] | null = null;
let counter = 0;

function load(): ShelfEntry[] {
  if (entries) return entries;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    entries = Array.isArray(parsed)
      ? parsed
          .filter((e): e is ShelfEntry => !!e && typeof e === "object" && typeof (e as ShelfEntry).text === "string" && typeof (e as ShelfEntry).id === "string")
          .slice(0, SHELF_MAX)
      : [];
  } catch {
    entries = [];
  }
  return entries;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Privater Modus oder voller Speicher: die Ablage bleibt trotzdem benutzbar —
    // nur über diese Sitzung hinweg. Das ist ehrlich, weil das Blatt es nicht behauptet.
  }
}

function announce(): void {
  // Der Browser hoert zu; ohne ihn (Testlauftrog Knoten, Vorlagenohne Fenster) ist die
  // Ablage trotzdem benutzbar — nur die live mitlaufende Anzeige fehlt.
  const target = typeof window === "undefined" ? null : window;
  target?.dispatchEvent(new CustomEvent(SHELF_EVENT));
}

/** Alles, was die App sich gemerkt hat — neueste Stufe zuerst. */
export function readShelf(): ShelfEntry[] {
  return [...load()];
}

export function openClipboardShelf(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SHELF_EVENT));
}

function nextId(): string {
  counter += 1;
  return `ablage-${Date.now().toString(36)}-${counter}`;
}

/**
 * Eine Zwischenablage-Aktion in die Ablage einreihen. `secret: true` (Token, Kennwörter)
 * speichert bewusst NICHTS — ADR-0090. Identischer Text ganz oben zählt als Benutzung,
 * identischer Text weiter unten steigt auf (so arbeitet ein Mensch mit einer Stufe).
 */
export function pushShelf(text: string, origin: ShelfOrigin, opts: { secret?: boolean } = {}): ShelfEntry | null {
  const trimmed = text.trim();
  if (!trimmed || opts.secret) return null;
  const list = load();
  const stored = trimmed.length > SHELF_MAX_CHARS ? trimmed.slice(0, SHELF_MAX_CHARS) : trimmed;
  const existing = list.findIndex((e) => e.text === stored);
  if (existing >= 0) {
    const [hit] = list.splice(existing, 1);
    const bumped: ShelfEntry = { ...hit!, uses: hit!.uses + 1, at: new Date().toISOString() };
    list.unshift(bumped);
    save();
    announce();
    return bumped;
  }
  const entry: ShelfEntry = { id: nextId(), text: stored, origin, at: new Date().toISOString(), uses: 0, cut: trimmed.length > SHELF_MAX_CHARS };
  list.unshift(entry);
  if (list.length > SHELF_MAX) list.length = SHELF_MAX;
  save();
  announce();
  return entry;
}

/**
 * ADR-0093: ein Bild aus dem System-Clipboard als Stufe einreihen. Die rohen Bytes
 * liegen in IndexedDB, die Stufe traegt nur den Schlussel dazu — `localStorage`
 * kennt keine Bilder. Dasselbe Bild steigt auf, statt sich zu vervielfaeltigen.
 */
export function pushShelfImage(input: {
  asset: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  origin?: ShelfOrigin;
}): ShelfEntry | null {
  const list = load();
  const bestehend = list.findIndex((e) => e.kind === "bild" && e.asset === input.asset);
  if (bestehend >= 0) {
    const [treffer] = list.splice(bestehend, 1);
    const gehoben: ShelfEntry = { ...treffer!, uses: treffer!.uses + 1, at: new Date().toISOString() };
    list.unshift(gehoben);
    save();
    announce();
    return gehoben;
  }
  const eintrag: ShelfEntry = {
    id: nextId(),
    text: "",
    kind: "bild",
    asset: input.asset,
    mime: input.mime,
    bytes: input.bytes,
    width: input.width,
    height: input.height,
    origin: input.origin ?? "andere-app",
    at: new Date().toISOString(),
    uses: 0,
    cut: false,
  };
  list.unshift(eintrag);
  if (list.length > SHELF_MAX) list.length = SHELF_MAX;
  save();
  announce();
  return eintrag;
}

/** Menschenwort fuer eine Bild-Stufe: „Screenshot 1080 × 2340 · 412 KB“. */
export function imageCaption(entry: ShelfEntry): string {
  const kanten = entry.width && entry.height ? `${entry.width} × ${entry.height}` : "Bild";
  const groesse = entry.bytes ? (entry.bytes >= 1024 * 1024 ? `${(entry.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(entry.bytes / 1024))} KB`) : "";
  return [kanten, groesse].filter(Boolean).join(" · ");
}

/** Eine Stufe zurück in die System-Zwischenablage: zählt als Benutzung und steigt auf. */
export function useShelf(id: string): ShelfEntry | null {
  const list = load();
  const index = list.findIndex((e) => e.id === id);
  if (index < 0) return null;
  const [hit] = list.splice(index, 1);
  const used: ShelfEntry = { ...hit!, uses: hit!.uses + 1, at: new Date().toISOString() };
  list.unshift(used);
  save();
  announce();
  return used;
}

/** Eine Stufe entfernen — ohne Bestätigung, weil sie nichts am Inhalt ändert. */
export function dropShelf(id: string): void {
  const list = load();
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return;
  entries = next;
  save();
  announce();
}

/** Die ganze Ablage leeren. */
export function clearShelf(): void {
  if (load().length === 0) return;
  entries = [];
  save();
  announce();
}

/** Erste `SHELF_LEVELS` Stufen — was das Blatt zeigt. */
export function visibleShelf(): ShelfEntry[] {
  return load().slice(0, SHELF_LEVELS);
}

/**
 * ADR-0092: die Rohaufnahme eines Diktats bleibt auf dem Geraet liegen, damit sie
 * neu erkannt werden kann — nach einem Ausfall der eigenen Erkennung ebenso wie nach
 * einem verhorten Fachwort oder einem Modellwechsel.
 *
 * Sie liegt im Browser dieses Geraets (IndexedDB), nie am Hub: Sprache verlaesst das
 * Geraet nur, wenn sie erkannt wird. Merkwuerdig sind wenige, kleine Stuecke — das
 * Aelteste fliegt zuerst. Und „weg“ meint wirklich weg.
 */
const DB_NAME = "ancientvoid.stt-recordings";
const STORE = "recordings.v1";
export const MAX_REPLAY_KEEP = 3;
const MAX_REPLAY_BYTES = 12 * 1024 * 1024;
export const REPLAY_EVENT = "ancientvoid:stt-replay";

export type ReplaySummary = {
  id: string;
  /** Sprachdauer in Sekunden — der Mensch rechnet damit, nicht mit Bytes. */
  seconds: number;
  at: number;
  mime: string;
  engine: string;
  /** Was im Feld stand, als die Aufnahme erkannt wurde — nur das darf ersetzt werden. */
  text: string;
  failed: boolean;
  reason: string;
};

export type ReplayRecording = ReplaySummary & { blob: Blob };

function melden(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

function neueId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Ausweichpfad fuer Browser ohne IndexedDB (und fuer die Unit-Laeufe ohne DOM):
// die Aufnahme bleibt dann nur bis zum Neuladen erhalten — aber sie ist da.
const gedaechtnis = new Map<string, ReplayRecording>();

let offen: Promise<IDBDatabase | null> | null = null;

function dbOffen(): Promise<IDBDatabase | null> {
  offen ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      const basis = anfrage.result;
      if (!basis.objectStoreNames.contains(STORE)) basis.createObjectStore(STORE, { keyPath: "id" });
    };
    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => resolve(null);
    anfrage.onblocked = () => resolve(null);
  });
  return offen;
}

/** Alles lesen — IndexedDB oder das Ausweichgedaechtnis. Neueste zuerst. */
async function alle(): Promise<ReplayRecording[]> {
  const basis = await dbOffen();
  if (!basis) return [...gedaechtnis.values()].sort((a, b) => b.at - a.at);
  return new Promise<ReplayRecording[]>((loesung) => {
    const anfrage = basis.transaction(STORE, "readonly").objectStore(STORE).getAll();
    anfrage.onsuccess = () => loesung(((anfrage.result ?? []) as ReplayRecording[]).sort((a, b) => b.at - a.at));
    anfrage.onerror = () => loesung([]);
  });
}

async function ablegen(recording: ReplayRecording): Promise<void> {
  const basis = await dbOffen();
  if (!basis) {
    gedaechtnis.set(recording.id, recording);
    return;
  }
  await new Promise<void>((loesung) => {
    const transaktion = basis.transaction(STORE, "readwrite");
    transaktion.objectStore(STORE).put(recording);
    transaktion.oncomplete = () => loesung();
    transaktion.onabort = () => loesung();
    transaktion.onerror = () => loesung();
  });
}

async function entfernen(id: string): Promise<void> {
  const basis = await dbOffen();
  if (!basis) {
    gedaechtnis.delete(id);
    return;
  }
  await new Promise<void>((loesung) => {
    const transaktion = basis.transaction(STORE, "readwrite");
    transaktion.objectStore(STORE).delete(id);
    transaktion.oncomplete = () => loesung();
    transaktion.onabort = () => loesung();
    transaktion.onerror = () => loesung();
  });
}

function ohneRoehre(recording: ReplayRecording): ReplaySummary {
  const { blob: _blob, ...zusammenfassung } = recording;
  return zusammenfassung;
}

/**
 * Aufnahme merken. Uebersteigt sie den Deckel, wird sie nicht gemerkt (sonst
 * verdrengt ein einziges Stueck alles andere). `ignored` sagt offen, dass nichts
 * gespeichert wurde.
 */
export async function saveRecording(input: {
  blob: Blob;
  mime: string;
  seconds: number;
  text?: string;
  engine?: string;
  failed?: boolean;
  reason?: string;
  keep?: number;
  budgetBytes?: number;
}): Promise<{ id: string; ignored?: boolean }> {
  const deckel = input.budgetBytes ?? MAX_REPLAY_BYTES;
  const behalten = input.keep ?? MAX_REPLAY_KEEP;
  const id = neueId();
  if (input.blob.size > deckel) return { id, ignored: true };

  await ablegen({
    id,
    seconds: Math.max(0, Math.round(input.seconds)),
    at: Date.now(),
    mime: input.mime,
    engine: input.engine ?? "",
    text: input.text ?? "",
    failed: input.failed ?? false,
    reason: input.reason ?? "",
    blob: input.blob,
  });

  // Ueberzahl und Bytes aufräumen — das Geradeweilsgemerkte bleibt immer drin.
  let verbraucht = 0;
  for (const [rang, stueck] of (await alle()).entries()) {
    verbraucht += stueck.blob.size;
    if (rang >= behalten || verbraucht > deckel) await entfernen(stueck.id);
  }
  melden();
  return { id };
}

export async function listRecordings(): Promise<ReplaySummary[]> {
  return (await alle()).map(ohneRoehre);
}

export async function getRecording(id: string): Promise<ReplayRecording | undefined> {
  const basis = await dbOffen();
  if (!basis) return gedaechtnis.get(id);
  return new Promise<ReplayRecording | undefined>((loesung) => {
    const anfrage = basis.transaction(STORE, "readonly").objectStore(STORE).get(id);
    anfrage.onsuccess = () => loesung((anfrage.result ?? undefined) as ReplayRecording | undefined);
    anfrage.onerror = () => loesung(undefined);
  });
}

export async function dropRecording(id: string): Promise<void> {
  await entfernen(id);
  melden();
}

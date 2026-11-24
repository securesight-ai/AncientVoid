/**
 * ADR-0093: Bilder aus dem System-Clipboard liegen in IndexedDB, nicht im Textspeicher.
 * Ein Handy-Screenshot ist 1–3 MB — in `localStorage` (Kontingent gut 5 MB) passt das
 * nicht hinein, und Base64 würde es noch aufblasen. Der Vorrat ist klein, rollt ab und
 * verlaesst das Geraet nicht.
 */
const DB_NAME = "ancientvoid.clipboard-images";
const STORE = "images.v1";
export const MAX_IMAGES = 12;
/** Ein einzelnes Bild darüber wird gar nicht erst genommen. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Der ganze Vorrat — damit ein voller Speicher nicht die App ausbremst. */
const MAX_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const IMAGE_EVENT = "ancientvoid:clipboard-images";

export interface ImageAsset {
  id: string;
  at: number;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  blob: Blob;
}

function melden(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IMAGE_EVENT));
}

function neueId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `bild-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Ausweichpfad ohne IndexedDB (und fuer Unit-Laeufe ohne DOM): bleibt ueber diese
// Sitzung erhalten — aber es geht nichts verloren, was gerade erst kopiert wurde.
const vorrat = new Map<string, ImageAsset>();

let offen: Promise<IDBDatabase | null> | null = null;

function basis(): Promise<IDBDatabase | null> {
  offen ??= new Promise<IDBDatabase | null>((loesung) => {
    if (typeof indexedDB === "undefined") {
      loesung(null);
      return;
    }
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      const datenbank = anfrage.result;
      if (!datenbank.objectStoreNames.contains(STORE)) datenbank.createObjectStore(STORE, { keyPath: "id" });
    };
    anfrage.onsuccess = () => loesung(anfrage.result);
    anfrage.onerror = () => loesung(null);
    anfrage.onblocked = () => loesung(null);
  });
  return offen;
}

async function alle(): Promise<ImageAsset[]> {
  const datenbank = await basis();
  if (!datenbank) return [...vorrat.values()].sort((a, b) => b.at - a.at);
  return new Promise<ImageAsset[]>((loesung) => {
    const anfrage = datenbank.transaction(STORE, "readonly").objectStore(STORE).getAll();
    anfrage.onsuccess = () => loesung(((anfrage.result ?? []) as ImageAsset[]).sort((a, b) => b.at - a.at));
    anfrage.onerror = () => loesung([]);
  });
}

async function ablegen(asset: ImageAsset): Promise<void> {
  const datenbank = await basis();
  if (!datenbank) {
    vorrat.set(asset.id, asset);
    return;
  }
  await new Promise<void>((loesung) => {
    const transaktion = datenbank.transaction(STORE, "readwrite");
    transaktion.objectStore(STORE).put(asset);
    transaktion.oncomplete = () => loesung();
    transaktion.onabort = () => loesung();
    transaktion.onerror = () => loesung();
  });
}

async function entfernen(id: string): Promise<void> {
  const datenbank = await basis();
  if (!datenbank) {
    vorrat.delete(id);
    return;
  }
  await new Promise<void>((loesung) => {
    const transaktion = datenbank.transaction(STORE, "readwrite");
    transaktion.objectStore(STORE).delete(id);
    transaktion.oncomplete = () => loesung();
    transaktion.onabort = () => loesung();
    transaktion.onerror = () => loesung();
  });
}

/**
 * Bild aufnehmen. Uebersteigt es den Einzel-Deckel, kommt es gar nicht erst hinein
 * (`ignored`), damit ein einzelnes riesiges Bild den ganzen Vorrat verdraengt.
 */
export async function saveImage(input: {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  keep?: number;
  budgetBytes?: number;
}): Promise<{ id: string; ignored?: boolean }> {
  const einzel = MAX_IMAGE_BYTES;
  const gesamt = input.budgetBytes ?? MAX_IMAGE_TOTAL_BYTES;
  const behalten = input.keep ?? MAX_IMAGES;
  const id = neueId();
  if (input.blob.size > einzel) return { id, ignored: true };

  await ablegen({
    id,
    at: Date.now(),
    mime: input.mime,
    bytes: input.blob.size,
    width: input.width,
    height: input.height,
    blob: input.blob,
  });

  let verbraucht = 0;
  for (const [rang, bild] of (await alle()).entries()) {
    verbraucht += bild.bytes;
    if (rang >= behalten || verbraucht > gesamt) await entfernen(bild.id);
  }
  melden();
  return { id };
}

export async function getImage(id: string): Promise<ImageAsset | undefined> {
  const datenbank = await basis();
  if (!datenbank) return vorrat.get(id);
  return new Promise<ImageAsset | undefined>((loesung) => {
    const anfrage = datenbank.transaction(STORE, "readonly").objectStore(STORE).get(id);
    anfrage.onsuccess = () => loesung((anfrage.result ?? undefined) as ImageAsset | undefined);
    anfrage.onerror = () => loesung(undefined);
  });
}

export async function dropImage(id: string): Promise<void> {
  await entfernen(id);
  melden();
}

/** Was der Vorrat hergibt — neuestes zuerst (ohne die rohen Bytes). */
export async function listImages(): Promise<Array<Omit<ImageAsset, "blob">>> {
  return (await alle()).map(({ blob: _blob, ...rest }) => rest);
}

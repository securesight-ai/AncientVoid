/**
 * BUG-0186: „Was liegt auf diesem Gerät?“ — ablesbar statt gefühlt.
 *
 * Ein installiertes PWA holt sich Fenster-Ausrichtung und Start aus dem Manifest, und
 * ein Service Worker kann dieses Manifest einbetonieren. Genau das war der Fall von
 * BUG-0181/BUG-0186: Das Manifest war im Netz freigegeben, der installierte Stand blieb
 * aber beim alten. Diese Datei sammelt die vier Tatsachen, die das beantworten:
 * Anzeigemodus, Ausrichtung des Fensters, ausgeliefertes Manifest und ob es in einem
 * Cache liegt — dazu die Cache-Version des aktiven Service Workers.
 */
import { BUILD_SHA_SHORT } from "./build-id.ts";

export interface DeviceStatus {
  /** Wie die App gerade läuft: eigenes Fenster (installiert) oder Browser-Tab. */
  displayMode: "installiert (eigenes Fenster)" | "Browser-Tab" | "unbekannt";
  /** `screen.orientation.type`, so wie das Fenster es sieht — „unbekannt“ ohne API. */
  windowOrientation: string;
  /** `screen.orientation.angle` in Grad — 0/90/180/270. null ohne API.
   * Der Winkel ist der Beweis, ob das Fenster auf ein Drehen des Geräts überhaupt
   * reagiert (BUG-0186). */
  windowAngle: number | null;
  /** Querformat-Urteil der Medienabfrage (das, worauf die Oberflaeche reagiert). */
  landscape: boolean;
  /** `orientation` aus dem Manifest, wie es diese App erreicht; „nicht lesbar“ bei Fehlern. */
  manifestOrientation: string;
  /** Caches, die ein Manifest-Exemplar halten — leer ist der Sollzustand (BUG-0186). */
  manifestCaches: string[];
  /** Cache-Version des aktiven Service Workers, null wenn keiner antwortet. */
  swCache: string | null;
}

/**
 * Benannte Typen statt verschachtelter Generic-Literale: die PWA baut mit JSX,
 * und `Promise<{ … }>`-Nestern lesen sich dort nicht mehr sauber.
 */
type MediaQueryResult = { matches: boolean };
type ManifestFetchResult = { ok: boolean; json(): Promise<unknown> };
type CacheIndex = { keys(): Promise<{ url: string }[]> };
type CacheStoreLike = { keys(): Promise<string[]>; open(name: string): Promise<CacheIndex> };

export interface DeviceStatusDeps {
  matchMedia?: (query: string) => MediaQueryResult;
  fetcher?: (input: string) => Promise<ManifestFetchResult>;
  caches?: CacheStoreLike;
  orientationType?: unknown;
  orientationAngle?: unknown;
  askServiceWorker?: () => Promise<string | null>;
}

const MANIFEST_PATH = "/manifest.webmanifest";

/** Der aktive Service Worker fragt seine eigene Cache-Version — eine Nachricht, eine
 * Antwort, ein Zeitlimit. Ohne Worker (oder ohne Antwort) ist das `null`, keine Lüge. */
function askServiceWorker(timeoutMs = 1500): Promise<string | null> {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  const controller = sw?.controller ?? null;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; cache?: unknown } | null;
      if (data?.type === "ancientvoid:sw-info" && typeof data.cache === "string") finish(data.cache);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    navigator.serviceWorker.addEventListener("message", onMessage);
    controller.postMessage({ type: "ancientvoid:sw-info" });
  });
}

/** Welche Caches halten ein Manifest-Exemplar fest? Das ist der eigentliche Beweis-
 * punkt: liegt dort eine alte Fassung, dreht die installierte App nicht — egal, was
 * das Netz ausliefert. */
export async function manifestCaches(store: CacheStorage): Promise<string[]> {
  const hits: string[] = [];
  for (const name of await store.keys()) {
    const cache = await store.open(name);
    const entries = await cache.keys();
    if (entries.some((req) => new URL(req.url, "http://localhost").pathname === MANIFEST_PATH)) hits.push(name);
  }
  return hits;
}

export async function gatherDeviceStatus(deps: DeviceStatusDeps = {}): Promise<DeviceStatus> {
  const mm = deps.matchMedia ?? (typeof matchMedia !== "undefined" ? matchMedia.bind(window) : undefined);
  const fetcher = deps.fetcher ?? ((input: string) => fetch(input) as unknown as Promise<ManifestFetchResult>);
  const store = deps.caches ?? (typeof caches !== "undefined" ? (caches as CacheStorage) : undefined);

  const standalone = mm?.("(display-mode: standalone)")?.matches === true;
  const browserTab = mm?.("(display-mode: browser)")?.matches === true;
  const displayMode: DeviceStatus["displayMode"] = standalone
    ? "installiert (eigenes Fenster)"
    : browserTab
      ? "Browser-Tab"
      : "unbekannt";

  const orientationType = deps.orientationType ?? (typeof screen !== "undefined" ? screen.orientation?.type : undefined);
  const orientationAngle = deps.orientationAngle ?? (typeof screen !== "undefined" ? (screen.orientation as { angle?: unknown } | undefined)?.angle : undefined);

  let manifestOrientation = "nicht lesbar";
  try {
    const res = await fetcher("/manifest.webmanifest");
    if (res.ok) {
      const manifest = (await res.json()) as { orientation?: unknown };
      // Ohne Feld gilt die Standard-Ausrichtung des Browsers — frei drehbar.
      manifestOrientation = typeof manifest?.orientation === "string" ? manifest.orientation : "any (nicht gesetzt)";
    }
  } catch {
    manifestOrientation = "nicht lesbar";
  }

  const manifestCachedIn = store ? await manifestCaches(store as CacheStorage) : [];
  const swCache = await (deps.askServiceWorker ?? askServiceWorker)();

  return {
    displayMode,
    windowOrientation: typeof orientationType === "string" && orientationType ? orientationType : "unbekannt",
    windowAngle: typeof orientationAngle === "number" && Number.isFinite(orientationAngle) ? orientationAngle : null,
    landscape: mm?.("(orientation: landscape)")?.matches === true,
    manifestOrientation,
    manifestCaches: manifestCachedIn,
    swCache,
  };
}

/** Was die Oberfläche sieht (Medienabfrage) ist der entscheidende Wert — die
 * Systemmeldung daneben, und wenn beide nicht zusammenpassen, steht das dabei.
 * (Emulation und manche Geräte melden eine Ausrichtung, die zum Fenster passt nicht.) */
function orientationLine(status: DeviceStatus): string {
  const erwartet = status.landscape ? "landscape" : "portrait";
  const gemeldet = status.windowOrientation;
  const weichtAb = gemeldet !== "unbekannt" && !gemeldet.startsWith(erwartet);
  return `Fenster-Ausrichtung: ${status.landscape ? "quer" : "hoch"} · Systemmeldung: ${gemeldet}${weichtAb ? " (passt nicht)" : ""}`;
}

/** Ein Satz pro Zeile, so formuliert, dass ein Fremder auf dem Handy daraus die
 * Ursache lesen kann. */
export function deviceStatusLines(status: DeviceStatus): string[] {
  const cacheLine =
    status.manifestCaches.length === 0
      ? "Manifest-Cache: keiner (Soll)"
      : `Manifest-Cache: liegt in ${status.manifestCaches.join(", ")} — die App dreht sonst nicht mit`;
  const folge =
    status.displayMode === "installiert (eigenes Fenster)" &&
    status.manifestCaches.length === 0 &&
    String(status.manifestOrientation) === "any" &&
    status.windowAngle === 0
      ? "Manifest ist frei und nichts ist einbetoniert, aber das Fenster bleibt bei 0° — die installierte App trägt die Ausrichtung aus ihrer Installation. Entfernen und über dieselbe Adresse neu hinzufügen heilt das."
      : null;
  return [
    `Anzeigemodus: ${status.displayMode}`,
    orientationLine(status),
    `Fenster-Winkel: ${status.windowAngle === null ? "unbekannt" : `${status.windowAngle}°`}`,
    `Manifest-Ausrichtung: ${status.manifestOrientation}`,
    cacheLine,
    `Service-Worker-Cache: ${status.swCache ?? "kein Worker antwortet"}`,
    // Welches Bündel hier läuft, kann nur das Bündel selbst beantworten: der Server weiß
    // nur, was er ausliefert, und ein Geräte-Cache kann älter sein als das.
    `App-Stand: ${BUILD_SHA_SHORT}`,
    ...(folge ? [folge] : []),
  ];
}

/**
 * Bilder aus dem Einfügen-Vorgang herauslösen — Text bleibt Text.
 *
 * Ein Screenshot liegt als Datei im Clipboard (Chrome/Edge am PC, bei vielen
 * Handy-Tastaturen und dem Freigaben-Dialog als Datei-Item). Nicht jede App füllt
 * `files` und `items`, deshalb werden beide gelesen und Duplikate verworfen — sonst
 * landet derselbe Screenshot zweimal im Composer.
 */
export function imageFilesFrom(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const out: File[] = [];
  const gesehen = new Set<string>();
  const nimm = (datei: File | null | undefined): void => {
    if (!datei || !datei.type.startsWith("image/")) return;
    const schlüssel = `${datei.name}|${datei.size}|${datei.type}`;
    if (gesehen.has(schlüssel)) return;
    gesehen.add(schlüssel);
    out.push(datei);
  };
  for (const datei of Array.from(transfer.files ?? [])) nimm(datei);
  for (const eintrag of Array.from(transfer.items ?? [])) {
    if (eintrag.kind !== "file") continue;
    nimm(eintrag.getAsFile());
  }
  return out;
}

const BILD_ENDUNG = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 *bilder aus der Zwischenablage als **Pfad** — der Fall unter Linux/Wayland.
 *
 * Datei-Manager (Nautilus, Dolphin, Thunar) und Werkzeuge wie `wl-copy`/`xclip`
 * legen beim Kopieren eines Bildes keine Bytes, sondern `file://`-URIs bzw. den
 * Pfad in die Zwischenablage; Chromium liefert unter Wayland die Bild-Bytes oft
 * gar nicht. Der Browser kann die Datei nicht lesen — der Hub auf demselben
 * Rechner schon (siehe Route `/api/local-files/bytes`).
 */
export function imagePathsFrom(transfer: DataTransfer | null | undefined): string[] {
  if (!transfer) return [];
  const roh: string[] = [];
  for (const typ of ["text/uri-list", "text/plain"]) {
    let wert = "";
    try {
      wert = transfer.getData(typ);
    } catch {
      continue;
    }
    if (wert) roh.push(wert);
  }
  const out: string[] = [];
  const gesehen = new Set<string>();
  for (const block of roh) {
    for (const zeile of block.split(/\r?\n/)) {
      let pfad = zeile.trim();
      if (!pfad || pfad.startsWith("#")) continue; // uri-list-Kommentarzeilen
      if (pfad.startsWith("file://")) {
        try {
          pfad = decodeURIComponent(pfad.slice(7));
        } catch {
          continue;
        }
      }
      if (!pfad.startsWith("/") || !BILD_ENDUNG.test(pfad)) continue;
      if (gesehen.has(pfad)) continue;
      gesehen.add(pfad);
      out.push(pfad);
    }
  }
  return out;
}

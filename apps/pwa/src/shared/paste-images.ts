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

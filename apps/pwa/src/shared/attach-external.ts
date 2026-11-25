/**
 * ADR-0093: ein Bild aus der Ablage an die Session anhängen. Die Anhang-Route gehört
 * zum Composer (Büroklammer), die Ablage ist appweit — deshalb ein Ereignis statt
 * Import über die Paketgrenze hinweg.
 */
const ATTACH_EXTERNAL_EVENT = "ancientvoid:attach-external";

export function requestAttach(file: File): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<File>(ATTACH_EXTERNAL_EVENT, { detail: file }));
}

export function onExternalAttach(cb: (file: File) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const auf = (e: Event) => {
    const datei = (e as CustomEvent<File>).detail;
    if (datei instanceof File) cb(datei);
  };
  window.addEventListener(ATTACH_EXTERNAL_EVENT, auf);
  return () => window.removeEventListener(ATTACH_EXTERNAL_EVENT, auf);
}

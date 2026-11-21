/**
 * EPIC-P79 T79.4: Zahlenformate der Token-Tempo-Seite. Bewusst hier und nicht
 * in shared/metrics.ts: diese Seite braucht kompakte Großzahlen (`49,1 Mio`)
 * undBinäreinheiten, und „nicht gemeldet“ ist hier ein Gedankenstrich, weil
 * die Karten sonst unleserlich werden.
 */

const DE = new Intl.NumberFormat("de-DE");

/** null → „—“ (nie 0). Große Token-Mengen kompakt, damit sie in eine Handyspalte passen. */
export function zahl(wert: number | null | undefined, nachkomma = 0): string {
  if (wert == null || !Number.isFinite(wert)) return "—";
  if (Math.abs(wert) >= 100_000_000) return `${DE.format(Math.round(wert / 1_000_000) / 10)} Mio`;
  if (Math.abs(wert) >= 1_000_000) return `${DE.format(Math.round(wert / 10_000) / 100)} Mio`;
  if (Math.abs(wert) >= 10_000) return DE.format(Math.round(wert));
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: nachkomma, minimumFractionDigits: nachkomma }).format(wert);
}

export function tempo(wert: number | null | undefined): string {
  if (wert == null || !Number.isFinite(wert)) return "—";
  return zahl(wert, Math.abs(wert) < 100 ? 1 : 0);
}

/** Anteil 0…1 → „98,4 %“; null bleibt „—“. */
export function anteil(wert: number | null | undefined): string {
  if (wert == null || !Number.isFinite(wert)) return "—";
  return `${DE.format(Math.round(wert * 1000) / 10)} %`;
}

export function dauer(secunden: number | null | undefined): string {
  if (secunden == null || !Number.isFinite(secunden)) return "—";
  if (secunden < 1) return `${DE.format(Math.round(secunden * 1000))} ms`;
  if (secunden < 120) return `${DE.format(Math.round(secunden * 10) / 10)} s`;
  const min = Math.floor(secunden / 60);
  const sek = Math.round(secunden % 60);
  if (min < 60) return `${min} min ${sek} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function byteGroesse(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const giB = bytes / 1024 ** 3;
  if (giB >= 1) return `${DE.format(Math.round(giB * 10) / 10)} GiB`;
  return `${DE.format(Math.round(bytes / 1024 ** 2))} MiB`;
}

/** Alter eines Zeitstempels in Sekunden (für „aktualisiert vor … s“). */
export function alter(iso: string | null, jetztMs: number = Date.now()): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((jetztMs - ms) / 1000));
}

/**
 * Punkte für eine einfache Verlaufs-Linie (SVG-Polyline in 0..100 × 0..100).
 * Leere/konstante Serien geben null — die Karte zeichnet dann nichts, statt
 * eine flache Linie als „stabil“ vorzutäuschen.
 */
export function verlauf(werte: number[], breite = 100, hohe = 32): string | null {
  const sauber = werte.filter((v) => Number.isFinite(v));
  if (sauber.length < 2) return null;
  const min = Math.min(...sauber);
  const max = Math.max(...sauber);
  const span = max - min || 1;
  return sauber
    .map((v, i) => {
      const x = (i / (sauber.length - 1)) * breite;
      const y = hohe - ((v - min) / span) * hohe;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

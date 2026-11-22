/** Suche (Nachschärfe 2026-11-22): Volltextindex über die Sessiontexte eines Hubs.
 * Öffentliche Fläche ist nur dieser Index — der Zugriff auf JSONL und Blobs
 * bleibt innen. */
export * from "./session-text-index.ts";

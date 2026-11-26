import { t } from "../../shared/i18n/index.ts";
import type { LiveText } from "./live-frames.ts";

/** Der wachsende Live-Strom (Denken und Antwort) eines laufenden Zugrahmens.
 *
 * ADR-0083: die Teiltexte kommen als transiente Rahmen über den Schwanz-WebSocket an;
 * die dauerhaften Block-Ereignisse holen alles ein. Dieser Baustein ist der **einzige**
 * Ort, der diesen Strom darstellt — Chat-Ansicht und Verlauf-Ansicht benutzen ihn, damit
 * das Streaming in beiden Anrichten gleich aussieht und gleich mitläuft (Nutzerfund
 * 24.11.2026: „in der App wird das Thinking so schön gestreamt und scrollt mit — im
 * Browser nicht“; der Strom hing an einem einzigen Reiter).
 */
export function LiveStream({ live }: { live: LiveText | null | undefined }) {
  if (!live || (!live.assistant && !live.thinking)) return null;
  return (
    <div data-testid="chat-live" aria-live="polite">
      {live.thinking ? (
        /* Das live uebertragene Denken ist eine Denk-Notiz wie jede andere in dieser
         * Ansicht: dieselbe Klasse, also auch dieselbe Groesse und derselbe Grund.
         * Ein eigener Kasten und 15 px machten es groesser als das Denken sonst
         * (Nutzerfund 17.11.2026). */
        <div class="turn-note thinking chat-live-note" data-testid="chat-live-thinking">
          {live.thinking}
          <span class="chat-live-caret" aria-hidden="true" />
        </div>
      ) : null}
      {live.assistant ? (
        <div class="chat-live">
          <span class="chat-live-label">{t("session.answering")}</span>
          <div class="chat-live-part" data-testid="chat-live-assistant">
            {live.assistant}
            <span class="chat-live-caret" aria-hidden="true" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { speechRecognitionSupported } from "../../shared/speech.ts";
import { EREIGNIS, grund, liesstModus, modusHinweis, setzeModus, waehlePfad, type SttFaehigkeiten, type SttModus } from "../../shared/stt-mode.ts";

/**
 * ADR-0095 (Nachtrag): die Quellenwahl kostet keinen Dauerplatz in der Eingabgegend.
 * Sie kommt als kleines Menue, wenn man den Mikro-Knopf **gedrückt hält**, und steht
 * ausserdem in den Einstellungen. Der Hinweis darunter nennt die Quelle beim Namen.
 */
const OPTIONEN: { wert: SttModus; knopf: string; label: string }[] = [
  { wert: "auto", knopf: "stt-modus-auto", label: "Automatisch" },
  { wert: "lokal", knopf: "stt-modus-lokal", label: "Lokal" },
  { wert: "browser", knopf: "stt-modus-browser", label: "Browser" },
];

export function SttModeMenu({ onClose }: { onClose: () => void }) {
  const [modus, setModus] = useState<SttModus>(() => liesstModus());
  const [status, setStatus] = useState<{ available: boolean; engine?: string }>({ available: false });
  const feld = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void sttStatus().then(setStatus);
    const horcht = () => setModus(liesstModus());
    window.addEventListener(EREIGNIS, horcht);
    return () => window.removeEventListener(EREIGNIS, horcht);
  }, []);

  // Das Menue haengt am Mikro-Knopf: direkt ueber ihm (oder darunter, wenn nach oben
  // zu wenig Platz ist), seitlich eingeklemmt. Der Knopf wandert beim Seitenwechsel
  // und bei Tastatur/Resize — deshalb wird er waehrend des offenen Menues nachgemessen,
  // damit das Menue nicht irgendwo in der Gegend steht.
  useEffect(() => {
    const setzen = () => {
      const el = feld.current;
      const kn = document.querySelector("[data-nyx-fab]")?.getBoundingClientRect();
      if (!el || !kn) return;
      const kasten = el.getBoundingClientRect();
      const breite = kasten?.width ?? 268;
      const hoehe = kasten?.height ?? 100;
      const links = Math.min(Math.max(kn.left + kn.width / 2 - breite / 2, 8), Math.max(8, window.innerWidth - breite - 8));
      const oben = kn.top - hoehe - 12;
      const top = oben >= 8 ? oben : kn.bottom + 12;
      // Position imperativ gesetzt: der ui-primitives-Raechtel (AC-P63-4) haelt
      // Inline-Style-Objekte klein, und ein Popover gehoert nicht dazu.
      el.style.left = `${Math.round(links)}px`;
      el.style.top = `${Math.round(top)}px`;
    };
    setzen();
    const zwaeter = [60, 220, 700, 1600].map((ms) => window.setTimeout(setzen, ms));
    const interval = window.setInterval(setzen, 300);
    window.addEventListener("resize", setzen);
    window.addEventListener("scroll", setzen, { passive: true });
    return () => {
      zwaeter.forEach(clearTimeout);
      clearInterval(interval);
      window.removeEventListener("resize", setzen);
      window.removeEventListener("scroll", setzen);
    };
  }, []);

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const ausserhalb = (e: PointerEvent) => {
      if (feld.current && !feld.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", taste);
    window.addEventListener("pointerdown", ausserhalb, true);
    return () => {
      window.removeEventListener("keydown", taste);
      window.removeEventListener("pointerdown", ausserhalb, true);
    };
  }, [onClose]);

  const faehigkeiten: SttFaehigkeiten = {
    lokalVerfuegbar: status.available,
    aufnahmeMoeglich: recordingSupported(),
    browserFaehig: speechRecognitionSupported(),
  };
  const pfad = waehlePfad(modus, faehigkeiten);

  return (
    <div
      class="stt-modus-menue"
      data-testid="stt-modus-menu"
      role="dialog"
      aria-label={t("stt.voice_source")}
      ref={feld}
    >
      <div class="stt-modus-head" data-testid="stt-modus-head">{t("stt.voice_source")}</div>
      <div class="segmented">
        {OPTIONEN.map((o) => (
          <button
            key={o.wert}
            type="button"
            data-testid={o.knopf}
            class={o.wert === modus ? "active" : ""}
            aria-pressed={o.wert === modus}
            onClick={() => {
              setModus(setzeModus(o.wert));
              onClose(); // die Wahl ist getroffen — das Menue raumt den Weg frei
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div class="stt-modus-note" data-testid="stt-modus-note">
        {pfad === "kein" ? grund(modus, faehigkeiten) : modusHinweis(modus, faehigkeiten, status.engine)}
      </div>
    </div>
  );
}

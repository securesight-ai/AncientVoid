import { useEffect, useState } from "preact/hooks";
import { Sheet } from "../../shared/ui/Sheet.tsx";
import { Button, EmptyState, Switch } from "../../shared/ui/index.ts";
import { ago } from "../../shared/status.ts";
import { dropImage, getImage } from "../../shared/clipboard-images.ts";
import { copyImageIntoSystem } from "../../shared/clipboard-copy.ts";
import { requestAttach } from "../../shared/attach-external.ts";
import { INGEST_EVENT, erlaubnisLage, ingestEnabled, installClipboardIngest, setIngestEnabled } from "../../shared/clipboard-ingest.ts";
import { pasteTranscript } from "../stt/paste-target.ts";
import { discardReplay, reRecognize } from "../stt/replay-recognize.ts";
import { listRecordings, REPLAY_EVENT, type ReplaySummary } from "../../shared/stt-replay.ts";
import {
  clearShelf,
  closeClipboardShelf,
  dropShelf,
  OPEN_SHELF_EVENT,
  SHELF_EVENT,
  SHELF_LEVELS,
  SHELF_MAX,
  SHELF_ORIGIN_LABEL,
  imageCaption,
  useShelf,
  visibleShelf,
  type ShelfEntry,
} from "../../shared/clipboard-shelf.ts";

/** Ablage-Einträge dieses Geräts (Stufen und Sprachnachrichten) — für Knöpfe ausserhalb des Blatts (Composer). */
export function useShelfCount(): number {
  const [count, setCount] = useState(() => visibleShelf().length);
  useEffect(() => {
    // Sprachnachrichten zählen mit: ihre Zahl am Knopf sagt, dass etwas wartet (ADR-0092-Nachtrag).
    const on = () => {
      const stufen = visibleShelf().length;
      void listRecordings().then((r) => setCount(stufen + r.length));
    };
    on();
    window.addEventListener(SHELF_EVENT, on);
    window.addEventListener(REPLAY_EVENT, on);
    return () => {
      window.removeEventListener(SHELF_EVENT, on);
      window.removeEventListener(REPLAY_EVENT, on);
    };
  }, []);
  return count;
}

/** Zwei Blätter versetzt übereinander — die Ablage ist ein Stapel, keine Zeilenliste.
 *  Die frühere Form mit vier Strichen las sich als Textausrichtung, nicht als Stapel. */
/** echtes Vorschaubild aus dem Blob — Objekt-URL, beim Verschwinden zurueckgegeben */
function ShelfThumb({ entry }: { entry: ShelfEntry }) {
  const [quelle, setQuelle] = useState("");
  useEffect(() => {
    let lebt = true;
    let url = "";
    if (entry.asset) {
      void getImage(entry.asset).then((bild) => {
        if (!lebt || !bild) return;
        url = URL.createObjectURL(bild.blob);
        setQuelle(url);
      });
    }
    return () => {
      lebt = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.asset]);
  return quelle ? (
    <img class="shelf-thumb" data-testid="shelf-thumb" src={quelle} alt={imageCaption(entry)} />
  ) : (
    <span class="shelf-thumb shelf-thumb-fehlt" data-testid="shelf-thumb" aria-hidden="true">?</span>
  );
}

function ShelfGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="8.5" y="4.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 19.5h-9a2.5 2.5 0 0 1-2.5-2.5v-9" />
    </svg>
  );
}

/**
 * ADR-0090: die mehrstufige Zwischenablage. Sechs Stufen sichtbar, jede mit Einfügen,
 * Zurückholen und Entfernen. Was hier steht, liegt nur in diesem Browser — der Hinweis am
 * Ende ist keine Deko, er ist die Zusage des Designs.
 */
export function ClipboardShelf() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ShelfEntry[]>(() => visibleShelf());
  const [aufnahmen, setAufnahmen] = useState<ReplaySummary[]>([]);
  // ADR-0093: extern Kopiertes hereinholen — der Schalter bleibt hier sichtbar, weil
  // „die App liest mein Clipboard“ eine Entscheidung ist, keine Selbstverständlichkeit.
  const [an, setAn] = useState(() => ingestEnabled());
  const [lage, setLage] = useState<"erlaubt" | "verweigert" | "weiss nicht">("weiss nicht");

  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);

  const sync = () => setEntries(visibleShelf());
  const syncVoice = () => void listRecordings().then(setAufnahmen);
  // Das Blatt ist appweit montiert — hier hoert die App auf, beim Wiederkommen
  // ins System-Clipboard zu schauen (ADR-0093).
  useEffect(() => installClipboardIngest(), []);

  useEffect(() => {
    const auf = () => setAn(ingestEnabled());
    window.addEventListener(INGEST_EVENT, auf);
    return () => window.removeEventListener(INGEST_EVENT, auf);
  }, []);
  useEffect(() => {
    if (!open) return;
    void erlaubnisLage().then(setLage);
  }, [open]);

  useEffect(() => {
    const open_ = () => {
      sync();
      setNote("");
      setArmed(false);
      setOpen(true);
    };
    const close = () => setOpen(false);
    window.addEventListener(OPEN_SHELF_EVENT, open_);
    window.addEventListener(`${OPEN_SHELF_EVENT}:close`, close);
    window.addEventListener(SHELF_EVENT, sync);
    return () => {
      window.removeEventListener(OPEN_SHELF_EVENT, open_);
      window.removeEventListener(`${OPEN_SHELF_EVENT}:close`, close);
      window.removeEventListener(SHELF_EVENT, sync);
    };
  }, []);
  useEffect(() => {
    window.addEventListener(REPLAY_EVENT, syncVoice);
    syncVoice();
    return () => window.removeEventListener(REPLAY_EVENT, syncVoice);
  }, []);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const insert = async (entry: ShelfEntry) => {
    useShelf(entry.id);
    const where = await pasteTranscript(entry.text, { shelve: false });
    if (where === "nowhere") {
      const ok = await copyBack(entry);
      setNote(ok ? "kein Feld fokussiert — in die Zwischenablage geholt" : "weder Feld noch Zwischenablage — Text hier ablesen");
      return;
    }
    setOpen(false);
  };

  const copyBack = async (entry: ShelfEntry): Promise<boolean> => {
    useShelf(entry.id);
    if (!navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(entry.text);
      setNote("in die Zwischenablage zurückgeholt");
      return true;
    } catch {
      setNote("Zwischenablage nicht erlaubt — Text hier ablesen");
      return false;
    }
  };

  const remove = (entry: ShelfEntry) => {
    dropShelf(entry.id);
    // ADR-0093: zu einer Bild-Stufe gehört auch ihre Rohpixelf — „entfernen“ meint weg.
    if (entry.asset) void dropImage(entry.asset);
    sync();
  };

  // ADR-0093: einScreenshot aus einer anderen App an die Session haengen — derselbe Weg
  // wie die Bueroeklammer (Hochladen, Lese-Status im Anhaenger-Chip).
  const anhaengen = async (entry: ShelfEntry): Promise<void> => {
    if (!entry.asset) return;
    const bild = await getImage(entry.asset);
    if (!bild) {
      setNote("Bild ist nicht mehr da — die Stufe zeigt ins Leere.");
      remove(entry);
      return;
    }
    const name = `screenshot-${new Date(bild.at).toISOString().replace(/[:.]/g, "-")}.${bild.mime === "image/jpeg" ? "jpg" : "png"}`;
    requestAttach(new File([bild.blob], name, { type: bild.mime }));
    useShelf(entry.id);
    setNote("angehängt — der Anhang wird gelesen (OCR), danach kann er im Chat verwendet werden");
    sync();
  };

  const bildZurueck = async (entry: ShelfEntry): Promise<void> => {
    if (!entry.asset) return;
    const bild = await getImage(entry.asset);
    if (!bild) {
      setNote("Bild ist nicht mehr da.");
      remove(entry);
      return;
    }
    const geklappt = await copyImageIntoSystem(bild.blob, bild.mime);
    if (geklappt) {
      useShelf(entry.id);
      setNote("Bild in die Zwischenablage zurückgeholt");
    } else {
      setNote("Dieser Browser kann kein Bild ins System-Clipboard legen — „anhängen“ funktioniert.");
    }
    sync();
  };

  const clearAll = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    clearShelf();
    setArmed(false);
    sync();
    setNote("Ablage geleert");
  };

  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceNeu = async (aufnahme: ReplaySummary) => {
    setVoiceBusy(true);
    try {
      setNote((await reRecognize(aufnahme)).note);
    } finally {
      setVoiceBusy(false);
      syncVoice();
    }
  };
  const voiceWeg = async (aufnahme: ReplaySummary) => {
    await discardReplay(aufnahme);
    syncVoice();
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Zwischenablage-Ablage" testid="clipboard-shelf">
      <div class="shelf">
        <header class="shelf-head">
          <h2 class="shelf-title">Ablage</h2>
          <p class="shelf-sub">
            {entries.length === 0 ? "leer" : `${entries.length} von ${SHELF_MAX} Stufen`} · neueste zuerst
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              class="link-btn shelf-clear"
              data-testid="shelf-clear"
              onClick={clearAll}
              title="Erstmal tippen fragt nach, nochmal tippen leert"
            >
              {armed ? "wirklich alles löschen?" : "alle löschen"}
            </button>
          )}
        </header>

        {entries.length === 0 && aufnahmen.length === 0 ? (
          <EmptyState
            icon={<ShelfGlyph />}
            text="Noch nichts abgelegt. Was die App kopiert — Diktat, Markierung, Befehl, Eintrag — liegt eine Stufe tiefer hier; beim Wiederkommen kommt auch extern Kopiertes herein (Text und Screenshot). Token bleiben draußen."
            action={<Button size="sm" onClick={() => setOpen(false)}>schließen</Button>}
          />
        ) : (
          <ul class="shelf-list" data-testid="shelf-list">
            {entries.map((entry, index) => (
              <li class="shelf-row" data-testid="shelf-row" key={entry.id}>
                <span class="shelf-step" aria-hidden="true">{index + 1}</span>
                <div class="shelf-body">
                  {entry.kind === "bild" ? (
                    <div class="shelf-bild">
                      <ShelfThumb entry={entry} />
                      <p class="shelf-text shelf-caption">{imageCaption(entry)}</p>
                    </div>
                  ) : (
                    <p class="shelf-text">{entry.text}</p>
                  )}
                <div class="shelf-meta">
                  <span class="shelf-origin">{SHELF_ORIGIN_LABEL[entry.origin]}</span>
                  <span class="dim">{ago(entry.at)}</span>
                  {entry.uses > 0 && <span class="dim">{entry.uses + 1}× geholt</span>}
                  {entry.cut && <span class="dim">gekürzt</span>}
                </div>
                {/* Eine echte Taste, der Rest als Textstelle — sechs Reihen mit drei
                    gleich grossen Knöpfen schreien, und "einfügen" ist die Entscheidung. */}
                <div class="shelf-actions">
                  {entry.kind === "bild" ? (
                    <Button size="sm" data-testid="shelf-attach" onClick={() => void anhaengen(entry)}>anhängen</Button>
                  ) : (
                    <Button size="sm" data-testid="shelf-insert" onClick={() => void insert(entry)}>Einfügen</Button>
                  )}
                  <button type="button" class="link-btn shelf-copy" data-testid="shelf-copy" onClick={() => void (entry.kind === "bild" ? bildZurueck(entry) : copyBack(entry))}>in die Zwischenablage</button>
                  <span class="shelf-dot" aria-hidden="true">·</span>
                  <button type="button" class="link-btn shelf-drop" data-testid="shelf-drop" onClick={() => remove(entry)}>entfernen</button>
                </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {aufnahmen.length > 0 && (
          <div class="shelf-voices">
            <p class="shelf-sub" data-testid="shelf-voice-sub">
              {/* i18n-ignore: ADR-0092-Nachtrag — Sprachnachrichten-Abschnitt, t()-Welle steht aus */}
              Sprachnachrichten — neu erkennen, solange sie da sind (die drei neuesten, höchstens 12 MB)
            </p>
            <ul class="shelf-list" data-testid="shelf-voice">
              {aufnahmen.map((aufnahme) => (
                <li class="shelf-row" data-testid="shelf-voice-row" key={aufnahme.id}>
                  <span class="shelf-step" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
                    </svg>
                  </span>
                  <div class="shelf-body">
                    <p class="shelf-text shelf-caption">
                      {/* i18n-ignore: ADR-0092-Nachtrag — Sprachnachricht-Zeile, t()-Welle steht aus */}
                      Sprachnachricht · {aufnahme.seconds} s{aufnahme.failed ? " · Erkennung fehlgeschlagen" : ""}
                    </p>
                    <div class="shelf-meta">
                      {/* i18n-ignore: ADR-0092-Nachtrag — Herkunftslabel wie SHELF_ORIGIN_LABEL, t()-Welle steht aus */}
                      <span class="shelf-origin">Diktat</span>
                      <span class="dim">{ago(new Date(aufnahme.at).toISOString())}</span>
                    </div>
                    <div class="shelf-actions">
                      {/* i18n-ignore: ADR-0092-Nachtrag — Aktion der Sprachnachricht, t()-Welle steht aus */}
                      <Button size="sm" data-testid="shelf-voice-run" disabled={voiceBusy} onClick={() => void voiceNeu(aufnahme)}>neu erkennen</Button>
                      <span class="shelf-dot" aria-hidden="true">·</span>
                      {/* i18n-ignore: ADR-0092-Nachtrag — Aktion der Sprachnachricht, t()-Welle steht aus */}
                      <button type="button" class="link-btn shelf-drop" data-testid="shelf-voice-drop" onClick={() => void voiceWeg(aufnahme)}>weg</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {note && <p class="shelf-note" role="status" data-testid="shelf-note">{note}</p>}
        <div class="shelf-ingest">
          <span>aus anderen Apps übernehmen</span>
          <Switch label="aus anderen Apps übernehmen" checked={an} onChange={(next) => { setAn(next); setIngestEnabled(next); }} />
        </div>
        <p class="shelf-ingest-hinweis">
          {lage === "verweigert"
            ? "Der Browser verweigert das Lesen der System-Zwischenablage — in den Browser-Einstellungen erlauben."
            : "Beim Wiederkommen wird einmal ins System-Clipboard geschaut (Text und Screenshot). Was kopiert wurde, während die App geschlossen war, kann kein Browser nachholen."}
        </p>
        <p class="shelf-privacy">
          Nur auf diesem Gerät in diesem Browser — die Ablage geht nie zum Hub. Sichtbar sind {SHELF_LEVELS} Stufen, gemerkt bis {SHELF_MAX}; Bilder liegen getrennt (zwölf Stück, höchstens 24 MB), Sprachnachrichten ebenso (drei neueste, höchstens 12 MB).
        </p>
      </div>
    </Sheet>
  );
}

export { ShelfGlyph, closeClipboardShelf };

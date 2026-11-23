# Bild-Links: jedes Bild, das ein Agent bearbeitet, kommt mit anklickbarem Link

**Art:** how-to

Stand: 2026-11-23 · Einführung: Nutzerwunsch 2026-11-23 · Oberfläche: [`funktionsinventar.md`](funktionsinventar.md) S82

Wer als Agent mit Bildern arbeitet (Selbsttest-Screenshots, Diagnosebilder,
Kritik an einer Oberfläche), liefert sie **nicht** als Pfad ab. Kai liest auf dem
Handy und kann dort kein Dateiverzeichnis durchsuchen. Also: Bild hochladen, Link
dazuschreiben — ein Klick, und das Bild ist im Vollbild.

## Bild hochladen — ein Request

```bash
curl -sS -X POST "http://127.0.0.1:7373/api/attachments" \
  -H "authorization: Bearer $AV_TOKEN" \
  -H "content-type: image/png" \
  -H "x-filename: selbsttest-vollbild.png" \
  --data-binary "@data/tmp-debug/selbsttest-vollbild.png"
```

Antwort: `{"id":"<64 Hex>", "kind":"image", "bytes":…,"extraction":…}`. Das Bild liegt
danach im Hub-Datadir (`data/attachments/<sha256>`), der Hub liest es (OCR) wie jeden
Anhang. Der Token ist ein Geräte-Token (siehe Skill `ancientvoid-live-hub`); für einen
einmaligen Wurf ein Zweck-Token ausstellen und danach widerrufen.

## Der Link, der im Chat anklickbar ist

- **Session-intern** (bevorzugt, weil Zurück in die Session führt):
  `https://<hub>/#/sessions/<sessionId>/anhang/<id>`
- **Geräteunabhängig** (funktioniert auch ohne offene Session):
  `https://<hub>/#/anhang/<id>`

Als **nackte URL in einer eigenen Zeile** senden — nur dann verlinkt der Chat-Renderer
(keine Backticks, kein Auslassungspunkt, vollständiges `https://`). Am Hub läuft die
Tailnet-URL, nicht `127.0.0.1`; das Handy kommt an Loopback nicht vorbei.

Der Token steht **niemals** in der URL: das Gerät holt die Bytes mit seinem eigenen
Token (`GET /api/attachments/<id>/content`). Ein weitergeleiteter Link ist deshalb nur
für Geräte mit Zugang lesbar — das ist Absicht.

## Was die Oberfläche damit tut

- **Einfügen** (Strg+V am PC, Langtippen → Einsetzen am Handy) und **Ablegen** im
  Eingabefeld hängen das Bild an die Nachricht; der Hub liest es, der Chip zeigt den
  Lesezustand. Reiner Text im Clipboard bleibt Text.
- In der Chat-Zeile erscheint ein **Vorschaubild** mit ⤢-Ecke und Dateiname. Ein Tipp
  öffnet das **Vollbild**: Name, Größe, „herunterladen“, Schließen durch ✕, Tipp neben
  das Bild oder Esc. Der Link aus einer Agent-Nachricht öffnet dieselbe Ansicht.
- Dokumente bleiben Chips und öffnen die Text-Ansicht (wie bisher, T7.10).

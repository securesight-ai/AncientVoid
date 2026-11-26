# Token-Tempo der Inferenz

**Art:** how-to

Öffne **Statistik → Inferenz** oder `#/statistik/inferenz`. Alte Links auf
`#/inferenz` leiten dorthin weiter. Die Seite zeigt pro Quelle Decode,
Vorbehandlung (Prefill), Zeit bis zum ersten Token und KV-Wiederverwendung,
soweit die Engine diese Werte liefert. Die Quellenwahl und das Zeitfenster
bestimmen die angezeigten Verteilungen.

## Engine einrichten

Unter `inference.engines` in `hub.config.json` den vollständigen Metrik-Endpunkt
eintragen. Danach den Hub neu starten.

```json
{
  "inference": {
    "engines": [
      {
        "id": "strata-local",
        "kind": "strata",
        "label": "Strata lokal",
        "url": "http://127.0.0.1:8080/metrics",
        "apiKeyFile": "~/.local/share/ancientvoid/strata.key"
      }
    ]
  }
}
```

Für einen Endpunkt ohne Bearer-Authentifizierung `apiKeyFile` weglassen.
Bei mehreren Engines eine stabile, eindeutige `id` je Quelle setzen, damit
die gespeicherte Historie nach Umsortieren der Konfiguration zugeordnet bleibt.
`intervalSec` ist standardmäßig 2, `windowHours` 72 und `minReadPrefill` 4000.
Die Schwelle filtert kleine Prefill-Proben nach frisch gelesenen Token.

| Engine | Werte und Grenzen |
|---|---|
| Strata (`strata`) | JSON von `/metrics`, mit Einzel-Requests und Perzentilen. TTFT erscheint, wenn Strata sie meldet. |
| Halogen (`halogen`) | Prometheus-Zähler und optionale JSON-Daten von `/health` und `/cache`. Raten entstehen aus Zählerdifferenzen, Einzel-Request-Verteilungen fehlen. |
| llama.cpp (`llamacpp`) | Prometheus-Zähler von `/metrics` bei aktiviertem `--metrics`. Raten entstehen aus Zählerdifferenzen, Einzel-Request-Verteilungen fehlen. |

Für eine Rate aus Zählern braucht der Tracker mindestens zwei erfolgreiche
Abrufe und ausreichend Arbeit im Messfenster. Bei einer nicht erreichbaren
Quelle zeigt der Reiter den Fehler. Bei leerer Liste `inference.engines`
prüfen, bei HTTP 401 zusätzlich den Pfad und die Leserechte der Schlüsseldatei.
Die Einstellungen für P59-Servermetriken und die manuelle Modellanbindung
speisen diese Liste nicht.

Die Request-Historie liegt als `inference-requests.jsonl` im Hub-Datenverzeichnis.
Beim Start lädt der Tracker das aktive Fenster. Die Alters- und Mengengrenzen
gelten für den Arbeitsspeicher. Die JSONL-Datei wird fortgeschrieben und derzeit
nicht automatisch rotiert.

[Architekturentscheidung ADR-0125](adr/0125-inferenz-token-tempo.md) ·
[Konfigurationsreferenz](referenz-config.md)

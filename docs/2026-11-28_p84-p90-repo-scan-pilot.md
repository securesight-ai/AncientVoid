# P84 — Pilotserie p90-qwen-pilot-b (2026-11-28)

**Art:** bericht · Messlatte: K8-Klasse (kein Lauf geht still verloren), K9 (Fehler sichtbar), K7 (aus Journalen rekonstruierbar) · EPIC-P84

## Pflichtangaben

- Prüfstand: P90 Pilot, isolierter Hub; ein historischer P84-Fall, Qwen per Pi über den vorhandenen Loopback-Tunnel; P81 liest am Benchmark-Hub. Zweiter Pilot mit acht Minuten für den Bau-Zug.
- Datum: 2026-11-28 · erster Lauf 2026-11-28T13:39:33.763Z, letzter Lauf 2026-11-28T14:31:29.285Z
- Messwerkzeug: npm run messlauf:eval @ 9ade0bf1 · omarchy / linux / Node v26.13.1
- Korpus SHA-256: 3ab8c00745eb6be25c9a67f2ae613d414238b67ea0021a6502cdeef38edf1270
- Protokoll SHA-256: 2d39424b1364c779cb8efeaee5aba44a8e7a624180d76620abdb4be86f858f0b
- Läufe: 10 erfasst von 10 geplant · Wiederholungen je Zelle: 5
- Gültigkeit: gültig

## Zellen (Modell, Version, Abrechnung)

| Zelle | Harness | CLI-Version | Modell | Fingerprint | Provider | Abrechnung |
| --- | --- | --- | --- | --- | --- | --- |
| pi-halogen | pi | 1.6.1 | evo-evox2/halogen-qwen3.8-flash-next-uncensored-iq4xs | halogen-qwen3.8-flash-next-uncensored-iq4xs@iq4xs ctx216064 evox2 | local | P81 evox2 2026-11-26: 0.3609 USD/kWh |

## Rohwerte

Jede Zelle: Median; Mittelwert; Minimum–Maximum über n Läufe. Einheiten stehen im Spaltenkopf. `n/a` gibt es nicht: nicht erfasste Läufe fehlen in n.

| Arm | Aufgabe | n | Fehlerquote [Anteil 0–1] (Median; Mittel; Min–Max) | Wandzeit [ms] (Median; Mittel; Min–Max) | Input-Tokens [Tokens] (Median; Mittel; Min–Max) | davon Cache-Tokens [Tokens] (Median; Mittel; Min–Max) | Output-Tokens [Tokens] (Median; Mittel; Min–Max) | Kosten gesamt [USD] (Median; Mittel; Min–Max) | Cloud [USD] (Median; Mittel; Min–Max) | davon Cache [USD] (Median; Mittel; Min–Max) | Energie (P81) [USD] (Median; Mittel; Min–Max) | Energie (P81) [kWh] (Median; Mittel; Min–Max) | Werkzeugfehler [Anzahl] (Median; Mittel; Min–Max) | Züge [Anzahl] (Median; Mittel; Min–Max) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate | millions-format | 5 | 0.00; 0.00; 0.00–0.00 | 215859; 228128; 126766–347796 | 165930; 169146; 102888–240816 | 143830; 149808; 89414–218528 | 5655; 5930; 3287–9310 | 0.00184; 0.00194; 0.00108–0.00296 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00184; 0.00194; 0.00108–0.00296 | 0.005093; 0.005382; 0.002994–0.008190 | 1.0; 1.2; 1.0–2.0 | 1.0; 1.0; 1.0–1.0 |
| candidate | gesamt | 5 | 0.00; 0.00; 0.00–0.00 | 215859; 228128; 126766–347796 | 165930; 169146; 102888–240816 | 143830; 149808; 89414–218528 | 5655; 5930; 3287–9310 | 0.00184; 0.00194; 0.00108–0.00296 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00184; 0.00194; 0.00108–0.00296 | 0.005093; 0.005382; 0.002994–0.008190 | 1.0; 1.2; 1.0–2.0 | 1.0; 1.0; 1.0–1.0 |
| reference | millions-format | 5 | 0.00; 0.20; 0.00–1.00 | 245758; 268321; 188311–352815 | 171720; 182578; 115010–258011 | 147204; 161948; 98941–236115 | 6091; 6955; 4855–9405 | 0.00209; 0.00228; 0.00161–0.00301 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00209; 0.00228; 0.00161–0.00301 | 0.005797; 0.006328; 0.004448–0.008328 | 1.0; 1.0; 1.0–1.0 | 1.0; 1.0; 1.0–1.0 |
| reference | gesamt | 5 | 0.00; 0.20; 0.00–1.00 | 245758; 268321; 188311–352815 | 171720; 182578; 115010–258011 | 147204; 161948; 98941–236115 | 6091; 6955; 4855–9405 | 0.00209; 0.00228; 0.00161–0.00301 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00000; 0.00000; 0.00000–0.00000 | 0.00209; 0.00228; 0.00161–0.00301 | 0.005797; 0.006328; 0.004448–0.008328 | 1.0; 1.0; 1.0–1.0 | 1.0; 1.0; 1.0–1.0 |

## Repo-Vergleich

- Geänderte Quelle: context · repoFacts
- Referenz: 6fcf443427902c564d474200f25c429e4ea4ac4c57fcd5847ad4f38987b806a9 · Kandidat: 9bb618dea11e636459a800be66732ce714381b0db2059c388547a9652fea30bb
- Mindestverbesserung: 20 Prozentpunkte Qualität oder Prozent Zeitersparnis
- Scan als Standard: aus

| Aufgabe | Paare | Befund | Grund |
| --- | --- | --- | --- |
| millions-format | 5 | improved | measured |

### Maschinenlesbar (CSV, Trennzeichen `,`, Zellen als `Median;Mittel;Min–Max`)

```csv
"Arm","Aufgabe","n","Fehlerquote [Anteil 0–1] (Median; Mittel; Min–Max)","Wandzeit [ms] (Median; Mittel; Min–Max)","Input-Tokens [Tokens] (Median; Mittel; Min–Max)","davon Cache-Tokens [Tokens] (Median; Mittel; Min–Max)","Output-Tokens [Tokens] (Median; Mittel; Min–Max)","Kosten gesamt [USD] (Median; Mittel; Min–Max)","Cloud [USD] (Median; Mittel; Min–Max)","davon Cache [USD] (Median; Mittel; Min–Max)","Energie (P81) [USD] (Median; Mittel; Min–Max)","Energie (P81) [kWh] (Median; Mittel; Min–Max)","Werkzeugfehler [Anzahl] (Median; Mittel; Min–Max)","Züge [Anzahl] (Median; Mittel; Min–Max)"
"candidate","millions-format","5","0.00; 0.00; 0.00–0.00","215859; 228128; 126766–347796","165930; 169146; 102888–240816","143830; 149808; 89414–218528","5655; 5930; 3287–9310","0.00184; 0.00194; 0.00108–0.00296","0.00000; 0.00000; 0.00000–0.00000","0.00000; 0.00000; 0.00000–0.00000","0.00184; 0.00194; 0.00108–0.00296","0.005093; 0.005382; 0.002994–0.008190","1.0; 1.2; 1.0–2.0","1.0; 1.0; 1.0–1.0"
"candidate","gesamt","5","0.00; 0.00; 0.00–0.00","215859; 228128; 126766–347796","165930; 169146; 102888–240816","143830; 149808; 89414–218528","5655; 5930; 3287–9310","0.00184; 0.00194; 0.00108–0.00296","0.00000; 0.00000; 0.00000–0.00000","0.00000; 0.00000; 0.00000–0.00000","0.00184; 0.00194; 0.00108–0.00296","0.005093; 0.005382; 0.002994–0.008190","1.0; 1.2; 1.0–2.0","1.0; 1.0; 1.0–1.0"
"reference","millions-format","5","0.00; 0.20; 0.00–1.00","245758; 268321; 188311–352815","171720; 182578; 115010–258011","147204; 161948; 98941–236115","6091; 6955; 4855–9405","0.00209; 0.00228; 0.00161–0.00301","0.00000; 0.00000; 0.00000–0.00000","0.00000; 0.00000; 0.00000–0.00000","0.00209; 0.00228; 0.00161–0.00301","0.005797; 0.006328; 0.004448–0.008328","1.0; 1.0; 1.0–1.0","1.0; 1.0; 1.0–1.0"
"reference","gesamt","5","0.00; 0.20; 0.00–1.00","245758; 268321; 188311–352815","171720; 182578; 115010–258011","147204; 161948; 98941–236115","6091; 6955; 4855–9405","0.00209; 0.00228; 0.00161–0.00301","0.00000; 0.00000; 0.00000–0.00000","0.00000; 0.00000; 0.00000–0.00000","0.00209; 0.00228; 0.00161–0.00301","0.005797; 0.006328; 0.004448–0.008328","1.0; 1.0; 1.0–1.0","1.0; 1.0; 1.0–1.0"
```

## Was das nicht sagt

- Eine Pilotserie ist keine Rangfolge. Ohne Vollkorpus, n ≥ 3 und eine unabhängige Wiederholungsserie trägt sie keine Aussage über „besser“.
- Cloud-Kosten sind Listenpreisäquivalente zum eingefrorenen Preisdatum; Abo-Zugänge (z. B. Coding-Plan, Cursor) kosten real anders.
- Adapter ohne getrennte Cache-Meldung rechnen den Cache zum Eingabepreis (obere Schranke).
- Lokale Energie umfasst die P81-Komponenten des Messhosts inklusive Grundlast; fehlende Komponenten sind im Prüfstand zu nennen.

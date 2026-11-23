# K2-Messlauf — Bildzeit der Repo-Galaxie mit 4.000 Dateien

Gemessen am 23.11.2026 auf Arch Linux, AMD Ryzen 7 5800X (16 Threads), mit
Node 26.12.0 und Playwright Chromium Headless 159.0.8154.6. Produktstand
`2a7eab27` mit lokalem Doku- und Test-Diff. Kein Modell beteiligt. Die
PWA lief gezielt gegen einen isolierten Fixture-Hub. Die Maschine wurde
für Fremdlast nicht gesperrt.

```bash
npx --no-install playwright test --config playwright.bench.config.ts
```

Die [Messroutine](../../e2e/benchmarks/p52-graph.spec.ts) erzeugt 4.000
TypeScript-Dateien in 20 Gruppen mit einem Nachbarimport je Datei und
einem gruppenübergreifenden Import für jede zweite Datei. Der Test
prüft die Knotenzahl im HTTP-Graphen und misst die Callback-Dauer aller
Frames, die den Graph-Canvas zeichnen. Das entspricht dem synchronen
Zeichenbudget von `GraphPane`. Der Abstand aufeinanderfolgender
Animationsframes wird getrennt protokolliert. Viewport 1440 × 900,
Bewegungen aus 24 Radschritten und sechs Drag-Paaren pro Runde.

| Runde | Leerlauf (n) | Zeichenzeit p95 / max (ms) | Zoom/Pan (n) | Zeichenzeit p95 / max (ms) | Frameabstand p95 Leerlauf / Zoom-Pan (ms) |
|---|---:|---:|---:|---:|---:|
| 1 | 120 | 1,0 / 1,4 | 165 | 3,7 / 4,7 | 16,8 / 16,7 |
| 2 | 120 | 1,0 / 1,2 | 179 | 3,6 / 4,8 | 16,8 / 16,8 |
| 3 | 120 | 0,9 / 1,1 | 182 | 3,1 / 5,2 | 16,7 / 16,8 |

Die Zeichenzeit blieb in allen Runden unter den Grenzen aus AC-P52-6
(≤ 16 ms p95 im Leerlauf und ≤ 33 ms p95 bei Interaktion).
Die Streuung der p95-Werte betrug 0,9–1,0 ms im Leerlauf und 3,1–3,7 ms
bei Zoom/Pan. Der etwa 16,7 ms lange Frameabstand entspricht ungefähr
einem 60-Hz-Takt. Der [Layout-Messlauf](2026-11-13-p52-galaxie-k2.md)
belegt separat die Layout-Dauer.

## Wiederholung mit der eigenständigen Desktop-Konfiguration

Drei weitere Runden ergaben 1,2 / 1,1 / 1,1 ms Zeichenzeit-p95 im
Leerlauf und 4,0 / 3,5 / 8,3 ms bei Zoom/Pan. Das jeweilige Maximum
beim Zeichnen war 6,0 / 4,5 / 17,3 ms. Beim Zoom/Pan stiegen die
Frameabstände in der dritten Runde auf 66,7 ms p95 (vorher 16,7 ms
in beiden Runden). Die Ursache ist unbelegt. Die Zeichenzeit besteht
ihre Prüfung. Der Grenzwert für tatsächliche Frameabstände ist unter
dieser Wiederholung nicht durchgängig belegt.

## Was das nicht sagt

Die Callback-Dauer misst keinen GPU-Present und keine Eingabelatenz auf
einem physischen Gerät. Das synthetische Repo hat eine definierte
Topologie. Andere Graphen, Pixeldichten und Geräte können andere Werte
liefern. Die Handy-Abnahme liegt in P000 T000.21.

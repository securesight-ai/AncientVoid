# P84 — Korpus-Erweiterung um vier Aufgabenarten (2026-11-27)

**Art:** bericht · Messlatte: AC-P84-1 (Start rot, Referenz grün je Aufgabe) · EPIC-P84 T84.12

Vier weitere Aufgabenarten nach Nutzerauftrag (vollständige Daten, mehr
Aufgabenarten): **Fehlersuche nur aus dem Symptom**, **Adapter-Aufgabe**,
**UI-Abnahme** und **Verständnisfrage mit deterministischer Prüfung**. Der
Korpus wächst damit auf 20 Aufgaben (Schema-Maximum); neuer Korpus-Hash
`9362ea1efccec91178c42467e2fdd3e6b9b250b42ce88f76a60fc85ba4c72737`.
Serien auf dem alten Stand werden nicht mit dem neuen gerechnet (Regel seit
pilot-6: Korpus-Stände mischen nie).

## Die Aufgaben

| ID | Art | Klasse | Start → Referenz | Abnahme |
|---|---|---|---|---|
| `steer-lag-symptom` | Fehlersuche nur aus dem Symptom (BUG-0286) | klein | `fd45610a` → `09e973f8` | `steer-wait-timeout.test.ts`, Selektor `BUG-0286` |
| `pi-env-files` | Adapter-Aufgabe (pi: env/envFiles) | klein | `26f9af83` → `bdb4ee36` | `pi/test/adapter.test.ts`, Selektor `erreicht das Listing\|Config-Env` |
| `neu-modal` | UI-Abnahme (BUG-0291, Modal statt Kachel) | schwer | `8fc4f7f8` → `d18d6ad0` | `tiles.test.ts`, Selektor `Neu-Kacheln` |
| `k7-verstaendnis` | Verständnisfrage, deterministisch geprüft | — | `08007492` → `55e07be2` | `eval-verstaendnis.test.ts`, Selektor `nennt Funktion samt Datei` |

Eigenschaften je Art:

- **Fehlersuche nur aus dem Symptom:** Der Aufgabentext nennt nur das
  beobachtete Fehlverhalten (vorgemerkte Eingabe rutscht bei langsamem
  Journal in den laufenden Zug) — kein Ort, kein Dateiname. Die Referenz
  führt keinen neuen Namen ein; die Suche ist die Aufgabe.
- **Adapter-Aufgabe:** Erweiterung des pi-Adapters um env/envFiles
  (Credential-Durchreichung wie ACP). Der Agent arbeitet nur in
  `packages/adapters/pi/src/index.ts`.
- **UI-Abnahme:** Sichtbares Verhalten (Neue-Session als Modal über dem
  Raster, gespeicherte Neu-Kacheln fallen beim Laden weg) mit
  deterministischer Workspace-Prüfung; die zugehörigen e2e-Specs des
  Original-Fixes laufen bewusst nicht in der Abnahme (kein Browser im
  Prüfer), die Kachel-Regel ist der Vertrag.
- **Verständnisfrage:** Kein Code — der Agent liest den Start-Stand und
  beantwortet in genau einer Datei (`apps/hub/test/eval-verstaendnis-antwort.txt`)
  Funktion samt Datei und Abnahme-Ereignis; der eingefrorene Test vergleicht
  die Antwort. Musterantwort und Prüfer sind als Fixture-Commit `55e07be2`
  im Referenzstand (im Normalbetrieb grün, im Benchmark schreibt der Agent
  die Datei).

## Beleg: Start rot, Referenz grün

`node scripts/eval/verify-corpus.mjs --offline steer-lag-symptom pi-env-files neu-modal k7-verstaendnis`:

```text
P84 corpus 9362ea1efccec91178c42467e2fdd3e6b9b250b42ce88f76a60fc85ba4c72737
steer-lag-symptom: 1 failing at start → 1 passing at reference
pi-env-files: 2 failing at start → 3 passing at reference
neu-modal: 2 failing at start → 2 passing at reference
k7-verstaendnis: 1 failing at start → 1 passing at reference
```

(`pi-env-files`: der dritte Fall — Modelle ohne Env bleiben ehrlich leer —
besteht am Start schon; Rot sind die Env-Durchreichung und das Listing.)

## Einordnung

- `steer-lag-symptom` und `pi-env-files` sind klein (≤ 50 Quellzeilen,
  ≤ 2 Dateien), `neu-modal` schwer (109 Quellzeilen, 8 Dateien). Die
  Verständnisfrage hat wie die Negativkontrolle keine Klasse.
- Alle vier nutzen Testfälle, deren Importe am Start-Stand bereits auflösen
  (Suite-Ladefehler wären „kein gültiges Urteil", keine rote Abnahme) —
  deshalb fällt z. B. die FAB-Tastatur-Aufgabe (Import eines neuen Symbols)
  als Kandidat weg.
- `contaminationRisk: true` wie der Rest des Korpus (öffentliche Historie).
- Abnahme des 25.11.: [Korpus-Abnahme](2026-11-25-p84-korpus.md) — dort
  stehen Befund Sieben-unlösbar-Aufgaben und die drei schweren Aufgaben.

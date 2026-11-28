# Einstellungen: was es gibt, was sinnvoll wäre

**Art:** erklaerung

**Stand:** 2026-11-27 · gehört zu [EPIC-P20](../epics/EPIC-P20-oberflaeche-feinschliff.md) T20.4,
ergänzt um Bewegung/Tiefe ([EPIC-P86](../epics/EPIC-P86-3d-tiefe-fensterflug-lebendigkeit.md) T86.6).
Das hier ist eine **Empfehlungsliste**. Umgesetzt ist nur, was in der Spalte „Stand“ steht.

## Heute vorhanden

Die Einstellungen enthalten unter anderem diese Karten:

| Karte | Inhalt | Quelle |
|---|---|---|
| Allgemein | Erscheinungsbild (Hell/Dunkel), Pinch-Zoom, „Erreichbar über“, Geräte-Token (nur Anzeige), Projekt-Wurzeln (Zähler), Passkey, Token wechseln | `features/settings/Settings.tsx` |
| Flotte | Hosts hinzufügen/entfernen, Einladungscode | `features/fleet/` |
| Benachrichtigungen | Push an/aus und welche Ereignisse | `features/settings/PushSettings.tsx` |
| Gemini | Schlüssel (nur schreibbar), lokale Auslese | `features/settings/GeminiSettings.tsx` |
| Prompt-Verbesserer (P90) | Automatik, bevorzugter Adapter, Pi-Modell, Repo-Scan und optionale Wissensquelle | `features/settings/PromptEnhancerSettings.tsx` |

Mit EPIC-P20 kommt in „Allgemein“ dazu: **Zoom der Oberfläche** (70–200 %, Strg + Mausrad,
Strg + `+`/`−`/`0`) und **Schimmer der Kontextleiste** (an/aus, folgt „Bewegung reduzieren“).

## Bewegung und Tiefe: zwei Schalter, eine Kaskade (EPIC-P43, EPIC-P86)

In **Darstellung** liegen zwei Schalter, die steuern, wie viel sich bewegt —
in dieser Reihenfolge:

1. **„Bewegung reduzieren“ des Systems/Browsers** schlägt alles: kein Flug,
   kein Puls, nichts bewegt sich (statische Zustände wie die Unschärfe
   hinter offenen Fenstern bleiben — sie sind kein Bewegungsreiz).
2. **„Bewegung“** — Atmen, Schimmer, Ruf und Übergänge; aus schaltet auch
   die 3D-Ebene ab.
3. **„3D-Tiefe“** (auch am PC in der Sidebar und am Handy im „Mehr“-Blatt):
   Fenster öffnen sich aus der Tiefe, der Hintergrund weicht zurück (kleiner,
   unscharf, dunkler), offene Fenster schweben davor, die fokussierte Kachel
   glüht im Zustands-Puls. Einschalten pulst offene Flächen kurz als
   sofortiges Feedback; Ausschalten bewegt bewusst nichts.

Beide liegen pro Gerät im `localStorage` (`ancientvoid.ctxMotion`,
`ancientvoid.depth3d`) — an ist der Default, gesetzt wird nur das explizite
„0“ (Muster `app/ui-scale.ts`, Logik `app/depth3d.ts`, Ebenen in
`app/styles/61-depth3d.css`).

## Empfehlungen

Priorität: **A** = klarer Nutzen, klein · **B** = nützlich, mittel · **C** = später.
Jede Einstellung ist pro Gerät (`localStorage`), außer sie ändert den Hub (dann Server-Konfiguration).

### Darstellung

| Einstellung | Warum | Prio |
|---|---|---|
| Erscheinungsbild „System“ (zusätzlich zu Hell/Dunkel) | Handy und PC wechseln den Modus von selbst. Heute nur zwei Zustände, die der Nutzer pflegen muss. | A |
| Dichte (kompakt / normal) | Auf dem 2560-px-Bildschirm mit vier Kacheln zählt jede Zeile. Ersatz für „viele kleine Zoom-Schritte“. | B |
| Zeitformat (Uhrzeit / relativ „vor 3 min“) | Der Verlauf zeigt nur Uhrzeiten, bei langen Läufen ist „vor …“ lesbarer. | C |
| Chat-Schrift (Mono / Proportional) | Lange Antworten sind in Proportionalschrift leichter lesbar. Code bleibt Mono. | C |

### Verlauf und Chat

| Einstellung | Warum | Prio |
|---|---|---|
| Standardfilter (Überwachen / Debuggen / Lesen) | Steht heute in `localStorage` (`ancientvoid.filter`), aber nur über die Tabs änderbar. | A |
| Thinking und Tool-Ausgaben standardmäßig eingeklappt | Bei pi/claude sind Verläufe mit Dutzenden Tool-Aufrufen sonst lang. Seit BUG-0065 zeigt pi sie vollständig. | A |
| Markdown-Darstellung an/aus („Rohtext“) | Wer Antworten kopieren und prüfen will, braucht den Rohtext. Seit BUG-0067 wird gerendert. | B |
| Anzahl gehaltener Zeilen (Standard 500, Hintergrund-Kachel 150) | Speicher und Rendering (K2) bei vier Kacheln. | C |

### Desktop

| Einstellung | Warum | Prio |
|---|---|---|
| Standard-Layout der Kacheln (1, 2, 1+2, 2×2) und Start mit eingeklappter Liste | Heute merkt sich der Browser nur den letzten Zustand. | B |
| Diff-Ansicht (nebeneinander / untereinander), Zeilenumbruch | Ab 1280 px nebeneinander, bei langen Zeilen ist Umbruch besser. | A |
| Tastenkürzel an/aus | Alt+1–4, Alt+L, Strg+`+`/`−` können mit Fenstermanager-Kürzeln kollidieren (Omarchy/Hyprland). | B |

### Benachrichtigungen

| Einstellung | Warum | Prio |
|---|---|---|
| Ruhezeiten (z. B. 22–7 Uhr nur Freigaben) | Push ist heute an/aus je Ereignisart. Nachts stören „fertig“-Meldungen. | B |
| Ton/Vibration getrennt | Am PC Ton, am Handy Vibration. | C |

### Sicherheit

| Einstellung | Warum | Prio |
|---|---|---|
| Geräte-Token: Label und Ablaufdatum anzeigen | Heute nur „•••• aktiv“. Man sieht nicht, welches Gerät welches Token hat. | A |
| Passkey auch für „Loop starten“ bzw. Betriebsartwechsel (nach ADR-0038) | Außenwirkung (Merge, Commit) soll eine bewusste Handlung sein. | B |
| Automatische Sperre nach Inaktivität (Token-Seite) | Handy liegt offen herum. | C |

### System und Hilfe

| Einstellung | Warum | Prio |
|---|---|---|
| Hub-Info: Version/Commit, Host-ID, Laufzeit, Adapter | `GET /api/health` liefert es schon. So sieht man nach dem Ausrollen sofort, ob der Hub aktuell ist. | A |
| Verbindungstest und „Cache leeren / neu laden“ (Service Worker) | Nach einem Update zeigt die PWA gelegentlich den alten Stand. | A |
| Export/Import der Geräte-Einstellungen | Neues Gerät in einer Minute eingerichtet. | C |

### Nicht empfohlen

- Eigene Farbthemen: das Design-System (`docs/design-system.md`) ist bewusst eng, mehr Varianten kosten Pflege ohne Nutzen.
- Einstellungen, die Server-Verhalten ändern (Kontextgröße je Modell, Standardmodell): gehören in `hub.config.json`
  (ADR-0032), nicht in die Oberfläche, weil sie für alle Geräte gelten.

## Reihenfolge für eine spätere Umsetzung

1. A-Punkte „Hub-Info“, „Cache leeren“, „Erscheinungsbild System“, „Standardfilter“ (zusammen ca. ein Tag, alles in
   `features/settings/`).
2. Diff-Ansicht (hängt an T20.1).
3. B-Punkte nach Bedarf. Jeder braucht einen Spec in `e2e/specs/` und die Mobile-Prüfung (AC-P8-5).

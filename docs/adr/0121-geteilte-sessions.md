# ADR-0121 — Geteilte Sessions: mehrere Menschen verfolgen und steuern dieselbe Session

**Status:** angenommen (Nutzerentscheid E3, 24.11.2026) · **Betrifft:** EPIC-P83, künftig `packages/contracts/src/team/`,
`packages/core/src/modules/team/`, `packages/core/src/modules/sessions/` · **Bezug:** ADR-0021,
ADR-0077, ADR-0083, ADR-0085, ADR-0118, ADR-0119, ADR-0122, ADR-0123, PRD §8

## Kontext

Der erste Entwurf schloss jede Fernsteuerung aus. Nutzerentscheid: mehrere Menschen sollen eine
Session gemeinsam verfolgen **und steuern**. Das ist die riskanteste Fähigkeit des Epics, weil eine
Eingabe auf dem Rechner des Gastgebers Wirkung hat. Deshalb setzt sie die Sandbox voraus.

## Entscheidung

1. **Begriff.** Innerhalb eines Teams (ADR-0123) wird eine einzelne Session geteilt; im Code
   `SessionShare`.
2. **Personen.** Eine Instanz kann mehrere Personen führen: `Person { personId, name }`, Device-Labels
   werden zugeordnet. Das dient der Urheberschaft; alle eigenen Geräte behalten in v1 dieselben Rechte.
   Gegenüber anderen ist bewiesen nur die Instanz, Person und Gerät sind deren Angabe.
3. **Freigabe je Session.** Standard privat. Der Gastgeber teilt genau eine Session mit genau einer
   Person: Stufe `observe` oder `steer`, Ablauf (Standard 8 h, höchstens 7 Tage), Verlauf „ab jetzt“
   (Standard) oder vollständig. `steer` braucht Passkey oder `hubctl`. Keine Weitergabe, kein „alle“.
4. **Rechte.**

   | Handlung | observe | steer | Gastgeber |
   |---|---|---|---|
   | Verlauf, Live-Text, Zustand | ja | ja | ja |
   | Nachricht an die Session, eigene Vormerkung ändern | nein | ja | ja |
   | Zug unterbrechen, Not-Stopp | nein | ja | ja |
   | Rückfrage des Agenten beantworten | nein | ja | ja |
   | Werkzeug-/Schreib-/Passkey-Freigabe | nein | **nein** | ja |
   | Modell, Modus, Budget, Anhänge, Apply, Terminal, Dateien, andere Sessions | nein | nein | ja |

5. **Nur Menschen steuern.** Befehle mit `actor.kind: agent` werden für `steer` abgelehnt. Eine
   kompromittierte Instanz kann dennoch als ihr Mensch auftreten (TM20).
6. **Ausführungsgrenze.** `steer` gibt es nur für Sessions, die von Beginn an in der Sandbox laufen
   (ADR-0122); sonst ist nur `observe` möglich. Freigaben zeigen den Absender.
7. **Mehrere Eingaben.** Der Gastgeber-Hub ordnet in der bestehenden Warteschlange (ADR-0085) mit
   `actor` je Eintrag. Kein Sperrrecht: Wer schreibt, ist sichtbar. Unterbrechen und Stopp gelten
   sofort, vom Gastgeber immer. Rückfragen: erste gültige Antwort gilt, die zweite erhält `conflict`.
8. **Übertragung.** Gespeicherte Ereignisse seitenweise über den Link, Live-Text als flüchtige Frames
   (ADR-0083), Drop-on-slow und Resync wie `sessions/ws.ts`. Beim Zuschauer nur ein begrenzter Cache
   mit Zeit, keine zweite Wahrheit (K7). Blobs erst auf Antippen und nur, wenn im Ereignis genannt.
9. **Offenlegung.** Der Dialog sagt: Werkzeugausgaben können Geheimnisse enthalten. Bekannte Muster
   werden vor dem Senden geschwärzt; das ist keine Garantie. Ist dauerhaft sichtbar: „Ben sieht mit“.
10. **Ende.** Ablauf, Rücknahme, Widerruf oder Ende der Session: ≤ 1 s kein Zugriff, nicht ausgeführte
    Vormerkungen dieser Person entfallen, der laufende Zug wird bei Widerruf geparkt (E6).

## Verworfen

`fleet:`-Token für Partner (für eigene Geräte), Terminal-Teilen (freie Shell, PRD §8.3), Steuern ohne
Freigabe je Session, Fern-Freigabe von Werkzeugen.

## Konsequenzen

- ADR-0119 „kein Befehl für Session/Prompt“ gilt nur noch außerhalb geteilter Sessions.
- Neue Policy `team.share` (human allow, sonst deny). Neuer Befehlstyp mit sechs festen Arten.
- K1 (Not-Stopp), K2 (Zuschauer-Tail), K5, K8 (Last durch Zuschauer), K10.

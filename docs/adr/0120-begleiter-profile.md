# ADR-0120 — Begleiter-Profile: Nyx anpassbar und über Instanzen hinweg eindeutig

**Status:** angenommen (Nutzerentscheid E7 vom 24.11.2026) · **Betrifft:** EPIC-P83, künftig
`packages/contracts/src/companions/`, `apps/pwa/src/features/nyx/` · **Bezug:** EPIC-P43 T43.8,
ADR-0097, ADR-0118, ADR-0119

Der bestehende Desktop-Companion (ADR-0031, `companion:`) ist etwas anderes; im Code heißt dieses
Profil deshalb `CompanionProfile` nur im Modul `companions/`, in der Oberfläche „Begleiter“.

## Entscheidung

1. **Profil:** `{ v, profileId, name, form, palette, accessory, emblem, phraseSet, motion, rev }`.
   Alles außer `name` ist eine ID aus festen Listen. Name: NFC, 1–24 Grapheme, keine Steuer-, Bidi-
   oder unsichtbaren Zeichen, keine Markup-Auswertung.
2. **Formen v1:** Nyx (unverändert, Standard) sowie fünf eigene: Lumen, Moos, Kiesel, Falter, Anker.
   Acht Paletten, sechs Accessoires, acht Embleme. Form und Emblem unterscheiden ohne Farbe.
3. **Zuordnung:** ein Profil für den eigenen Hub, optional je Adapter und je Agenten-Rolle; Vorrang
   Rolle → Adapter → Hub. `agentId` ist stabil und unabhängig vom Profil: Umbenennen ändert keine
   Urheberschaft; der Verlauf zeigt den damaligen Namen mit heutigem Profil im Detail.
4. **Eindeutig:** immer „Name · Person“ plus Instanzabzeichen aus `instanceId`. Das Abzeichen
   vergibt die empfangende Seite; es ist nicht wählbar. Gleiche oder verwechselbare Namen werden
   markiert, nicht verboten.
5. **Sync:** `profile.updated` im Strom der Instanz, ≤ 1 KiB, höhere `rev` gewinnt. Kein Upload,
   kein SVG, keine URL, kein fremder Satz. Unbekannte ID → neutrale Form „Schemen“ mit Emblem.
   Stimme und Ton (ADR-0097) bleiben lokal.
6. **Sätze:** nur lokale Katalogtexte je Zustand (PRD §8.5), drei Satzfarben: sachlich, warm, knapp.
7. **Zustand:** die Reihenfolge aus `nyx-state.ts` bleibt. Aussehen ändert nie die Bedeutung.
8. **Technik:** eigener Atlas je Form, 64×64, Zustände wie Nyx; Grundbild plus Maskenstreifen,
   Palette über CSS-Maske und Token. Animiert wird nur `transform`. Höchstens 12 KiB je Form,
   Nachladen bei Bedarf, Herkunft und Prüfsumme in `docs/design-system.md`.
9. **Persistenz:** eigene Profile in der `config`-Tabelle (Muster ADR-0096), fremde im Team-Journal.

## Verworfen

Freie Bilder (XSS, Nachahmung, Speicher), generierte Figuren je Nutzer (nicht deterministisch),
Farbe als alleiniges Merkmal (WCAG 1.4.1).

## Konsequenzen

Neue Formen brauchen ein Update aller Instanzen, sonst erscheint „Schemen“. Die Assets entstehen als
eigene Werke im Repo, ohne Vorlage aus bestehenden Spielen.

/**
 * EPIC-P63 T63.7: Die Formular-Bausteine wohnen jetzt in `shared/ui/`
 * (Field, Select, Switch, Segmented). Dieser Re-Export bleibt eine Phase
 * lang bestehen, damit bestehende Imports nicht brechen — neue Ansichten
 * importieren aus `shared/ui/index.ts`.
 */
export { Select, Switch, Segmented } from "./ui/forms.tsx";

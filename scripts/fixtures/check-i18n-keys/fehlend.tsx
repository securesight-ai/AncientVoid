// Fixture: Schlüssel existiert nirgends → der Laufzeit-Fallback zeigt den rohen Key.
import { t } from "../../../apps/pwa/src/shared/i18n/index.ts";

export const titel = () => <span>{t("common.diesen.schluessel.gibt.es.nicht")}</span>;

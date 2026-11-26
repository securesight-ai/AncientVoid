// EPIC-P61 (ADR-0101): Katalog Deutsch — Quelle der Wahrheit für alle Keys
// (Snake-Case, bereichspräfigiert). Bereichs-Dateien in de/ werden hier
// aggregiert; en/<bereich>.ts ist gegen diesen Katalog typgeprüft (Lücken = tsc-Fehler).
import { de as dock } from "./de/dock.ts";
import { de as notifications } from "./de/notifications.ts";
import { de as common } from "./de/common.ts";
import { de as features } from "./de/features.ts";
import { de as inference } from "./de/inference.ts";
import { de as hosts } from "./de/hosts.ts";
import { de as pentest } from "./de/pentest.ts";

export const de = {
  ...dock,
  ...notifications,
  ...common,
  ...features,
  ...inference,
  ...hosts,
  ...pentest,

  "settings.language.title": "Sprache",
  "settings.language.hint": "Gerät-Einstellung; folgt dem System beim ersten Start. Ein Wechsel lädt neu — Entwürfe bleiben erhalten.",
  "settings.language.auto": "Automatisch",

  "error.adapter_not_allowed": "Loop-Adapter sind als Team-Worker nicht freigegeben.",
  "error.rate_limited.one": "Zu viele Anfragen — noch {n} Sekunde bis zum nächsten Versuch.",
  "error.rate_limited.other": "Zu viele Anfragen — noch {n} Sekunden bis zum nächsten Versuch.",
} as const;

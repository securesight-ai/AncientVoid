import { api } from "./api.ts";
import { t } from "./i18n/index.ts";

/**
 * EPIC-P80 (ADR-0118): `hubctl scan <target> [--profile quick|services|full]` —
 * derselbe Hub-Weg wie die PWA (D6): dieselbe Route, dieselbe Job-Semantik.
 * Antwort ist das, was der Hub liefert (Job oder Freigabe-Verweis); ein
 * Allowlisten-Abbruch erscheint als Fehler, nie still (Fail loud).
 */

interface ScanResponse {
  job?: Record<string, unknown>;
  approvalId?: string;
  summary?: string;
  ok?: boolean;
  detail?: string;
}

export async function scanCommand(args: string[]): Promise<void> {
  const rest = [...args];
  const pi = rest.indexOf("--profile");
  let profile = "quick";
  if (pi >= 0) {
    profile = rest[pi + 1] ?? "";
    if (!["quick", "services", "full"].includes(profile)) {
      console.log(t("scan_usage"));
      process.exit(1);
    }
    rest.splice(pi, 2);
  }
  const target = rest[0];
  if (!target) {
    console.log(t("scan_usage"));
    process.exit(1);
  }
  const res = await api<ScanResponse>("/api/pentest/scan", { method: "POST", body: JSON.stringify({ target, profile }) });
  console.log(JSON.stringify(res, null, 2));
}

import { t } from "../../shared/i18n/index.ts";
import { openWorkspaceContent } from "../workspace/open-content.ts";
import { useState } from "preact/hooks";
import { pageHash, vaultKnowledgeHash } from "../../app/route.ts";
import { KnowledgePanel } from "../knowledge/KnowledgePanel.tsx";
import { VaultPane } from "./VaultPane.tsx";

/**
 * EPIC-P74 T74.6: der Notizen-Bereich hat zwei Reiter — die eigenen Notizen
 * (P49) und das angebunde Wissen (Brain). Der Reiter steht in der URL
 * (`#/notizen/wissen`), damit Back und Deep-Link funktionieren (T8.1).
 */
export function VaultTabs({ initialFile = null, initialTab = "notizen" }: { initialFile?: string | null; initialTab?: "notizen" | "wissen" }) {
  const [tab, setTab] = useState<"notizen" | "wissen">(initialTab);
  const switchTo = (next: "notizen" | "wissen") => {
    if (openWorkspaceContent({ sessionId: "", content: { kind: "page", page: "vault", ...(next === "wissen" ? { vaultTab: "wissen" as const } : {}), hash: next === "wissen" ? vaultKnowledgeHash() : pageHash("vault") } })) return;
    setTab(next);
    location.hash = next === "wissen" ? vaultKnowledgeHash() : pageHash("vault");
  };
  return (
    <div class="vault-tabs">
      <nav class="vault-tabbar" role="tablist" aria-label={t("vault.notes_area")}>
        <button type="button" role="tab" class={`vault-tab${tab === "notizen" ? " active" : ""}`} aria-selected={tab === "notizen"} onClick={() => switchTo("notizen")}>
          {t("common.notes")}
        </button>
        <button type="button" role="tab" class={`vault-tab${tab === "wissen" ? " active" : ""}`} aria-selected={tab === "wissen"} onClick={() => switchTo("wissen")}>
          {t("vault.knowledge")}
        </button>
      </nav>
      {tab === "wissen" ? <KnowledgePanel /> : <VaultPane {...(initialFile ? { initialFile } : {})} />}
    </div>
  );
}

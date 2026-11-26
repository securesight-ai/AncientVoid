import { SidebarSettings } from "./SidebarSettings.tsx";
import { FleetSettings } from "../fleet/Fleet.tsx";
import { TeamPairingSettings } from "../team/TeamPairingSettings.tsx";
import { KnowledgeSettings } from "../knowledge/KnowledgeSettings.tsx";
import { PresetSettings } from "./PresetSettings.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { ConnectionsSettings } from "./ConnectionsSettings.tsx";
import { InferenceSettings } from "./InferenceSettings.tsx";
import { DevicesSettings } from "./DevicesSettings.tsx";
import { FontSettings } from "./FontSettings.tsx";
import { GeminiSettings } from "./GeminiSettings.tsx";
import { MainSyncSettings } from "./MainSyncSettings.tsx";
import { PreviewSettings } from "./PreviewSettings.tsx";
import { PushSettings } from "./PushSettings.tsx";
import { SecuritySettings } from "./SecuritySettings.tsx";
import { SoundSettings } from "./SoundSettings.tsx";
import { VoiceSettings } from "./VoiceSettings.tsx";

/**
 * Die Einstellungen als eine Seite — dieselbe am Handy (Listenseite) und am Desktop (Werkzeugfläche).
 * Zwei gleich breite Spalten, sobald der Platz reicht (Container-Abfrage, nicht Fenster-Abfrage:
 * in der Werkzeugfläche ist der Platz nicht die Fensterbreite). Die Reihenfolge der DOM-Knoten
 * ist zugleich die Reihenfolge am Handy.
 */
export function SettingsPage({ onSwitchToken }: { onSwitchToken: () => void }) {
  return (
    <div class="settings-page">
      <div class="settings-cols">
        <div class="settings-col">
          <AppearanceSettings />
          <SidebarSettings />
          <FontSettings />
          <PresetSettings />
          <PreviewSettings />
          <PushSettings />
          <SoundSettings />
          <VoiceSettings />
        </div>
        <div class="settings-col">
          <DevicesSettings />
          <FleetSettings />
          <TeamPairingSettings />
          <ConnectionsSettings />
          <KnowledgeSettings />
          <MainSyncSettings />
          <GeminiSettings />
          <InferenceSettings />
          <SecuritySettings onSwitchToken={onSwitchToken} />
        </div>
      </div>
    </div>
  );
}

import { t } from "../../shared/i18n/index.ts";
import { useState } from "preact/hooks";
import { applyPinchZoom, pinchZoomAllowed } from "../../app/zoom.ts";
import { InstallStatus } from "./InstallStatus.tsx";
import { PcInput } from "./PcInput.tsx";
import { SettingRow, SettingsSection, Switch } from "./parts.tsx";

/** Gruppe „Geräte“: was dieses Gerät und der PC daneben dürfen. */
export function DevicesSettings() {
  const [zoom, setZoom] = useState<boolean>(pinchZoomAllowed());
  return (
    <SettingsSection title={t("session.devices")}>
      <SettingRow label={t("settings.pinch_zoom")} hint="Feld-Zoom bleibt aus">
        <Switch
          label={t("settings.pinch_zoom")}
          checked={zoom}
          onChange={(next) => {
            applyPinchZoom(next);
            setZoom(next);
          }}
        />
      </SettingRow>
      <PcInput />
      <InstallStatus />
    </SettingsSection>
  );
}

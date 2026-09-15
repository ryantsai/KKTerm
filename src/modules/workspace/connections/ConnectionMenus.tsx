import { Download } from "../../../lib/reicon";
import { useTranslation } from "react-i18next";
import { ConnectionTypeGlyph } from "./ConnectionGlyph";
import type { ConnectionType } from "../../../types";
import { connectionCreationOptions } from "./connectionCreationOptions";

export function AddConnectionMenu({
  macAppStoreBuild,
  onImportRequested,
  onSelectType,
}: {
  macAppStoreBuild: boolean;
  onImportRequested: () => void;
  onSelectType: (connectionType: ConnectionType) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="add-connection-menu" role="menu" aria-label={t("connections.addConnection")}>
      {connectionCreationOptions(macAppStoreBuild).map((option) => (
        <button key={option.type} onClick={() => onSelectType(option.type)} role="menuitem" type="button">
          <ConnectionTypeGlyph className="menu-item-icon" size={15} type={option.type} />
          <span className="connection-main">
            <strong>{t(option.labelKey)}</strong>
          </span>
        </button>
      ))}
      <div className="add-connection-menu-separator" aria-hidden="true" />
      <button onClick={onImportRequested} role="menuitem" type="button">
        <Download className="menu-item-icon" size={15} />
        <span className="connection-main">
          <strong>{t("connections.import.tileTitle")}</strong>
        </span>
      </button>
    </div>
  );
}

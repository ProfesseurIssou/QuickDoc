// Settings page: panel side, language, and a keybinding editor.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import KeyCapture from "../components/KeyCapture";
import { DEFAULT_KEYBINDINGS, KeybindingMap, PanelSide } from "../lib/types";
import { getAllSettings, setSetting } from "../lib/db";
import { resetKeybindings, updateKeybinding } from "../lib/keybindings";
import { SUPPORTED_LOCALES } from "../i18n";

interface Props {
  onBack: () => void;
  onPanelSideChange: (side: PanelSide) => void;
  onLocaleChange: (locale: string) => void;
}

/** The action keys shown in the editor, in a stable order. */
const ACTION_ORDER = Object.keys(DEFAULT_KEYBINDINGS);

export default function Settings({
  onBack,
  onPanelSideChange,
  onLocaleChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const [panelSide, setPanelSide] = useState<PanelSide>("right");
  const [locale, setLocale] = useState(i18n.language ?? "en");
  const [bindings, setBindings] = useState<KeybindingMap>({ ...DEFAULT_KEYBINDINGS });

  useEffect(() => {
    void (async () => {
      const settings = await getAllSettings();
      const side = (settings.panel_side as PanelSide) ?? "right";
      setPanelSide(side);
      const loc = settings.locale ?? "en";
      setLocale(loc);
      try {
        setBindings({ ...DEFAULT_KEYBINDINGS, ...JSON.parse(settings.keybindings ?? "{}") });
      } catch {
        setBindings({ ...DEFAULT_KEYBINDINGS });
      }
    })();
  }, []);

  const changeSide = async (side: PanelSide) => {
    setPanelSide(side);
    await setSetting("panel_side", side);
    onPanelSideChange(side);
  };

  const changeLocale = async (loc: string) => {
    setLocale(loc);
    await setSetting("locale", loc);
    await i18n.changeLanguage(loc);
    onLocaleChange(loc);
  };

  const changeBinding = async (action: string, binding: string) => {
    const next = await updateKeybinding(action, binding);
    setBindings({ ...next });
  };

  const reset = async () => {
    const next = await resetKeybindings();
    setBindings({ ...next });
  };

  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="ghost" onClick={onBack}>
          ← {t("settings.back")}
        </button>
        <h2>{t("settings.title")}</h2>
      </div>

      <section className="settings-row">
        <label>{t("settings.panelSide")}</label>
        <select value={panelSide} onChange={(e) => void changeSide(e.target.value as PanelSide)}>
          <option value="left">{t("settings.left")}</option>
          <option value="right">{t("settings.right")}</option>
        </select>
      </section>

      <section className="settings-row">
        <label>{t("settings.language")}</label>
        <select value={locale} onChange={(e) => void changeLocale(e.target.value)}>
          {Object.entries(SUPPORTED_LOCALES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </section>

      <section className="settings-keybindings">
        <div className="row-between">
          <label>{t("settings.keybindings")}</label>
          <button type="button" className="ghost" onClick={() => void reset()}>
            {t("settings.reset")}
          </button>
        </div>
        <ul className="kb-list">
          {ACTION_ORDER.map((action) => (
            <li key={action} className="kb-item">
              <span>{t(`settings.actions.${action}`, action)}</span>
              <KeyCapture
                value={bindings[action] ?? ""}
                onChange={(b) => void changeBinding(action, b)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

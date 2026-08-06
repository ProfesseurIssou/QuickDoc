// i18n setup (react-i18next). English is the default; additional locale files
// live next to this file. Adding a language = drop a JSON file + an entry here.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const SUPPORTED_LOCALES = {
  en: "English",
  fr: "Français",
} as const;

export type LocaleCode = keyof typeof SUPPORTED_LOCALES;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

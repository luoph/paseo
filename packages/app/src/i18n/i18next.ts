import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { observeI18nInit } from "./init";
import { ensureLocaleResources } from "./locale-resources";
import { en } from "./resources/en";

const i18n = createInstance();

const ready = i18n.use(initReactI18next).init({
  compatibilityJSON: "v4",
  fallbackLng: "en",
  lng: "en",
  resources: {
    en: { translation: en },
  },
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

observeI18nInit(ready);

const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = (language, callback) => {
  const requested = typeof language === "string" ? language : "en";
  return ready
    .then(() => ensureLocaleResources(i18n, requested))
    .then(() => changeLanguage(language, callback));
};

export { i18n };

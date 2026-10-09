import type { TranslationResources } from "./resources/en";

interface LocaleResourceTarget {
  hasResourceBundle(language: string, namespace: string): boolean;
  addResourceBundle(
    language: string,
    namespace: string,
    resources: TranslationResources,
    deep?: boolean,
    overwrite?: boolean,
  ): void;
}

const pendingLocales = new Map<string, Promise<void>>();

function loadDeferredLocale(locale: string): Promise<TranslationResources | null> {
  switch (locale) {
    case "ar":
      return import("./resources/ar").then((module) => module.ar);
    case "es":
      return import("./resources/es").then((module) => module.es);
    case "fr":
      return import("./resources/fr").then((module) => module.fr);
    case "ja":
      return import("./resources/ja").then((module) => module.ja);
    case "ko":
      return import("./resources/ko").then((module) => module.ko);
    case "pt-BR":
      return import("./resources/pt-BR").then((module) => module.ptBR);
    case "ru":
      return import("./resources/ru").then((module) => module.ru);
    case "zh-CN":
      return import("./resources/zh-CN").then((module) => module.zhCN);
    default:
      return Promise.resolve(null);
  }
}

/**
 * English is registered at startup. Other locales stay out of the initial
 * module graph and are added before `changeLanguage` resolves, so existing
 * callers can `await i18n.changeLanguage("fr")` and then read that language.
 */
export function ensureLocaleResources(i18n: LocaleResourceTarget, locale: string): Promise<void> {
  if (locale === "en" || i18n.hasResourceBundle(locale, "translation")) {
    return Promise.resolve();
  }
  const pending = pendingLocales.get(locale);
  if (pending) {
    return pending;
  }
  const task = loadDeferredLocale(locale)
    .then((resources) => {
      if (resources) {
        i18n.addResourceBundle(locale, "translation", resources, true, true);
      }
      return undefined;
    })
    .finally(() => {
      pendingLocales.delete(locale);
    });
  pendingLocales.set(locale, task);
  return task;
}

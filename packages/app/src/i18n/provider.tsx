import * as Localization from "expo-localization";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { i18n } from "./i18next";
import { resolveSupportedLocale } from "./locales";
import { ensureI18nLanguageForRender, reportI18nError } from "./sync-language";

interface I18nProviderProps {
  children: ReactNode;
}

function getSystemLocales(): string[] {
  if (isWeb && typeof navigator !== "undefined" && navigator.languages.length > 0) {
    return [...navigator.languages];
  }

  return Localization.getLocales().map((locale) => locale.languageTag);
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { settings } = useAppSettings();
  const systemLocales = useMemo(() => getSystemLocales(), []);
  const locale = resolveSupportedLocale(settings.language, systemLocales);
  const [hasMountedChildren, setHasMountedChildren] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [, setLocaleRevision] = useState(0);
  const bundleReady = i18n.hasResourceBundle(locale, "translation");

  if (bundleReady) {
    ensureI18nLanguageForRender(locale, i18n);
  }

  useEffect(() => {
    if (i18n.hasResourceBundle(locale, "translation") && i18n.language === locale) {
      return;
    }
    let cancelled = false;
    void i18n.changeLanguage(locale).then(
      () => {
        if (!cancelled) {
          setLocaleRevision((revision) => revision + 1);
        }
        return undefined;
      },
      (error: unknown) => {
        reportI18nError("[i18n] Failed to change language", error);
        if (!cancelled) {
          setGaveUp(true);
        }
        return undefined;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (bundleReady || gaveUp) {
      setHasMountedChildren(true);
    }
  }, [bundleReady, gaveUp]);

  // Hold the first paint only when the active locale is not English and its
  // bundle is still loading. A later switch keeps the tree mounted.
  if (!hasMountedChildren && !bundleReady && !gaveUp) {
    return null;
  }

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

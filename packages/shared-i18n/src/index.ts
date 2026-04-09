import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Resource } from "i18next";

export const supportedLocales = ["en", "pt-BR"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "en";

/**
 * Normalize Shopify session locale (e.g. "pt_BR") to
 * IETF format used by i18next ("pt-BR").
 */
export function normalizeLocale(
  raw: string | null | undefined,
): SupportedLocale {
  if (!raw) return defaultLocale;
  const normalized = raw.replace("_", "-");
  if (supportedLocales.includes(normalized as SupportedLocale)) {
    return normalized as SupportedLocale;
  }
  const lang = normalized.split("-")[0];
  const match = supportedLocales.find((l) => l.startsWith(lang!));
  return match ?? defaultLocale;
}

/**
 * Create an i18n instance with provided resources.
 * Each app passes its own translation resources.
 */
export function createI18nInstance(locale: SupportedLocale, resources: Resource) {
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: defaultLocale,
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

import {
  createI18nInstance as createInstance,
  normalizeLocale,
  supportedLocales,
  defaultLocale,
  type SupportedLocale,
} from "@cpg-labs/shared-i18n";
import resources from "./resources";

export { normalizeLocale, supportedLocales, defaultLocale };
export type { SupportedLocale };

export function createI18nInstance(locale: SupportedLocale) {
  return createInstance(locale, resources);
}

import commonEn from "./locales/en/common.json";
import commonPt from "./locales/pt-BR/common.json";
import homeEn from "./locales/en/home.json";
import homePt from "./locales/pt-BR/home.json";
import settingsEn from "./locales/en/settings.json";
import settingsPt from "./locales/pt-BR/settings.json";
import localDeliveryEn from "./locales/en/local-delivery.json";
import localDeliveryPt from "./locales/pt-BR/local-delivery.json";
import salesGoalsEn from "./locales/en/sales-goals.json";
import salesGoalsPt from "./locales/pt-BR/sales-goals.json";
import retailExpansionEn from "./locales/en/retail-expansion.json";
import retailExpansionPt from "./locales/pt-BR/retail-expansion.json";
import carrierServiceEn from "./locales/en/carrier-service.json";
import carrierServicePt from "./locales/pt-BR/carrier-service.json";
import storytellingEn from "./locales/en/storytelling.json";
import storytellingPt from "./locales/pt-BR/storytelling.json";
import brandSettingsEn from "./locales/en/brand-settings.json";
import brandSettingsPt from "./locales/pt-BR/brand-settings.json";
import goalsEn from "./locales/en/goals.json";
import goalsPt from "./locales/pt-BR/goals.json";
import priceTagsEn from "./locales/en/priceTags.json";
import priceTagsPt from "./locales/pt-BR/priceTags.json";
import merchandisingEn from "./locales/en/merchandising.json";
import merchandisingPt from "./locales/pt-BR/merchandising.json";
import affiliatesEn from "./locales/en/affiliates.json";
import affiliatesPt from "./locales/pt-BR/affiliates.json";
import campaignsEn from "./locales/en/campaigns.json";
import campaignsPt from "./locales/pt-BR/campaigns.json";

const resources = {
  en: {
    common: commonEn,
    home: homeEn,
    settings: settingsEn,
    "local-delivery": localDeliveryEn,
    "sales-goals": salesGoalsEn,
    "retail-expansion": retailExpansionEn,
    "carrier-service": carrierServiceEn,
    storytelling: storytellingEn,
    "brand-settings": brandSettingsEn,
    goals: goalsEn,
    priceTags: priceTagsEn,
    merchandising: merchandisingEn,
    affiliates: affiliatesEn,
    campaigns: campaignsEn,
  },
  "pt-BR": {
    common: commonPt,
    home: homePt,
    settings: settingsPt,
    "local-delivery": localDeliveryPt,
    "sales-goals": salesGoalsPt,
    "retail-expansion": retailExpansionPt,
    "carrier-service": carrierServicePt,
    storytelling: storytellingPt,
    "brand-settings": brandSettingsPt,
    goals: goalsPt,
    priceTags: priceTagsPt,
    merchandising: merchandisingPt,
    affiliates: affiliatesPt,
    campaigns: campaignsPt,
  },
} as const;

export default resources;

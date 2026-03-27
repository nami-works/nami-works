import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[brand-settings] loader shop=${shop}`);
  const settings = await prisma.brandSettings.findUnique({
    where: { shop },
  });

  return { settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  console.info(`[brand-settings] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "save") {
    const about = formData.get("about") as string | null;
    const toneOfVoice = formData.get("toneOfVoice") as string | null;
    const brandName = formData.get("brandName") as string | null;
    const blogUrl = formData.get("blogUrl") as string | null;
    const preferredLanguage = formData.get("preferredLanguage") as string | null;
    const contentLanguage = formData.get("contentLanguage") as string | null;
    const benchmarks = formData.get("benchmarks") as string | null;
    const brandCategory = formData.get("brandCategory") as string | null;
    const editorialGuidelines = formData.get("editorialGuidelines") as
      | string
      | null;
    const formatRecommendations = formData.get(
      "formatRecommendations",
    ) as string | null;
    const contentStrategyJson = formData.get("contentStrategyJson") as
      | string
      | null;

    console.info(`[brand-settings] save START shop=${shop}`);
    await prisma.brandSettings.upsert({
      where: { shop },
      create: {
        shop,
        about: about ?? undefined,
        toneOfVoice: toneOfVoice ?? undefined,
        brandName: brandName ?? undefined,
        blogUrl: blogUrl ?? undefined,
        preferredLanguage: preferredLanguage ?? undefined,
        contentLanguage: contentLanguage ?? undefined,
        benchmarks: benchmarks ?? undefined,
        brandCategory: brandCategory ?? undefined,
        editorialGuidelines: editorialGuidelines ?? undefined,
        formatRecommendations: formatRecommendations ?? undefined,
        contentStrategyJson: contentStrategyJson ?? undefined,
      },
      update: {
        about: about ?? undefined,
        toneOfVoice: toneOfVoice ?? undefined,
        brandName: brandName ?? undefined,
        blogUrl: blogUrl ?? undefined,
        preferredLanguage: preferredLanguage ?? undefined,
        contentLanguage: contentLanguage ?? undefined,
        benchmarks: benchmarks ?? undefined,
        brandCategory: brandCategory ?? undefined,
        editorialGuidelines: editorialGuidelines ?? undefined,
        formatRecommendations: formatRecommendations ?? undefined,
        contentStrategyJson: contentStrategyJson ?? undefined,
      },
    });

    console.info(`[brand-settings] save OK shop=${shop}`);
    return { success: true };
  }

  return { success: false };
};

export default function BrandSettingsPage() {
  const { settings, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("brand-settings");
  const isSaving =
    fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast?.show?.(t("settingsSaved"));
    }
  }, [fetcher.data?.success, shopify, t]);

  return (
    <s-page heading={t("pageHeading")}>
      <s-stack direction="inline" slot="primary-action" gap="base">
        <s-button variant="tertiary" onClick={() => window.history.back()}>
          {t("common:button.back")}
        </s-button>
        <s-button
          variant="primary"
          onClick={() => (document.getElementById("settings-form") as HTMLFormElement)?.requestSubmit()}
          {...(isSaving ? { loading: true } : {})}
        >
          {t("common:button.save")}
        </s-button>
      </s-stack>

      <s-section heading={t("brandConfig.heading")}>
        <s-paragraph>
          {t("brandConfig.description")}
        </s-paragraph>

        <fetcher.Form method="POST" id="settings-form">
          <input type="hidden" name="intent" value="save" />

          <s-stack direction="block" gap="large">
            <s-text-field
              label={t("labels.brandName")}
              name="brandName"
              value={settings?.brandName ?? shop.split(".")[0]}
              placeholder={t("placeholders.brandName")}
            ></s-text-field>

            <s-text-area
              label={t("labels.about")}
              name="about"
              value={settings?.about ?? ""}
              placeholder={t("placeholders.about")}
              rows={4}
            ></s-text-area>

            <s-text-area
              label={t("labels.toneOfVoice")}
              name="toneOfVoice"
              value={settings?.toneOfVoice ?? ""}
              placeholder={t("placeholders.toneOfVoice")}
              rows={4}
            ></s-text-area>

            <s-text-field
              label={t("labels.blogUrl")}
              name="blogUrl"
              value={settings?.blogUrl ?? ""}
              placeholder="https://yourstore.com/blogs/your-blog"
            ></s-text-field>

            <s-stack direction="inline" gap="base">
              <s-select
                label={t("labels.preferredLanguage")}
                name="preferredLanguage"
                value={settings?.preferredLanguage ?? "en_US"}
              >
                <s-option value="en_US">{t("languageOptions.english")}</s-option>
                <s-option value="pt_BR">{t("languageOptions.portugueseBr")}</s-option>
              </s-select>
              <s-select
                label={t("labels.contentLanguage")}
                name="contentLanguage"
                value={settings?.contentLanguage ?? "en_US"}
              >
                <s-option value="en_US">{t("languageOptions.english")}</s-option>
                <s-option value="pt_BR">{t("languageOptions.portugueseBr")}</s-option>
              </s-select>
            </s-stack>

            <s-text-area
              label={t("labels.benchmarks")}
              name="benchmarks"
              value={settings?.benchmarks ?? ""}
              placeholder={t("placeholders.benchmarks")}
              rows={2}
            ></s-text-area>

            <s-text-field
              label={t("labels.brandCategory")}
              name="brandCategory"
              value={settings?.brandCategory ?? ""}
              placeholder={t("placeholders.brandCategory")}
            ></s-text-field>

            <s-text-area
              label={t("labels.editorialGuidelines")}
              name="editorialGuidelines"
              value={settings?.editorialGuidelines ?? ""}
              placeholder={t("placeholders.editorialGuidelines")}
              rows={6}
            ></s-text-area>

            <s-text-area
              label={t("labels.formatRecommendations")}
              name="formatRecommendations"
              value={settings?.formatRecommendations ?? ""}
              placeholder={t("placeholders.formatRecommendations")}
              rows={4}
            ></s-text-area>

            <s-text-area
              label={t("labels.contentStrategy")}
              name="contentStrategyJson"
              value={
                settings?.contentStrategyJson ??
                '{"minWordCount": 800, "maxWordCount": 2000}'
              }
              placeholder='{"minWordCount": 800, "maxWordCount": 2000}'
              rows={2}
            ></s-text-area>

            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
                {t("common:button.save")}
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section slot="aside" heading={t("scrapeStore.heading")}>
        <s-paragraph>
          {t("scrapeStore.description")}
        </s-paragraph>
        <s-button variant="secondary" disabled>
          {t("scrapeStore.comingSoon")}
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

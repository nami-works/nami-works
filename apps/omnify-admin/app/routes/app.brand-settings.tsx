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
import {
  listLearnings,
  removeLearning,
} from "../services/brand-assets/service.server";
import { buildExport } from "../services/brand-assets/export.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  console.info(`[brand-assets] loader shop=${shop}`);
  const settings = await prisma.brandAssets.findUnique({
    where: { shop },
  });

  const learnings = await listLearnings(shop, { limit: 10 });
  const learningsCount = await prisma.brandLearning
    .count({ where: { shop, status: "accepted" } })
    .catch(() => 0);

  return {
    settings,
    shop,
    learnings: learnings.map((l) => ({
      id: l.id,
      category: l.category,
      interpretation: l.interpretation,
      acceptedAt: l.acceptedAt.toISOString(),
    })),
    learningsCount,
  };
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

    console.info(`[brand-assets] save START shop=${shop}`);
    await prisma.brandAssets.upsert({
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

    console.info(`[brand-assets] save OK shop=${shop}`);
    return { success: true };
  }

  if (intent === "exportJson" || intent === "exportMarkdown") {
    const data = await buildExport(shop);
    if (!data) {
      return { success: false, error: "No brand assets to export." };
    }
    const isJson = intent === "exportJson";
    const body = isJson ? data.json : data.markdown;
    const filename = `${data.filename}.${isJson ? "json" : "md"}`;
    const contentType = isJson ? "application/json" : "text/markdown";
    console.info(`[brand-assets] export OK shop=${shop} format=${isJson ? "json" : "md"}`);
    return new Response(body, {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (intent === "removeLearning") {
    const learningId = formData.get("learningId") as string | null;
    if (!learningId) {
      return { success: false, error: "Missing learning ID." };
    }
    await removeLearning(shop, learningId);
    console.info(`[brand-assets] removeLearning OK shop=${shop} id=${learningId}`);
    return { success: true };
  }

  return { success: false };
};

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function BrandSettingsPage() {
  const { settings, shop, learnings, learningsCount } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useTranslation("brand-settings");
  const isSaving =
    fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save";
  const isExporting =
    fetcher.state === "submitting" &&
    (fetcher.formData?.get("intent") === "exportJson" ||
      fetcher.formData?.get("intent") === "exportMarkdown");

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      shopify.toast?.show?.(t("settingsSaved"));
    }
  }, [fetcher.data, shopify, t]);

  const lastExportedRelative = formatRelative(
    settings?.lastExportedAt ? String(settings.lastExportedAt) : null,
  );

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

      <s-section slot="aside" heading={t("export.heading")}>
        <s-paragraph>{t("export.description")}</s-paragraph>
        <s-stack direction="block" gap="base">
          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="exportJson" />
            <s-button
              type="submit"
              variant="primary"
              {...(isExporting ? { loading: true } : {})}
            >
              {t("export.downloadJson")}
            </s-button>
          </fetcher.Form>
          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="exportMarkdown" />
            <s-button
              type="submit"
              variant="secondary"
              {...(isExporting ? { loading: true } : {})}
            >
              {t("export.downloadMarkdown")}
            </s-button>
          </fetcher.Form>
          <s-paragraph>
            {lastExportedRelative
              ? t("export.lastExported", { when: lastExportedRelative })
              : t("export.neverExported")}
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={t("learnings.heading")}>
        {learnings.length === 0 ? (
          <s-paragraph>{t("learnings.empty")}</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {learnings.slice(0, 5).map((learning) => (
              <s-box
                key={learning.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{learning.category}</s-heading>
                  <s-paragraph>{learning.interpretation}</s-paragraph>
                  <div style={{ marginLeft: "auto" }}>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="removeLearning" />
                      <input type="hidden" name="learningId" value={learning.id} />
                      <s-button variant="tertiary" type="submit">
                        {t("learnings.remove")}
                      </s-button>
                    </fetcher.Form>
                  </div>
                </s-stack>
              </s-box>
            ))}
            <s-paragraph>
              {t("learnings.count", { count: learningsCount })}
            </s-paragraph>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

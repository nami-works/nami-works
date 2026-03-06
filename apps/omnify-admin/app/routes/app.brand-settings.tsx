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
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

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

    return { success: true };
  }

  return { success: false };
};

export default function SettingsPage() {
  const { settings, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSaving =
    fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast?.show?.("Settings saved");
    }
  }, [fetcher.data?.success, shopify]);

  return (
    <s-page heading="Settings">
      <s-stack direction="inline" slot="primary-action" gap="base">
        <s-button variant="tertiary" onClick={() => window.history.back()}>
          Back
        </s-button>
        <s-button
          variant="primary"
          onClick={() => (document.getElementById("settings-form") as HTMLFormElement)?.requestSubmit()}
          {...(isSaving ? { loading: true } : {})}
        >
          Save
        </s-button>
      </s-stack>

      <s-section heading="Brand configuration">
        <s-paragraph>
          Configure your brand context for Blog Posts generation. These values
          are used as input to the content generation process.
        </s-paragraph>

        <fetcher.Form method="POST" id="settings-form">
          <input type="hidden" name="intent" value="save" />

          <s-stack direction="block" gap="large">
            <s-stack direction="block" gap="base">
              <label htmlFor="brandName">Brand name</label>
              <input
                id="brandName"
                name="brandName"
                type="text"
                defaultValue={settings?.brandName ?? shop.split(".")[0]}
                placeholder="Your brand display name"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="about">About</label>
              <textarea
                id="about"
                name="about"
                rows={4}
                defaultValue={settings?.about ?? undefined}
                placeholder="Brand story, mission, institutional info"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="toneOfVoice">Tone of voice</label>
              <textarea
                id="toneOfVoice"
                name="toneOfVoice"
                rows={4}
                defaultValue={settings?.toneOfVoice ?? undefined}
                placeholder="How the brand communicates (e.g. formal, casual, inspirational). Use 'Scrape store' to auto-generate from your content."
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="blogUrl">Blog URL</label>
              <input
                id="blogUrl"
                name="blogUrl"
                type="url"
                defaultValue={settings?.blogUrl ?? undefined}
                placeholder="https://yourstore.com/blogs/your-blog"
              />
            </s-stack>

            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="base">
                <label htmlFor="preferredLanguage">Preferred language</label>
                <select
                  id="preferredLanguage"
                  name="preferredLanguage"
                  defaultValue={settings?.preferredLanguage ?? "en_US"}
                >
                  <option value="en_US">English</option>
                  <option value="pt_BR">Portuguese (BR)</option>
                </select>
              </s-stack>
              <s-stack direction="block" gap="base">
                <label htmlFor="contentLanguage">Content language</label>
                <select
                  id="contentLanguage"
                  name="contentLanguage"
                  defaultValue={settings?.contentLanguage ?? "en_US"}
                >
                  <option value="en_US">English</option>
                  <option value="pt_BR">Portuguese (BR)</option>
                </select>
              </s-stack>
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="benchmarks">Benchmarks</label>
              <textarea
                id="benchmarks"
                name="benchmarks"
                rows={2}
                defaultValue={settings?.benchmarks ?? undefined}
                placeholder="Competitor or reference brands (e.g. Gisou, Glossier), one per line"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="brandCategory">Brand category</label>
              <input
                id="brandCategory"
                name="brandCategory"
                type="text"
                defaultValue={settings?.brandCategory ?? undefined}
                placeholder="e.g. premium hair care, skincare"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="editorialGuidelines">Editorial guidelines</label>
              <textarea
                id="editorialGuidelines"
                name="editorialGuidelines"
                rows={6}
                defaultValue={settings?.editorialGuidelines ?? undefined}
                placeholder="Content architecture, tone rules, structure guidelines"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="formatRecommendations">Format recommendations</label>
              <textarea
                id="formatRecommendations"
                name="formatRecommendations"
                rows={4}
                defaultValue={settings?.formatRecommendations ?? undefined}
                placeholder="HTML structure, summary guidelines (e.g. Resumo HTML: 150–160 chars), content length"
              />
            </s-stack>

            <s-stack direction="block" gap="base">
              <label htmlFor="contentStrategyJson">
                Content strategy (JSON, optional)
              </label>
              <textarea
                id="contentStrategyJson"
                name="contentStrategyJson"
                rows={2}
                defaultValue={
                  settings?.contentStrategyJson ??
                  '{"minWordCount": 800, "maxWordCount": 2000}'
                }
                placeholder='{"minWordCount": 800, "maxWordCount": 2000}'
              />
            </s-stack>

            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
                Save
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section slot="aside" heading="Scrape store">
        <s-paragraph>
          Use &quot;Scrape store&quot; to analyze your shop content and
          auto-generate tone of voice. Requires the Content Scraper API to be
          configured.
        </s-paragraph>
        <s-button variant="secondary" disabled>
          Scrape store (coming soon)
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

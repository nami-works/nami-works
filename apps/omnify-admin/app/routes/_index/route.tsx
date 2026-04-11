import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { redirect, useLoaderData } from "react-router";

import prisma from "../../db.server";
import { resolveSiteVariant } from "../../utils/host.server";

import { OmnifyHome } from "./omnify-home";
import { CpgLabsHome } from "./cpglabs-home";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app/local-delivery?${url.searchParams.toString()}`);
  }

  const variant = resolveSiteVariant(request);
  return { variant };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (data?.variant === "cpglabs") {
    return [
      { title: "CPG Labs | Custom Shopify software for CPG brands" },
      {
        name: "description",
        content:
          "Custom software for Shopify stores, priced like an app. We scope it, quote it in 48 hours, and ship it as an embedded app inside your Shopify admin.",
      },
      { property: "og:title", content: "CPG Labs" },
      {
        property: "og:description",
        content:
          "Custom software for Shopify stores. Priced like an app.",
      },
    ];
  }

  return [
    { title: "Omnify | Local delivery and retail expansion for Shopify" },
    {
      name: "description",
      content:
        "Manage your whole presence on Google Maps, plan local delivery routes, and choose the next retail location — directly from your Shopify admin.",
    },
    { property: "og:title", content: "Omnify" },
    {
      property: "og:description",
      content:
        "The location management platform built for Shopify. Show up, go local, expand.",
    },
  ];
};

const VALID_TIMELINES = new Set([
  "asap",
  "this_month",
  "this_quarter",
  "exploring",
]);

function isValidStoreUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "waitlist");
  const email = String(formData.get("email") || "").trim().toLowerCase();

  // ── Lead form (cpglabs-home "Describe your pain" form) ──
  if (intent === "lead") {
    const honeypot = String(formData.get("website") || "").trim();
    // Silent reject if honeypot is populated — return a faux success.
    if (honeypot) {
      console.warn("[home] lead SKIP reason=honeypot");
      return { success: true };
    }

    const storeUrl = String(formData.get("store_url") || "").trim();
    const pain = String(formData.get("pain") || "").trim();
    const workaroundRaw = String(formData.get("workaround") || "").trim();
    const workaround = workaroundRaw.length > 0 ? workaroundRaw : null;
    const timeline = String(formData.get("timeline") || "").trim();

    if (!isValidStoreUrl(storeUrl)) {
      return {
        error:
          "Add your full store URL starting with https:// so we can look it up.",
      };
    }
    if (pain.length < 20) {
      return {
        error: "Give us a little more detail, at least a sentence or two.",
      };
    }
    if (pain.length > 1000) {
      return { error: "Trim the description to around 1000 characters." };
    }
    if (workaround && workaround.length > 500) {
      return { error: "Trim the workaround to around 500 characters." };
    }
    if (!VALID_TIMELINES.has(timeline)) {
      return { error: "Pick a timeline so we know how to plan the scope." };
    }
    if (!isValidEmail(email)) {
      return { error: "We need an email with an @ so we can reply." };
    }

    const metadata = {
      store_url: storeUrl,
      pain,
      workaround,
      timeline,
      submitted_at: new Date().toISOString(),
    };

    try {
      await prisma.waitlistSubscriber.upsert({
        where: { email },
        create: { email, source: "cpglabs-home", metadata },
        update: { metadata },
      });
      console.info(
        `[home] lead OK email=*** source=cpglabs-home timeline=${timeline}`,
      );
      return { success: true };
    } catch (e) {
      console.error("[home] lead FAILED source=cpglabs-home", e);
      return { error: "Something went wrong on our side. Try again in a moment." };
    }
  }

  // ── Legacy waitlist (Omnify / gbp-health-check) ──
  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  try {
    await prisma.waitlistSubscriber.upsert({
      where: { email },
      create: { email, source: "gbp-health-check" },
      update: {},
    });
    console.info(`[home] ${intent} OK email=*** source=gbp-health-check`);
    return { success: true };
  } catch (e) {
    console.error(`[home] ${intent} FAILED source=gbp-health-check`, e);
    return { error: "Something went wrong. Please try again." };
  }
};

export default function HomePage() {
  const { variant } = useLoaderData<typeof loader>();
  return variant === "cpglabs" ? <CpgLabsHome /> : <OmnifyHome />;
}

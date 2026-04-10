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
          "CPG Labs builds custom Shopify software tailored to your brand — not another subscription. One build, one price, zero app bloat.",
      },
      { property: "og:title", content: "CPG Labs" },
      {
        property: "og:description",
        content:
          "Build-to-suit software for CPG brands on Shopify. Stop renting features. Start owning your stack.",
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "waitlist");
  const email = String(formData.get("email") || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  const source = intent === "lead" ? "cpglabs-home" : "gbp-health-check";

  try {
    await prisma.waitlistSubscriber.upsert({
      where: { email },
      create: { email, source },
      update: {},
    });
    console.info(`[home] ${intent} OK email=*** source=${source}`);
    return { success: true };
  } catch (e) {
    console.error(`[home] ${intent} FAILED source=${source}`, e);
    return { error: "Something went wrong. Please try again." };
  }
};

export default function HomePage() {
  const { variant } = useLoaderData<typeof loader>();
  return variant === "cpglabs" ? <CpgLabsHome /> : <OmnifyHome />;
}

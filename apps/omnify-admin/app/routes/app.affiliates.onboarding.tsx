/**
 * Affiliates · Onboarding queue (placeholder)
 *
 * Lists AffiliateCode rows where profileId is null — codes that show up in
 * orders but aren't yet mapped to an affiliate profile. Reachable from the
 * Attribution Queue tab's inline "{N} codes need a profile" banner.
 *
 * The actual onboarding editor (create/match a profile) ships in a follow-up
 * deploy. For now the row's "Onboard" button is disabled with "Coming soon".
 */

import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import { normalizeLocale } from "../i18n/config";
import {
  formatCurrencyCompact,
  formatNumberCompact,
} from "../i18n/format";
import { listUnmappedCodes } from "../affiliates/programs.server";
import type { UnmappedCodeRow } from "../affiliates/types";
import styles from "./app.affiliates/styles.module.css";

type LoaderData = {
  rows: UnmappedCodeRow[];
  userLocale: string;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userLocale = normalizeLocale((session as any).locale);
  const rows = await listUnmappedCodes(shop);
  console.info(
    `[affiliates-onboarding] loader shop=${shop} unmapped=${rows.length}`,
  );
  return { rows, userLocale };
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

function formatDateShort(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export default function AffiliatesOnboardingPage() {
  const { rows, userLocale } = useLoaderData<LoaderData>();
  const { t } = useTranslation("affiliates");

  return (
    <s-page heading={t("onboarding.title", "Codes awaiting onboarding")}>
      <s-button slot="back-action" {...{ href: "/app/affiliates" } as Record<string, string>}>
        {t("onboarding.back", "Back to Affiliates")}
      </s-button>
      <s-section>
        <p className={styles.onboardingSubtitle}>
          {t(
            "onboarding.subtitle",
            "These coupon codes appear in orders but aren't mapped to an affiliate profile yet.",
          )}
        </p>

        {rows.length === 0 ? (
          <div className={styles.settingsEmpty} role="status">
            {t("onboarding.empty", "All codes are mapped to affiliate profiles. ✓")}
          </div>
        ) : (
          <div className={styles.onboardingTableWrap}>
            <table className={styles.onboardingTable}>
              <thead>
                <tr>
                  <th>{t("onboarding.column.code", "Code")}</th>
                  <th>{t("onboarding.column.firstSeen", "First seen")}</th>
                  <th className={styles.onboardingNumeric}>
                    {t("onboarding.column.orders", "Orders")}
                  </th>
                  <th className={styles.onboardingNumeric}>
                    {t("onboarding.column.revenue", "Revenue")}
                  </th>
                  <th>{t("onboarding.column.program", "Program")}</th>
                  <th className={styles.onboardingNumeric}>
                    {t("onboarding.column.action", "Action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <code className={styles.onboardingCode}>{r.code}</code>
                    </td>
                    <td>{formatDateShort(r.firstSeenAt, userLocale)}</td>
                    <td className={styles.onboardingNumeric}>
                      {formatNumberCompact(r.ordersCount)}
                    </td>
                    <td className={styles.onboardingNumeric}>
                      {r.ordersCount > 0
                        ? formatCurrencyCompact(
                            r.revenue,
                            r.currencyCode ?? "BRL",
                            userLocale,
                          )
                        : "—"}
                    </td>
                    <td>{r.programLabel ?? t("onboarding.noProgram", "—")}</td>
                    <td className={styles.onboardingNumeric}>
                      <s-button
                        variant="secondary"
                        disabled
                        {...{ title: t("onboarding.comingSoon", "Coming soon") } as Record<string, string>}
                      >
                        {t("onboarding.action.onboard", "Onboard")}
                      </s-button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.onboardingBackLink}>
          <Link to="/app/affiliates">
            ← {t("onboarding.back", "Back to Affiliates")}
          </Link>
        </p>
      </s-section>
    </s-page>
  );
}

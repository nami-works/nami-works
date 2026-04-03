import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import styles from "./app.merchandising/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const campaigns = await prisma.bulkPriceCampaign.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  return { campaigns };
};

type Campaign = Awaited<ReturnType<typeof loader>>["campaigns"][number];

const STATUS_CLASSES: Record<string, string> = {
  active: styles.statusActive ?? "",
  scheduled: styles.statusScheduled ?? "",
  expired: styles.statusOther ?? "",
  draft: styles.statusDraft ?? "",
  cancelled: styles.statusCancelled ?? "",
};

function formatTime(campaign: Campaign): string {
  const fmt = (d: Date | string | null) => {
    if (!d) return "";
    const date = new Date(d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }) + ", " + date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const start = `Start: ${fmt(campaign.startAt)}`;
  if (campaign.endAt) {
    return `${start}\nEnd: ${fmt(campaign.endAt)}`;
  }
  return start;
}

export default function CampaignsList() {
  const { campaigns } = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all"
    ? campaigns
    : campaigns.filter((c) => c.status === filter);

  const counts = {
    all: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    scheduled: campaigns.filter((c) => c.status === "scheduled").length,
    expired: campaigns.filter((c) => c.status === "expired").length,
  };

  return (
    <>
      <s-section>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <s-button
            variant="primary"
            onClick={() => navigate("/app/merchandising/campaigns/new")}
          >
            {t("campaigns.createCampaign")}
          </s-button>
        </div>

        <div className={styles.campaignFilterTabs}>
          {(["all", "active", "scheduled", "expired"] as const).map((tab) => (
            <button
              key={tab}
              className={`${styles.campaignFilterTab} ${filter === tab ? styles.campaignFilterTabActive : ""}`}
              onClick={() => setFilter(tab)}
            >
              {t(`campaigns.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)} ({counts[tab]})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{t("campaigns.noResults")}</p>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th>{t("campaigns.colName")}</th>
                  <th>{t("campaigns.colType")}</th>
                  <th>{t("campaigns.colStatus")}</th>
                  <th>{t("campaigns.colProducts")}</th>
                  <th>{t("campaigns.colTime")}</th>
                  <th>{t("campaigns.colRevenue")}</th>
                  <th>{t("campaigns.colOrders")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className={`${styles.tableRow} ${styles.campaignRow}`}
                    onClick={() => navigate(`/app/merchandising/campaigns/${campaign.id}`)}
                  >
                    <td className={styles.tableCell}>
                      <div>{campaign.name}</div>
                      <div className={styles.campaignNameSub}>
                        {campaign.discountValue}%
                      </div>
                    </td>
                    <td className={styles.tableCell}>
                      {t("campaigns.bulkPriceEditor")}
                    </td>
                    <td className={styles.tableCell}>
                      <span className={`${styles.statusBadge} ${STATUS_CLASSES[campaign.status] ?? styles.statusOther}`}>
                        {t(`campaigns.status${campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}`)}
                      </span>
                    </td>
                    <td className={styles.tableCell}>
                      {campaign.productCount > 0
                        ? `${campaign.productCount} (${campaign.variantCount} ${t("campaigns.variants")})`
                        : "-"}
                    </td>
                    <td className={styles.tableCell} style={{ whiteSpace: "pre-line", fontSize: "12px" }}>
                      {formatTime(campaign)}
                    </td>
                    <td className={styles.tableCell}>-</td>
                    <td className={styles.tableCell}>-</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </>
  );
}

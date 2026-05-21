import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Mirror a Lalamove webhook status to the Shopify order's
 * custom.lalamove_delivery_status metafield (single_line_text_field).
 *
 * On terminal-failure events (REJECTED / CANCELED / EXPIRED) also append a
 * "[Lalamove] Delivery <status>: <reason>" line to the order note.
 *
 * This metafield is the canonical Shopify-side delivery state read by
 * downstream systems (WhatsApp messaging, customer-care dashboards) to decide
 * when to trigger tracking links, address-confirm requests, etc. Those
 * downstream consumers ship in a later track — this function only lays the
 * trigger surface.
 *
 * Idempotent: reads the current metafield value first; if it matches the
 * incoming status, returns early without writing.
 *
 * Errors are caught and returned as `{ ok: false, reason }` — the function
 * NEVER throws so the calling webhook handler can finish without 5xx.
 */

const TERMINAL_FAILURE_STATUSES = new Set(["REJECTED", "CANCELED", "EXPIRED"]);

const METAFIELD_NAMESPACE = "custom";
const METAFIELD_KEY = "lalamove_delivery_status";

type SyncSuccess = { ok: true; metafieldId: string; noteAppended: boolean };
type SyncFailure = { ok: false; reason: string };
type SyncResult = SyncSuccess | SyncFailure;

interface OrderReadResult {
  metafieldId: string | null;
  metafieldValue: string | null;
  note: string | null;
}

async function readOrderState(
  admin: AdminApiContext,
  shopifyOrderId: string,
): Promise<OrderReadResult> {
  const response = await admin.graphql(
    `#graphql
      query LalamoveSyncRead($id: ID!) {
        order(id: $id) {
          id
          note
          metafield(namespace: "custom", key: "lalamove_delivery_status") {
            id
            value
          }
        }
      }`,
    { variables: { id: shopifyOrderId } },
  );
  const json = (await response.json()) as {
    data?: {
      order?: {
        id?: string | null;
        note?: string | null;
        metafield?: { id?: string | null; value?: string | null } | null;
      } | null;
    };
  };
  const order = json.data?.order ?? null;
  return {
    metafieldId: order?.metafield?.id ?? null,
    metafieldValue: order?.metafield?.value ?? null,
    note: order?.note ?? null,
  };
}

async function writeMetafield(
  admin: AdminApiContext,
  shopifyOrderId: string,
  status: string,
): Promise<{ id: string } | { error: string }> {
  const response = await admin.graphql(
    `#graphql
      mutation LalamoveSyncSetMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopifyOrderId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "single_line_text_field",
            value: status,
          },
        ],
      },
    },
  );
  const json = (await response.json()) as {
    data?: {
      metafieldsSet?: {
        metafields?: Array<{ id?: string | null }> | null;
        userErrors?: Array<{ field?: string[] | null; message?: string | null }> | null;
      } | null;
    };
  };
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      error: userErrors
        .map((e) => `${(e.field ?? []).join(".")}: ${e.message ?? "unknown"}`)
        .join("; "),
    };
  }
  const id = json.data?.metafieldsSet?.metafields?.[0]?.id ?? null;
  if (!id) {
    return { error: "metafieldsSet returned no metafield id" };
  }
  return { id };
}

async function appendOrderNote(
  admin: AdminApiContext,
  shopifyOrderId: string,
  existingNote: string | null,
  appendLine: string,
): Promise<{ ok: true } | { error: string }> {
  const base = (existingNote ?? "").length > 0 ? `${existingNote}\n` : "";
  const nextNote = `${base}${appendLine}`;
  const response = await admin.graphql(
    `#graphql
      mutation LalamoveSyncOrderNote($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: {
          id: shopifyOrderId,
          note: nextNote,
        },
      },
    },
  );
  const json = (await response.json()) as {
    data?: {
      orderUpdate?: {
        userErrors?: Array<{ field?: string[] | null; message?: string | null }> | null;
      } | null;
    };
  };
  const userErrors = json.data?.orderUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      error: userErrors
        .map((e) => `${(e.field ?? []).join(".")}: ${e.message ?? "unknown"}`)
        .join("; "),
    };
  }
  return { ok: true };
}

export async function syncLalamoveStatusToShopify(args: {
  admin: AdminApiContext;
  shopifyOrderId: string;
  lalamoveStatus: string;
  failureReason?: string | null;
  shop: string;
}): Promise<SyncResult> {
  const { admin, shopifyOrderId, shop } = args;
  const status = String(args.lalamoveStatus ?? "").trim().toUpperCase();
  const failureReason = (args.failureReason ?? "").toString().trim();

  if (!status) {
    return { ok: false, reason: "missing-status" };
  }
  if (!shopifyOrderId) {
    return { ok: false, reason: "missing-order-id" };
  }

  console.info(
    `[lalamove-shopify-sync] sync START shop=${shop} orderId=${shopifyOrderId} status=${status}`,
  );

  try {
    const current = await readOrderState(admin, shopifyOrderId);

    if (current.metafieldValue && current.metafieldValue.toUpperCase() === status) {
      const existingId = current.metafieldId ?? "";
      console.info(
        `[lalamove-shopify-sync] sync SKIP shop=${shop} orderId=${shopifyOrderId} reason=already-set status=${status}`,
      );
      return { ok: true, metafieldId: existingId, noteAppended: false };
    }

    const writeResult = await writeMetafield(admin, shopifyOrderId, status);
    if ("error" in writeResult) {
      console.error(
        `[lalamove-shopify-sync] sync FAILED shop=${shop} orderId=${shopifyOrderId} status=${status}`,
        new Error(writeResult.error),
      );
      return { ok: false, reason: writeResult.error };
    }

    let noteAppended = false;
    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      const reason = failureReason.length > 0 ? failureReason : "no reason provided";
      const line = `[Lalamove] Delivery ${status}: ${reason}`;
      const noteResult = await appendOrderNote(admin, shopifyOrderId, current.note, line);
      if ("error" in noteResult) {
        // Metafield already written successfully — log but do not fail the call.
        console.error(
          `[lalamove-shopify-sync] note append FAILED shop=${shop} orderId=${shopifyOrderId} status=${status}`,
          new Error(noteResult.error),
        );
      } else {
        noteAppended = true;
      }
    }

    console.info(
      `[lalamove-shopify-sync] sync OK shop=${shop} orderId=${shopifyOrderId} status=${status} metafieldId=${writeResult.id} noteAppended=${noteAppended}`,
    );
    return { ok: true, metafieldId: writeResult.id, noteAppended };
  } catch (error) {
    console.error(
      `[lalamove-shopify-sync] sync FAILED shop=${shop} orderId=${shopifyOrderId} status=${status}`,
      error,
    );
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

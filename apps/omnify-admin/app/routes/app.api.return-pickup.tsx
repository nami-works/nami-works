import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let body: { orderId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const orderId = body.orderId;
  if (!orderId || typeof orderId !== "string") {
    return Response.json({ ok: false, error: "Missing orderId" }, { status: 400 });
  }

  // Check if a return request already exists for this order
  const existing = await prisma.returnPickupRequest.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
  });
  if (existing && existing.status !== "cancelled") {
    return Response.json({ ok: true, alreadyExists: true, returnRequestId: existing.id });
  }

  // Fetch order details from Shopify Admin GraphQL
  const orderResponse = await admin.graphql(
    `#graphql
      query ReturnPickupOrder($id: ID!) {
        order(id: $id) {
          id
          name
          shippingAddress {
            address1
            address2
            city
            province
            zip
            country
            latitude
            longitude
            firstName
            lastName
            phone
          }
          fulfillmentOrders(first: 1) {
            nodes {
              assignedLocation {
                location {
                  id
                }
              }
            }
          }
        }
      }
    `,
    { variables: { id: orderId } },
  );

  const orderJson = await orderResponse.json();
  const order = orderJson.data?.order;
  if (!order) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const shipping = order.shippingAddress;
  const locationId =
    order.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id ?? "";
  const customerName = [shipping?.firstName, shipping?.lastName]
    .filter(Boolean)
    .join(" ") || null;

  // Upsert: if cancelled record exists, update it; otherwise create new
  const record = await prisma.returnPickupRequest.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
    update: {
      status: "pending",
      shopifyOrderName: order.name,
      locationId,
      customerName,
      customerPhone: shipping?.phone ?? null,
      customerAddress: [shipping?.address1, shipping?.city, shipping?.province, shipping?.zip, shipping?.country]
        .filter(Boolean)
        .join(", "),
      customerAddress2: shipping?.address2 ?? null,
      customerLat: shipping?.latitude ?? null,
      customerLng: shipping?.longitude ?? null,
      returnInstructions: null,
      quotationId: null,
      lalamoveOrderId: null,
      quotationTotal: null,
      quotationCurrency: null,
    },
    create: {
      shop,
      shopifyOrderId: orderId,
      shopifyOrderName: order.name,
      locationId,
      customerName,
      customerPhone: shipping?.phone ?? null,
      customerAddress: [shipping?.address1, shipping?.city, shipping?.province, shipping?.zip, shipping?.country]
        .filter(Boolean)
        .join(", "),
      customerAddress2: shipping?.address2 ?? null,
      customerLat: shipping?.latitude ?? null,
      customerLng: shipping?.longitude ?? null,
      status: "pending",
      requestedBy: "admin-extension",
    },
  });

  return Response.json({ ok: true, returnRequestId: record.id });
};

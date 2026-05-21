import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../../db.server";

const CARRIER_SERVICE_NAME = "Omnify Local Delivery";

export type CarrierRegistrationResult =
  | { ok: true; carrierServiceId: string }
  | { ok: false; error: string };

/**
 * Build the public callback URL for the carrier rate endpoint.
 * Shopify will POST rate requests to this URL; shop is in query so we can resolve config.
 */
export function buildCarrierCallbackUrl(baseUrl: string, shop: string): string {
  const url = new URL("/api/carrier-rates", baseUrl);
  url.searchParams.set("shop", shop);
  return url.toString();
}

/**
 * Create a carrier service for the shop and persist its id.
 * Requires write_shipping scope. Caller must ensure scope is granted.
 */
export async function createCarrierService(
  admin: AdminApiContext,
  shop: string,
  callbackUrl: string,
): Promise<CarrierRegistrationResult> {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
          carrierServiceCreate(input: $input) {
            carrierService {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          input: {
            name: CARRIER_SERVICE_NAME,
            callbackUrl,
            active: true,
            supportsServiceDiscovery: true,
          },
        },
      },
    );
    const json = await response.json();
    const create = json?.data?.carrierServiceCreate;
    const errors = create?.userErrors as Array<{ field: string[]; message: string }> | undefined;
    if (errors?.length) {
      const msg = errors.map((e) => e.message).join("; ");
      return { ok: false, error: msg };
    }
    const id = create?.carrierService?.id as string | undefined;
    if (!id) return { ok: false, error: "No carrier service id returned." };

    await prisma.carrierServiceRegistration.upsert({
      where: { shop },
      create: { shop, carrierServiceId: id, callbackUrl, active: true },
      update: { carrierServiceId: id, callbackUrl, active: true },
    });
    return { ok: true, carrierServiceId: id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Carrier service create failed.";
    return { ok: false, error: message };
  }
}

/**
 * Update carrier service active state.
 */
export async function updateCarrierServiceActive(
  admin: AdminApiContext,
  shop: string,
  active: boolean,
): Promise<CarrierRegistrationResult> {
  const row = await prisma.carrierServiceRegistration.findUnique({
    where: { shop },
  });
  if (!row) return { ok: false, error: "Carrier service not registered." };

  try {
    const response = await admin.graphql(
      `#graphql
        mutation CarrierServiceUpdate($input: DeliveryCarrierServiceUpdateInput!) {
          carrierServiceUpdate(input: $input) {
            carrierService { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: {
            id: row.carrierServiceId,
            active,
          },
        },
      },
    );
    const json = await response.json();
    const update = json?.data?.carrierServiceUpdate;
    const errors = update?.userErrors as Array<{ message: string }> | undefined;
    if (errors?.length) {
      return { ok: false, error: errors.map((e) => e.message).join("; ") };
    }
    await prisma.carrierServiceRegistration.update({
      where: { shop },
      data: { active },
    });
    return { ok: true, carrierServiceId: row.carrierServiceId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Carrier service update failed.";
    return { ok: false, error: message };
  }
}

/**
 * Delete the carrier service for the shop and remove registration.
 */
export async function deleteCarrierService(
  admin: AdminApiContext,
  shop: string,
): Promise<CarrierRegistrationResult> {
  const row = await prisma.carrierServiceRegistration.findUnique({
    where: { shop },
  });
  if (!row) return { ok: true, carrierServiceId: "" };

  try {
    const response = await admin.graphql(
      `#graphql
        mutation CarrierServiceDelete($id: ID!) {
          carrierServiceDelete(id: $id) {
            deletedId
            userErrors { field message }
          }
        }`,
      { variables: { id: row.carrierServiceId } },
    );
    const json = await response.json();
    const del = json?.data?.carrierServiceDelete;
    const errors = del?.userErrors as Array<{ message: string }> | undefined;
    if (errors?.length) {
      return { ok: false, error: errors.map((e) => e.message).join("; ") };
    }
    await prisma.carrierServiceRegistration.delete({ where: { shop } });
    return { ok: true, carrierServiceId: row.carrierServiceId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Carrier service delete failed.";
    return { ok: false, error: message };
  }
}

export async function getCarrierRegistration(shop: string) {
  return prisma.carrierServiceRegistration.findUnique({
    where: { shop },
  });
}

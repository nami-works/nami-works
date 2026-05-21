/**
 * Shopify native local delivery: fetch zones per location and update delivery information.
 */

export type ShopifyLocalDeliveryZone = {
  profileId: string;
  locationGroupId: string;
  zoneId: string;
  zoneName: string;
  methodDefinitions: Array<{
    id: string;
    name: string;
    description: string | null;
    priceAmount: string | null;
    currencyCode: string | null;
  }>;
};

export type LocalDeliveryZonesByLocation = {
  locationId: string;
  zones: ShopifyLocalDeliveryZone[];
}[];

const LOCAL_DELIVERY_QUERY = `#graphql
  query LocalDeliveryZonesByLocation {
    deliveryProfiles(first: 20, merchantOwnedOnly: false) {
      nodes {
        id
        profileLocationGroups {
          locationGroup {
            id
            locations(first: 50) {
              nodes {
                id
              }
            }
          }
          locationGroupZones(first: 50) {
            nodes {
              zone {
                id
                name
              }
              methodDefinitions(first: 10) {
                nodes {
                  id
                  name
                  description
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function parsePrice(
  method: {
    rateProvider?: {
      __typename?: string;
      price?: { amount: string; currencyCode: string };
    };
  },
): { amount: string | null; currencyCode: string | null } {
  const provider = method.rateProvider as
    | {
        __typename?: string;
        price?: { amount: string; currencyCode: string };
      }
    | undefined;
  if (!provider?.price) return { amount: null, currencyCode: null };
  return {
    amount: provider.price.amount,
    currencyCode: provider.price.currencyCode,
  };
}

/**
 * Fetches Shopify delivery zones per location from delivery profiles.
 * Includes all zones and methods (Brazil, International, local delivery, etc.)
 * so personalization can apply to any delivery method for the location.
 */
export async function fetchLocalDeliveryZonesPerLocation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { graphql: (query: string, opts?: { variables?: object }) => Promise<any> },
): Promise<LocalDeliveryZonesByLocation> {
  const res = await admin.graphql(LOCAL_DELIVERY_QUERY);
  const json = await res.json();
  const gqlErrors = json?.errors;
  if (gqlErrors?.length) {
    const msg = gqlErrors.map((e: { message?: string }) => e?.message ?? "").join("; ");
    throw new Error(`Delivery profiles query failed: ${msg}`);
  }
  const rawProfiles = json?.data?.deliveryProfiles;
  const nodes =
    rawProfiles?.nodes ??
    rawProfiles?.edges?.map((e: { node: unknown }) => e.node) ??
    [];

  const byLocation = new Map<string, LocalDeliveryZonesByLocation[0]>();

  for (const profile of nodes) {
    const profileId = profile.id;
    for (const plg of profile.profileLocationGroups ?? []) {
      const locationGroupId = plg.locationGroup?.id;
      const locs = plg.locationGroup?.locations;
      const locationNodes = Array.isArray(locs)
        ? locs
        : (locs?.nodes ??
          (locs?.edges?.map((e: { node: unknown }) => e.node) ?? []));
      if (!locationGroupId) continue;

      for (const loc of locationNodes) {
        const locationId = loc?.id ?? loc;
        if (!locationId) continue;
        if (!byLocation.has(locationId)) {
          byLocation.set(locationId, { locationId, zones: [] });
        }
        const entry = byLocation.get(locationId)!;

        const zoneConn = plg.locationGroupZones ?? plg.locationGroup?.locationGroupZones;
        const zoneNodes = Array.isArray(zoneConn)
          ? zoneConn
          : (zoneConn?.nodes ??
            (zoneConn?.edges?.map((e: { node: unknown }) => e.node) ?? []));
        for (const lgz of zoneNodes) {
          const zoneObj = lgz.zone ?? lgz;
          const methodConn = lgz.methodDefinitions ?? zoneObj?.methodDefinitions;
          const methodDefs = Array.isArray(methodConn)
            ? methodConn
            : (methodConn?.nodes ??
              (methodConn?.edges?.map((e: { node: unknown }) => e.node) ?? []));
          if (methodDefs.length === 0) continue;

          const zoneId = zoneObj?.id ?? lgz?.id;
          const zoneName = zoneObj?.name ?? lgz?.name ?? "Zone";
          if (!zoneId) continue;

          entry.zones.push({
            profileId,
            locationGroupId,
            zoneId,
            zoneName,
            methodDefinitions: methodDefs.map((m: Record<string, unknown>) => {
              const p = parsePrice(m as Parameters<typeof parsePrice>[0]);
              return {
                id: m.id as string,
                name: m.name as string,
                description: (m.description as string | null) ?? null,
                priceAmount: p.amount ?? null,
                currencyCode: p.currencyCode ?? null,
              };
            }),
          });
        }
      }
    }
  }

  return Array.from(byLocation.values()).filter((e) => e.zones.length > 0);
}

/**
 * Updates the delivery information (description) of a method definition in Shopify.
 */
export async function updateMethodDefinitionDescription(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { graphql: (query: string, opts?: { variables?: object }) => Promise<any> },
  params: {
    profileId: string;
    locationGroupId: string;
    zoneId: string;
    methodDefinitionId: string;
    description: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const mutation = `#graphql
    mutation DeliveryProfileUpdateMethodDescription(
      $profileId: ID!
      $profile: DeliveryProfileInput!
    ) {
      deliveryProfileUpdate(id: $profileId, profile: $profile) {
        profile {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const profile = {
    locationGroupsToUpdate: [
      {
        id: params.locationGroupId,
        zonesToUpdate: [
          {
            id: params.zoneId,
            methodDefinitionsToUpdate: [
              {
                id: params.methodDefinitionId,
                description: params.description,
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await admin.graphql(mutation, {
    variables: { profileId: params.profileId, profile },
  });
  const json = await res.json();
  const payload = json?.data?.deliveryProfileUpdate;
  const errors = payload?.userErrors ?? [];

  if (errors.length > 0) {
    return {
      ok: false,
      error: errors.map((e: { message: string }) => e.message).join("; "),
    };
  }
  return { ok: true };
}

/**
 * Debug route: returns raw deliveryProfiles API response.
 * Visit /app/debug-delivery to inspect the structure.
 * Remove or restrict in production.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

const DEBUG_ENABLED = process.env.NODE_ENV !== "production";

const DEBUG_QUERY = `#graphql
  query DebugDeliveryProfiles {
    deliveryProfiles(first: 20, merchantOwnedOnly: false) {
      nodes {
        id
        name
        default
        profileLocationGroups {
          locationGroup {
            id
            locations(first: 50) {
              nodes {
                id
                name
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!DEBUG_ENABLED) throw redirect("/app");
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(DEBUG_QUERY);
  const json = (await res.json()) as {
    errors?: unknown[];
    data?: { deliveryProfiles?: { nodes?: unknown[] } };
  };
  return {
    raw: json,
    errors: json?.errors,
    profileCount: json?.data?.deliveryProfiles?.nodes?.length ?? 0,
  };
};

export default function DebugDelivery() {
  const data = useLoaderData<typeof loader>();
  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h2>Delivery profiles debug</h2>
      <p>Profile count: {data.profileCount}</p>
      {data.errors?.length ? (
        <pre style={{ color: "red", overflow: "auto" }}>
          {JSON.stringify(data.errors, null, 2)}
        </pre>
      ) : null}
      <pre style={{ overflow: "auto", maxHeight: "80vh", whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data.raw, null, 2)}
      </pre>
    </div>
  );
}

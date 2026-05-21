type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type MetafieldRefType = "metaobject_reference" | "list.metaobject_reference";

/**
 * Detect whether the store's metafield definition for the given namespace/key
 * on products is singular or list. Defaults to "list.metaobject_reference" if
 * no definition is found (will be auto-created on first write).
 */
export async function detectMetafieldType(
  admin: AdminClient,
  namespace: string,
  key: string,
): Promise<MetafieldRefType> {
  try {
    const response = await admin.graphql(
      `#graphql
      query MetafieldDef($ns: String!, $key: String!) {
        metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: $ns, key: $key) {
          edges { node { type { name } } }
        }
      }`,
      { variables: { ns: namespace, key } },
    );
    const json = await response.json();
    const typeName = json.data?.metafieldDefinitions?.edges?.[0]?.node?.type?.name;
    if (typeName === "metaobject_reference" || typeName === "list.metaobject_reference") {
      console.log(`[price-tags] detectMetafieldType ${namespace}.${key} → ${typeName}`);
      return typeName;
    }
    console.log(`[price-tags] detectMetafieldType ${namespace}.${key} → no definition found (type=${typeName ?? "none"}), defaulting to list`);
    return "list.metaobject_reference";
  } catch (err) {
    console.warn(`[price-tags] detectMetafieldType failed, defaulting to list:`, err);
    return "list.metaobject_reference";
  }
}

/**
 * Find the product metafield definition that references the given metaobject type.
 * Returns the namespace/key/type of the first matching definition, or null if none found.
 */
export async function findProductMetafieldForMetaobjectType(
  admin: AdminClient,
  metaobjectType: string,
): Promise<{ namespace: string; key: string; type: MetafieldRefType } | null> {
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductMetafieldDefs {
        metafieldDefinitions(first: 100, ownerType: PRODUCT) {
          edges {
            node {
              namespace
              key
              type { name }
              validations { name value }
            }
          }
        }
      }`,
    );
    const json = await response.json();
    const edges = json.data?.metafieldDefinitions?.edges ?? [];

    for (const edge of edges) {
      const node = edge.node;
      const typeName = node.type?.name;
      if (typeName !== "metaobject_reference" && typeName !== "list.metaobject_reference") continue;

      // Check if this metafield def references our metaobject type
      const validations: Array<{ name: string; value: string }> = node.validations ?? [];
      for (const v of validations) {
        if (v.name === "metaobject_definition_id") {
          // value is a GID like "gid://shopify/MetaobjectDefinition/123"
          // We need to resolve it to the type string — but Shopify also stores
          // the type directly in some cases. Let's also check by querying.
          // For now, store this as a candidate and we'll verify below.
        }
        // Some stores use "metaobject_type" validation
        if ((v.name === "metaobject_definition_type" || v.name === "metaobject_type") && v.value === metaobjectType) {
          console.log(`[price-tags] findProductMetafield → matched ${node.namespace}.${node.key} (${typeName}) via validation`);
          return { namespace: node.namespace, key: node.key, type: typeName as MetafieldRefType };
        }
      }
    }

    // Fallback: resolve by querying the metaobject definition GID and matching
    // First get the definition GID for our type
    const defResponse = await admin.graphql(
      `#graphql
      query MetaobjectDefByType($type: String!) {
        metaobjectDefinitionByType(type: $type) { id }
      }`,
      { variables: { type: metaobjectType } },
    );
    const defJson = await defResponse.json();
    const defGid = defJson.data?.metaobjectDefinitionByType?.id;
    if (!defGid) {
      console.log(`[price-tags] findProductMetafield → metaobject definition not found for type=${metaobjectType}`);
      return null;
    }

    for (const edge of edges) {
      const node = edge.node;
      const typeName = node.type?.name;
      if (typeName !== "metaobject_reference" && typeName !== "list.metaobject_reference") continue;

      const validations: Array<{ name: string; value: string }> = node.validations ?? [];
      for (const v of validations) {
        if (v.name === "metaobject_definition_id" && v.value === defGid) {
          console.log(`[price-tags] findProductMetafield → matched ${node.namespace}.${node.key} (${typeName}) via definition GID`);
          return { namespace: node.namespace, key: node.key, type: typeName as MetafieldRefType };
        }
      }
    }

    console.log(`[price-tags] findProductMetafield → no product metafield definition references metaobject type=${metaobjectType}`);
    return null;
  } catch (err) {
    console.error(`[price-tags] findProductMetafield failed:`, err);
    return null;
  }
}

export async function setProductMetafield(
  admin: AdminClient,
  params: {
    productGid: string;
    namespace: string;
    key: string;
    metaobjectGid: string;
  },
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: params.productGid,
            namespace: params.namespace,
            key: params.key,
            type: "metaobject_reference",
            value: params.metaobjectGid,
          },
        ],
      },
    },
  );

  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];

  if (errors.length > 0) {
    console.error(`Failed to set metafield on ${params.productGid}:`, errors);
  }
}

export async function clearProductMetafield(
  admin: AdminClient,
  params: {
    productGid: string;
    namespace: string;
    key: string;
  },
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { ownerId namespace key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: params.productGid,
            namespace: params.namespace,
            key: params.key,
          },
        ],
      },
    },
  );

  const json = await response.json();
  const errors = json.data?.metafieldsDelete?.userErrors ?? [];

  if (errors.length > 0) {
    console.error(`Failed to clear metafield on ${params.productGid}:`, errors);
  }
}

export async function batchSetProductMetafields(
  admin: AdminClient,
  inputs: Array<{
    productGid: string;
    namespace: string;
    key: string;
    metaobjectGid: string;
  }>,
): Promise<void> {
  const CHUNK_SIZE = 25;

  for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
    const chunk = inputs.slice(i, i + CHUNK_SIZE);

    const metafields = chunk.map((input) => ({
      ownerId: input.productGid,
      namespace: input.namespace,
      key: input.key,
      type: "metaobject_reference",
      value: input.metaobjectGid,
    }));

    const response = await admin.graphql(
      `#graphql
      mutation BatchSetMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      { variables: { metafields } },
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors ?? [];

    if (errors.length > 0) {
      console.error(`Batch metafield set errors (chunk ${i / CHUNK_SIZE}):`, errors);
    }
  }
}

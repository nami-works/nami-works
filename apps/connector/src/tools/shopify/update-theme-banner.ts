import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Swaps a theme banner image without touching the Shopify theme editor —
 * addresses the 2026-07-31 incident where a routine banner swap took 1.5h
 * of manual theme-editor work (the visual editor froze repeatedly, one
 * accidental "Remover" click wiped a mobile image reference) because there
 * was no connector path for it.
 *
 * Two independent binding mechanisms exist in the GE Beauty theme (see
 * gebeauty/b2b/marketplace-registry-field-mapping.md's sibling incident
 * writeup for the discovery): a home-slideshow slide references an image
 * file directly in templates/index.json, while a collection banner reads
 * from a metafield. `mode` selects which one this call targets.
 */

const MAIN_THEME_QUERY = /* GraphQL */ `
  query MainTheme {
    themes(first: 1, roles: [MAIN]) {
      nodes { id role name }
    }
  }
`;

const THEME_FILE_QUERY = /* GraphQL */ `
  query ThemeFile($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      id
      role
      files(filenames: $filenames, first: 1) {
        nodes {
          filename
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
      }
    }
  }
`;

const THEME_FILES_UPSERT = /* GraphQL */ `
  mutation ThemeFilesUpsert(
    $themeId: ID!
    $files: [OnlineStoreThemeFilesUpsertFileInput!]!
  ) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

const COLLECTION_BY_HANDLE_QUERY = /* GraphQL */ `
  query CollectionByIdentifier($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) {
      id
      title
    }
  }
`;

const COLLECTION_METAFIELDS_QUERY = /* GraphQL */ `
  query CollectionMetafields(
    $id: ID!
    $nsDesktop: String!
    $keyDesktop: String!
    $nsMobile: String!
    $keyMobile: String!
  ) {
    collection(id: $id) {
      id
      title
      desktop: metafield(namespace: $nsDesktop, key: $keyDesktop) {
        reference { ... on MediaImage { id image { url } } }
      }
      mobile: metafield(namespace: $nsMobile, key: $keyMobile) {
        reference { ... on MediaImage { id image { url } } }
      }
    }
  }
`;

const FIND_FILE_QUERY = /* GraphQL */ `
  query FindFile($query: String!) {
    files(first: 1, query: $query) {
      nodes {
        __typename
        ... on MediaImage { id image { url } }
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation SetBannerMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message code }
    }
  }
`;

type MainThemeResponse = {
  themes: { nodes: Array<{ id: string; role: string; name: string }> };
};

type ThemeFileResponse = {
  theme: {
    id: string;
    role: string;
    files: { nodes: Array<{ filename: string; body: { content?: string } | null }> };
  } | null;
};

type ThemeFilesUpsertResponse = {
  themeFilesUpsert: {
    upsertedThemeFiles: Array<{ filename: string }>;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

type CollectionByIdentifierResponse = {
  collectionByIdentifier: { id: string; title: string } | null;
};

type CollectionMetafieldsResponse = {
  collection: {
    id: string;
    title: string;
    desktop: { reference: { id: string; image: { url: string } } | null } | null;
    mobile: { reference: { id: string; image: { url: string } } | null } | null;
  } | null;
};

type FindFileResponse = {
  files: {
    nodes: Array<{ __typename: string; id?: string; image?: { url: string } }>;
  };
};

type MetafieldsSetResponse = {
  metafieldsSet: {
    metafields: Array<{ id: string; key: string; namespace: string }>;
    userErrors: Array<{ field: string[] | null; message: string; code: string }>;
  };
};

function splitMetafieldKey(input: string): { namespace: string; key: string } {
  const idx = input.indexOf(".");
  if (idx === -1) {
    throw new Error(
      `Metafield key must be "namespace.key" (e.g. custom.banner_1). Got: ${input}`,
    );
  }
  return { namespace: input.slice(0, idx), key: input.slice(idx + 1) };
}

async function findMediaImageId(
  client: Awaited<ReturnType<typeof getShopifyClient>>,
  filename: string,
): Promise<{ id: string; url: string } | null> {
  const res = await client.request<FindFileResponse>(FIND_FILE_QUERY, {
    variables: { query: `filename:${filename}` },
  });
  if (res.errors) {
    throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`);
  }
  const node = (res.data?.files.nodes ?? []).find(
    (n) => n.__typename === "MediaImage" && n.id,
  );
  return node?.id && node.image ? { id: node.id, url: node.image.url } : null;
}

export async function updateThemeBannerHandler(
  args: {
    mode: "home_slide" | "collection_banner";
    imageFilename: string;
    imageFilenameMobile?: string | undefined;
    templateFile?: string | undefined;
    sectionId?: string | undefined;
    blockId?: string | undefined;
    collectionHandle?: string | undefined;
    desktopMetafieldKey?: string | undefined;
    mobileMetafieldKey?: string | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const mobileFilename = args.imageFilenameMobile ?? args.imageFilename;

  if (args.mode === "home_slide") {
    const templateFile = args.templateFile ?? "templates/index.json";
    if (!args.sectionId || !args.blockId) {
      return {
        content: [
          { type: "text", text: "mode=home_slide requires sectionId and blockId." },
        ],
        isError: true,
      };
    }

    const themeRes = await client.request<MainThemeResponse>(MAIN_THEME_QUERY);
    if (themeRes.errors) {
      throw new Error(`Shopify GraphQL error: ${themeRes.errors.message ?? "unknown error"}`);
    }
    const theme = themeRes.data?.themes.nodes[0];
    if (!theme) {
      return {
        content: [{ type: "text", text: "No theme with role MAIN found." }],
        isError: true,
      };
    }

    const fileRes = await client.request<ThemeFileResponse>(THEME_FILE_QUERY, {
      variables: { id: theme.id, filenames: [templateFile] },
    });
    if (fileRes.errors) {
      throw new Error(`Shopify GraphQL error: ${fileRes.errors.message ?? "unknown error"}`);
    }
    const content = fileRes.data?.theme?.files.nodes[0]?.body?.content;
    if (!content) {
      return {
        content: [
          { type: "text", text: `Could not read ${templateFile} from theme "${theme.name}" (role ${theme.role}).` },
        ],
        isError: true,
      };
    }

    const parsed = JSON.parse(content) as {
      sections?: Record<string, { blocks?: Record<string, { settings?: Record<string, unknown> }> }>;
    };
    const section = parsed.sections?.[args.sectionId];
    const block = section?.blocks?.[args.blockId];
    if (!section || !block) {
      return {
        content: [
          {
            type: "text",
            text: `Section "${args.sectionId}" / block "${args.blockId}" not found in ${templateFile} of theme "${theme.name}".`,
          },
        ],
        isError: true,
      };
    }

    block.settings ??= {};
    const before = {
      image: block.settings.image,
      image_mb: block.settings.image_mb,
    };
    const newImage = `shopify://shop_images/${args.imageFilename}`;
    const newImageMb = `shopify://shop_images/${mobileFilename}`;

    const summary = [
      `Theme: "${theme.name}" (role ${theme.role})`,
      `File: ${templateFile}`,
      `Section: ${args.sectionId} · Block: ${args.blockId}`,
      ``,
      `image:    ${before.image ?? "(none)"}  →  ${newImage}`,
      `image_mb: ${before.image_mb ?? "(none)"}  →  ${newImageMb}`,
    ].join("\n");

    if (args.confirm !== true) {
      return confirmationPreview({
        summary,
        actionLabel: `swap home slide banner (${args.sectionId}/${args.blockId})`,
      });
    }

    block.settings.image = newImage;
    block.settings.image_mb = newImageMb;

    const upsertRes = await client.request<ThemeFilesUpsertResponse>(THEME_FILES_UPSERT, {
      variables: {
        themeId: theme.id,
        files: [
          {
            filename: templateFile,
            body: { type: "TEXT", value: JSON.stringify(parsed) },
          },
        ],
      },
    });
    if (upsertRes.errors) {
      throw new Error(`Shopify GraphQL error: ${upsertRes.errors.message ?? "unknown error"}`);
    }
    const userErrors = upsertRes.data?.themeFilesUpsert.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        content: [
          { type: "text", text: `Failed: ${userErrors.map((e) => e.message).join("; ")}` },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Updated ${templateFile}.\n\n${summary}` }],
    };
  }

  // mode === "collection_banner"
  if (!args.collectionHandle) {
    return {
      content: [{ type: "text", text: "mode=collection_banner requires collectionHandle." }],
      isError: true,
    };
  }
  const desktopKey = splitMetafieldKey(args.desktopMetafieldKey ?? "custom.banner_1");
  const mobileKey = splitMetafieldKey(args.mobileMetafieldKey ?? "custom.banner_1_mb");

  const collectionRes = await client.request<CollectionByIdentifierResponse>(
    COLLECTION_BY_HANDLE_QUERY,
    { variables: { handle: args.collectionHandle } },
  );
  if (collectionRes.errors) {
    throw new Error(`Shopify GraphQL error: ${collectionRes.errors.message ?? "unknown error"}`);
  }
  const collection = collectionRes.data?.collectionByIdentifier;
  if (!collection) {
    return {
      content: [{ type: "text", text: `No collection found with handle "${args.collectionHandle}".` }],
      isError: true,
    };
  }

  const [desktopFile, mobileFile] = await Promise.all([
    findMediaImageId(client, args.imageFilename),
    findMediaImageId(client, mobileFilename),
  ]);
  if (!desktopFile) {
    return {
      content: [{ type: "text", text: `No Shopify Files image found matching filename "${args.imageFilename}".` }],
      isError: true,
    };
  }
  if (!mobileFile) {
    return {
      content: [{ type: "text", text: `No Shopify Files image found matching filename "${mobileFilename}".` }],
      isError: true,
    };
  }

  const currentRes = await client.request<CollectionMetafieldsResponse>(
    COLLECTION_METAFIELDS_QUERY,
    {
      variables: {
        id: collection.id,
        nsDesktop: desktopKey.namespace,
        keyDesktop: desktopKey.key,
        nsMobile: mobileKey.namespace,
        keyMobile: mobileKey.key,
      },
    },
  );
  if (currentRes.errors) {
    throw new Error(`Shopify GraphQL error: ${currentRes.errors.message ?? "unknown error"}`);
  }
  const current = currentRes.data?.collection;

  const summary = [
    `Collection: "${collection.title}" (${args.collectionHandle})`,
    ``,
    `${args.desktopMetafieldKey ?? "custom.banner_1"}:    ${current?.desktop?.reference?.image.url ?? "(none)"}  →  ${desktopFile.url}`,
    `${args.mobileMetafieldKey ?? "custom.banner_1_mb"}: ${current?.mobile?.reference?.image.url ?? "(none)"}  →  ${mobileFile.url}`,
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary,
      actionLabel: `swap collection banner for "${args.collectionHandle}"`,
    });
  }

  const setRes = await client.request<MetafieldsSetResponse>(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: collection.id,
          namespace: desktopKey.namespace,
          key: desktopKey.key,
          type: "file_reference",
          value: desktopFile.id,
        },
        {
          ownerId: collection.id,
          namespace: mobileKey.namespace,
          key: mobileKey.key,
          type: "file_reference",
          value: mobileFile.id,
        },
      ],
    },
  });
  if (setRes.errors) {
    throw new Error(`Shopify GraphQL error: ${setRes.errors.message ?? "unknown error"}`);
  }
  const userErrors = setRes.data?.metafieldsSet.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      content: [{ type: "text", text: `Failed: ${userErrors.map((e) => e.message).join("; ")}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: `Updated collection banner.\n\n${summary}` }],
  };
}

registerToolDefinition({
  name: "shopify_update_theme_banner",
  description:
    "Swap a theme banner image — either a home-slideshow slide (mode=home_slide, writes templates/index.json directly via themeFilesUpsert) or a collection's banner metafields (mode=collection_banner, writes custom.banner_1/_mb via metafieldsSet). Takes filenames of images already uploaded to Shopify Files — does not upload new images. Two-step: first call (no confirm) returns a preview; call again with confirm: true to apply.",
  inputSchema: {
    mode: z
      .enum(["home_slide", "collection_banner"])
      .describe("Which binding mechanism to target."),
    imageFilename: z
      .string()
      .min(1)
      .describe("Filename of the desktop image, already uploaded to Shopify Files (Content > Files)."),
    imageFilenameMobile: z
      .string()
      .optional()
      .describe("Filename of the mobile image. Defaults to imageFilename if omitted."),
    templateFile: z
      .string()
      .optional()
      .describe("mode=home_slide only. Theme template JSON file. Defaults to templates/index.json."),
    sectionId: z
      .string()
      .optional()
      .describe("mode=home_slide only. The section id in the template's sections map (e.g. slideshow_igYUMi)."),
    blockId: z
      .string()
      .optional()
      .describe("mode=home_slide only. The block id within that section (e.g. slide_XrHipC)."),
    collectionHandle: z
      .string()
      .optional()
      .describe("mode=collection_banner only. The collection's handle."),
    desktopMetafieldKey: z
      .string()
      .optional()
      .describe('mode=collection_banner only. "namespace.key" for the desktop banner metafield. Defaults to custom.banner_1.'),
    mobileMetafieldKey: z
      .string()
      .optional()
      .describe('mode=collection_banner only. "namespace.key" for the mobile banner metafield. Defaults to custom.banner_1_mb.'),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the change."),
  },
  handler: updateThemeBannerHandler,
});

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { readProposalFile } from "../retail-footprint/storage.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const proposalId = params.proposalId ?? "";

  if (!proposalId) {
    return new Response("Not found", { status: 404 });
  }

  const result = await readProposalFile(shop, proposalId);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  const { fileData, fileName, fileType } = result;
  const safeFileName = fileName.replace(/[^\w.\-]/g, "_");

  return new Response(new Uint8Array(fileData), {
    status: 200,
    headers: {
      "Content-Type": fileType,
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": String(fileData.length),
      "Cache-Control": "private, no-cache",
    },
  });
};

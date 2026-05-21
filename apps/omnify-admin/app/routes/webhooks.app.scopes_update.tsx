import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const verified = await verifyWebhookRequest(request);
    if (verified.response) return verified.response;

    const { payload, session, topic, shop } = verified.result;
    if (normalizeWebhookTopic(String(topic)) !== "APP_SCOPES_UPDATE") {
        return new Response("Unsupported webhook topic.", { status: 400 });
    }
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    if (session) {
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};

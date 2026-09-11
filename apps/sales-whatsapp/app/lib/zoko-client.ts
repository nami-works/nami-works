// Thin Zoko WhatsApp-template-send wrapper, ported from
// whatsapp_saleday.py's zoko_send() — same endpoint, same payload shape,
// same error-vs-exception split (network failure vs a real Zoko error
// response are reported differently so a caller can retry one and not the
// other, per handoff §3's "distinguish network failures from real
// userErrors" rule).
const ZOKO_ENDPOINT = "https://chat.zoko.io/v2/message";

export type ZokoSendResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; kind: "http_error"; status: number; body: unknown }
  | { ok: false; kind: "network_error"; error: string };

export async function zokoSendTemplate(params: {
  apiKey: string;
  recipient: string; // E.164, e.g. "+5581999999999"
  templateId: string;
  templateArgs: string[];
}): Promise<ZokoSendResult> {
  const { apiKey, recipient, templateId, templateArgs } = params;

  try {
    const res = await fetch(ZOKO_ENDPOINT, {
      method: "POST",
      headers: {
        apikey: apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel: "whatsapp",
        recipient,
        type: "buttonTemplate",
        templateId,
        templateLanguage: "pt_BR",
        templateArgs,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, kind: "http_error", status: res.status, body };
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, kind: "network_error", error: err instanceof Error ? err.message : String(err) };
  }
}

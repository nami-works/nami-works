/**
 * Intelipost adapter — first warehouse-carrier integration.
 *
 * API surface assumptions (per docs/plans/local-delivery-analytics.md §4.3):
 *   - Auth: `Authorization: ApiKey <key>` header.
 *   - Endpoint (default): https://api.intelipost.com.br
 *   - Sandbox: https://api-sandbox.intelipost.com.br
 *   - Quote endpoint: POST /api/v1/quote
 *
 * NOTE: actual request/response shape verified against Intelipost docs in §13.1.
 * `supportsSpeculativeQuoting` provisionally true; merchant confirms offline.
 *
 * Never logs API key, secret, postal codes, addresses, or full raw responses.
 */

import type {
  WarehouseCarrierAdapter,
  WarehouseCarrierCredentials,
  WarehouseQuoteError,
  WarehouseQuoteErrorCode,
  WarehouseQuoteRequest,
  WarehouseQuoteResult,
  WarehouseValidateResult,
} from "../types";

const DEFAULT_ENDPOINT = "https://api.intelipost.com.br";
const QUOTE_PATH = "/api/v1/quote";
const REQUEST_TIMEOUT_MS = 8_000;

// ASSUMPTION: Intelipost permits speculative quoting on arbitrary origin/destination
// without an active shipment in their system. Logged as §16 open item; flip to false
// + adjust state #3 copy if Lucas's offline verification (spec §13.1) returns 403/422.
const SUPPORTS_SPECULATIVE_QUOTING = true;

function buildEndpoint(creds: WarehouseCarrierCredentials, path: string): string {
  const base = (creds.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  return `${base}${path}`;
}

function authHeaders(creds: WarehouseCarrierCredentials): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "api-key": creds.apiKey,
  };
}

type IntelipostQuoteRequest = {
  origin_zip_code: string;
  destination_zip_code: string;
  volumes: Array<{
    weight: number; // kilograms
    quantity: number;
    cost_of_goods?: number; // major units
  }>;
  // Intelipost supports many other optional fields; we keep the request minimal.
};

type IntelipostQuoteOption = {
  delivery_method_id?: number;
  delivery_method_name?: string;
  delivery_method_type?: string;
  final_shipping_cost?: number;
  provider_shipping_cost?: number;
  delivery_estimate_business_days?: number;
  estimated_delivery_date?: { client?: string };
};

type IntelipostQuoteResponseContent = {
  id?: number;
  delivery_options?: IntelipostQuoteOption[];
};

type IntelipostQuoteEnvelope = {
  status?: string;
  messages?: Array<{ type?: string; text?: string }>;
  content?: IntelipostQuoteResponseContent | null;
};

function gramsToKilograms(grams: number): number {
  // Intelipost expects weight in kilograms with up to 3 decimals.
  return Math.round((grams / 1000) * 1000) / 1000;
}

function toMinorUnits(major: number | undefined): number {
  if (typeof major !== "number" || !Number.isFinite(major)) return 0;
  return Math.round(major * 100);
}

function buildIntelipostRequest(req: WarehouseQuoteRequest): IntelipostQuoteRequest {
  const totalWeightGrams = req.items.reduce(
    (acc, it) => acc + (it.weightGrams || 0) * (it.quantity || 1),
    0,
  );
  // If items array is empty, default to one 500g volume to avoid a 422 from
  // Intelipost — the dataset typically has weights but defending the call.
  const fallbackWeightGrams = totalWeightGrams > 0 ? totalWeightGrams : 500;
  const totalQty = req.items.reduce((acc, it) => acc + (it.quantity || 1), 0) || 1;
  const totalGoodsValueSubunits = req.items.reduce(
    (acc, it) => acc + (it.valueSubunits ?? 0) * (it.quantity || 1),
    0,
  );

  return {
    origin_zip_code: req.origin.postalCode.replace(/\D/g, ""),
    destination_zip_code: req.destination.postalCode.replace(/\D/g, ""),
    volumes: [
      {
        weight: gramsToKilograms(fallbackWeightGrams),
        quantity: totalQty,
        cost_of_goods:
          totalGoodsValueSubunits > 0 ? totalGoodsValueSubunits / 100 : undefined,
      },
    ],
  };
}

function selectCheapestOption(
  options: IntelipostQuoteOption[] | undefined,
): IntelipostQuoteOption | null {
  if (!options || options.length === 0) return null;
  return options.reduce<IntelipostQuoteOption | null>((cheapest, opt) => {
    const cost = opt.final_shipping_cost ?? opt.provider_shipping_cost;
    if (cost === undefined || cost === null) return cheapest;
    if (!cheapest) return opt;
    const cheapestCost = cheapest.final_shipping_cost ?? cheapest.provider_shipping_cost;
    if (cheapestCost === undefined || cheapestCost === null) return opt;
    return cost < cheapestCost ? opt : cheapest;
  }, null);
}

function classifyHttpStatus(status: number): WarehouseQuoteErrorCode {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 422) return "invalid_address";
  if (status === 429) return "rate_limit";
  return "unknown";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const IntelipostAdapter: WarehouseCarrierAdapter = {
  id: "intelipost",
  supportsSpeculativeQuoting: SUPPORTS_SPECULATIVE_QUOTING,

  async validateCredentials(creds: WarehouseCarrierCredentials): Promise<WarehouseValidateResult> {
    const url = buildEndpoint(creds, QUOTE_PATH);
    const probe: IntelipostQuoteRequest = {
      origin_zip_code: "01310100",
      destination_zip_code: "20040020",
      volumes: [{ weight: 0.5, quantity: 1 }],
    };
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: authHeaders(creds),
          body: JSON.stringify(probe),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: "auth_failed" };
      }
      if (res.status >= 500) {
        return { ok: false, reason: `provider_${res.status}` };
      }
      // 200 — credentials are good. 422 also implies auth passed.
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "network_error";
      return { ok: false, reason: message };
    }
  },

  async quote(
    creds: WarehouseCarrierCredentials,
    req: WarehouseQuoteRequest,
  ): Promise<WarehouseQuoteResult | WarehouseQuoteError> {
    if (req.isSpeculative && !SUPPORTS_SPECULATIVE_QUOTING) {
      return {
        provider: "intelipost",
        errorCode: "speculative_not_supported",
        message: "Provider does not permit speculative quoting.",
        retryable: false,
      };
    }
    const url = buildEndpoint(creds, QUOTE_PATH);
    const body = buildIntelipostRequest(req);
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: authHeaders(creds),
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      return {
        provider: "intelipost",
        errorCode: "network",
        message: error instanceof Error ? error.message : "network_error",
        retryable: true,
      };
    }

    if (!res.ok) {
      const code = classifyHttpStatus(res.status);
      let message = `provider_status_${res.status}`;
      try {
        const errBody = (await res.json()) as IntelipostQuoteEnvelope;
        const firstMsg = errBody.messages?.[0]?.text;
        if (firstMsg) message = firstMsg;
      } catch {
        // ignore body parse errors — status is enough
      }
      return {
        provider: "intelipost",
        errorCode: code,
        message,
        retryable: code === "rate_limit" || code === "unknown",
      };
    }

    let envelope: IntelipostQuoteEnvelope;
    try {
      envelope = (await res.json()) as IntelipostQuoteEnvelope;
    } catch (error) {
      return {
        provider: "intelipost",
        errorCode: "unknown",
        message: error instanceof Error ? error.message : "parse_error",
        retryable: true,
      };
    }

    if (envelope.status && envelope.status.toUpperCase() !== "OK") {
      const msg = envelope.messages?.[0]?.text ?? "provider_error";
      return {
        provider: "intelipost",
        errorCode: msg.toLowerCase().includes("zip") ? "invalid_address" : "unknown",
        message: msg,
        retryable: false,
      };
    }

    const cheapest = selectCheapestOption(envelope.content?.delivery_options);
    if (!cheapest) {
      return {
        provider: "intelipost",
        errorCode: "out_of_zone",
        message: "no_delivery_options_returned",
        retryable: false,
      };
    }

    const cost = cheapest.final_shipping_cost ?? cheapest.provider_shipping_cost ?? 0;
    return {
      provider: "intelipost",
      priceSubunits: toMinorUnits(cost),
      currency: req.currency,
      minDeliveryDate: cheapest.estimated_delivery_date?.client,
      maxDeliveryDate: cheapest.estimated_delivery_date?.client,
      raw: envelope.content ?? undefined,
    };
  },
};

// Exported for tests.
export const __testables = {
  buildIntelipostRequest,
  selectCheapestOption,
  classifyHttpStatus,
  toMinorUnits,
  gramsToKilograms,
};

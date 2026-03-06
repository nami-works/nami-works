import crypto from "crypto";

export type LalamoveStop = {
  coordinates: { lat: string; lng: string };
  address: string;
  waitTime?: number; // optional per-stop wait time in seconds (Lalamove v3 API)
};

export type LalamoveQuotationRequest = {
  market: string;
  language: string;
  serviceType: string;
  stops: LalamoveStop[];
  isRouteOptimized?: boolean;
};

export type LalamoveQuotationResponse = {
  quotationId: string;
  expiresAt: string;
  scheduleAt?: string;
  serviceType?: string;
  language?: string;
  stops?: Array<{
    stopId?: string;
    coordinates?: { lat?: string; lng?: string };
    address?: string;
  }>;
  priceBreakdown?: {
    total?: string;
    currency?: string;
  };
  distance?: { value: string; unit: string };
};

export type LalamoveOrderContact = {
  stopId: string;
  name: string;
  phone: string;
  remarks?: string;
};

export type LalamovePlaceOrderRequest = {
  market: string;
  quotationId: string;
  sender: LalamoveOrderContact;
  recipients: LalamoveOrderContact[];
  isPODEnabled?: boolean;
  partner?: string;
  metadata?: Record<string, string>;
};

export type LalamovePlaceOrderResponse = {
  orderId: string;
  quotationId: string;
  status: string;
  driverId?: string;
  shareLink?: string;
  priceBreakdown?: {
    total?: string;
    currency?: string;
    priorityFee?: string;
  };
  distance?: { value: string; unit: string };
  stops?: Array<{
    stopId?: string;
    address?: string;
    name?: string;
    phone?: string;
    POD?: { status?: string; deliveredAt?: string; image?: string };
  }>;
};

export type LalamoveOrderDetailsResponse = LalamovePlaceOrderResponse & {
  metadata?: Record<string, string>;
  remarks?: string[];
};

export type LalamoveCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type LalamoveEnvironment = "sandbox" | "production";

export type LalamoveErrorDetails = {
  status: number | null;
  code?: string;
  retryable: boolean;
  message: string;
};

export type LalamoveProbeResult =
  | { ok: true; details?: { warning?: string } }
  | { ok: false; error: string; details?: LalamoveErrorDetails };

const toSignature = (
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
) => {
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  return crypto.createHmac("sha256", secret).update(rawSignature).digest("hex");
};

export const buildLalamoveSignature = (
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
) => toSignature(secret, timestamp, method, path, body);

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const getBaseUrl = () => {
  const raw = process.env.LALAMOVE_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : "https://rest.lalamove.com";
  return normalizeBaseUrl(base);
};

const getCredentials = (credentials?: LalamoveCredentials) => {
  if (credentials?.apiKey?.trim() && credentials?.apiSecret?.trim()) {
    return {
      apiKey: credentials.apiKey.trim(),
      apiSecret: credentials.apiSecret.trim(),
    };
  }
  const apiKey = process.env.LALAMOVE_API_KEY?.trim();
  const apiSecret = process.env.LALAMOVE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Missing Lalamove API credentials.");
  }
  return { apiKey, apiSecret };
};

const readErrorMessage = (payload: any, fallback: string) => {
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    if (typeof first?.message === "string" && first.message) return first.message;
    if (typeof first?.detail === "string" && first.detail) return first.detail;
  }
  return fallback;
};

const classifyError = (
  status: number,
  message: string,
): Omit<LalamoveErrorDetails, "message"> => {
  if (status === 429) {
    return { status, code: "rate_limited", retryable: true };
  }
  if (status >= 500) {
    return { status, code: "server_error", retryable: true };
  }
  if (status === 401) {
    return { status, code: "unauthorized", retryable: false };
  }
  if (status === 403) {
    return { status, code: "forbidden", retryable: false };
  }
  if (status === 422) {
    return { status, code: "validation_error", retryable: false };
  }
  if (/timeout|network|fetch failed|temporar/i.test(message)) {
    return { status, code: "transient_network", retryable: true };
  }
  return { status, code: "unknown", retryable: false };
};

export const normalizeLalamoveError = (
  status: number | null,
  message: string,
): LalamoveErrorDetails => {
  const classified = classifyError(status ?? 0, message);
  return { ...classified, status, message };
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const sanitizeLalamoveErrorMessage = (message: string) => {
  let value = message;
  value = value.replace(/hmac\s+[A-Za-z0-9:_-]+/gi, "hmac [redacted]");
  value = value.replace(/(api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]");
  return value;
};

export const detectLalamoveEnvironmentFromBaseUrl = (
  rawBaseUrl: string | null | undefined,
): LalamoveEnvironment => {
  const value = (rawBaseUrl ?? "").toLowerCase();
  if (value.includes("sandbox")) return "sandbox";
  return "production";
};

export const detectLalamoveCredentialPrefixMismatch = (
  apiKey: string,
  apiSecret: string,
  environment: LalamoveEnvironment,
): string | null => {
  const key = apiKey.trim();
  const secret = apiSecret.trim();
  const testPrefix = key.startsWith("pk_test") || secret.startsWith("sk_test");
  const prodPrefix = key.startsWith("pk_prod") || secret.startsWith("sk_prod");
  if (environment === "production" && testPrefix) {
    return "Detected sandbox credentials (`pk_test` / `sk_test`) with production Lalamove host. Use production keys or switch host to sandbox.";
  }
  if (environment === "sandbox" && prodPrefix) {
    return "Detected production credentials (`pk_prod` / `sk_prod`) with sandbox Lalamove host. Use sandbox keys or switch host to production.";
  }
  return null;
};

/**
 * ITU-T country calling codes for each Lalamove market.
 * Keys are the market codes used in the Lalamove API (uppercase).
 */
export const LALAMOVE_MARKET_COUNTRY_CODE: Record<string, string> = {
  BR: "55",  // Brazil
  SG: "65",  // Singapore
  MY: "60",  // Malaysia
  PH: "63",  // Philippines
  TH: "66",  // Thailand
  VN: "84",  // Vietnam
  HK: "852", // Hong Kong
  TW: "886", // Taiwan
  ID: "62",  // Indonesia
  JP: "81",  // Japan
  KR: "82",  // South Korea
  MX: "52",  // Mexico
};

/**
 * Normalize a phone number to E.164 format for Lalamove API submission.
 *
 * When `market` is provided and maps to a known country code, the function
 * ensures the digit string starts with the correct country dialing prefix.
 * Numbers that already carry the correct prefix are left unchanged.
 * Numbers missing the prefix have it prepended.
 *
 * When `market` is absent or unknown, legacy behavior applies: strip
 * non-digit characters and prepend `+`.
 *
 * Examples (market = "BR", country code = "55"):
 *   "11966208929"     -> "+5511966208929"   (missing prefix, added)
 *   "+5511966208929"  -> "+5511966208929"   (correct prefix, unchanged)
 *   "5511966208929"   -> "+5511966208929"   (correct digits without +)
 *   "+21994683997"    -> "+5521994683997"   (wrong prefix, corrected)
 */
export function normalizePhoneToE164(
  phone: string | null | undefined,
  market?: string | null,
): string {
  if (phone == null || typeof phone !== "string") return "";
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length === 0) return "";

  if (market) {
    const countryCode =
      LALAMOVE_MARKET_COUNTRY_CODE[market.trim().toUpperCase()];
    if (countryCode) {
      return digitsOnly.startsWith(countryCode)
        ? `+${digitsOnly}`
        : `+${countryCode}${digitsOnly}`;
    }
  }

  return `+${digitsOnly}`;
}

const lalamoveRequest = async <TResponse>(
  method: "GET" | "POST" | "DELETE",
  market: string,
  path: string,
  bodyData?: Record<string, unknown>,
  credentials?: LalamoveCredentials,
): Promise<TResponse> => {
  const { apiKey, apiSecret } = getCredentials(credentials);
  const timestamp = Date.now().toString();
  const body =
    method === "GET" || method === "DELETE"
      ? ""
      : JSON.stringify({
          data: bodyData ?? {},
        });
  const signature = toSignature(apiSecret, timestamp, method, path, body);
  const token = `${apiKey}:${timestamp}:${signature}`;

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `hmac ${token}`,
      Market: market,
      "Request-ID": crypto.randomUUID(),
    },
    ...(method === "GET" || method === "DELETE" ? {} : { body }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      `${response.status}: ${readErrorMessage(
        payload,
        `Lalamove ${method} ${path} failed.`,
      )}`,
    );
  }
  return payload.data as TResponse;
};

export const createLalamoveQuotation = async (
  request: LalamoveQuotationRequest,
  credentials?: LalamoveCredentials,
) => {
  return lalamoveRequest<LalamoveQuotationResponse>(
    "POST",
    request.market,
    "/v3/quotations",
    {
      language: request.language,
      serviceType: request.serviceType,
      stops: request.stops,
      isRouteOptimized: Boolean(request.isRouteOptimized),
    },
    credentials,
  );
};

export const placeLalamoveOrder = async (
  request: LalamovePlaceOrderRequest,
  credentials?: LalamoveCredentials,
) => {
  const { market } = request;
  const sender = {
    stopId: request.sender.stopId,
    name: request.sender.name,
    phone:
      normalizePhoneToE164(request.sender.phone, market) ||
      request.sender.phone,
  };
  const recipients = request.recipients.map((r) => ({
    stopId: r.stopId,
    name: r.name,
    phone: normalizePhoneToE164(r.phone, market) || r.phone,
    ...(r.remarks?.trim() ? { remarks: r.remarks.trim() } : {}),
  }));
  return lalamoveRequest<LalamovePlaceOrderResponse>(
    "POST",
    request.market,
    "/v3/orders",
    {
      quotationId: request.quotationId,
      sender,
      recipients,
      isPODEnabled: Boolean(request.isPODEnabled),
      ...(request.partner ? { partner: request.partner } : {}),
      ...(request.metadata ? { metadata: request.metadata } : {}),
    },
    credentials,
  );
};

export const getLalamoveOrderDetails = async (
  market: string,
  orderId: string,
  credentials?: LalamoveCredentials,
) => {
  const safeOrderId = encodeURIComponent(orderId);
  return lalamoveRequest<LalamoveOrderDetailsResponse>(
    "GET",
    market,
    `/v3/orders/${safeOrderId}`,
    undefined,
    credentials,
  );
};

export const cancelLalamoveOrder = async (
  market: string,
  orderId: string,
  credentials?: LalamoveCredentials,
): Promise<void> => {
  const safeOrderId = encodeURIComponent(orderId);
  await lalamoveRequest<unknown>(
    "DELETE",
    market,
    `/v3/orders/${safeOrderId}`,
    undefined,
    credentials,
  );
};

export const addLalamovePriorityFee = async (
  market: string,
  orderId: string,
  feeAmount: string,
  credentials?: LalamoveCredentials,
): Promise<void> => {
  const safeOrderId = encodeURIComponent(orderId);
  await lalamoveRequest<unknown>(
    "POST",
    market,
    `/v3/orders/${safeOrderId}/priority-fee`,
    { priorityFee: feeAmount },
    credentials,
  );
};

export const probeLalamoveCredentials = async (
  market: string,
  credentials: LalamoveCredentials,
): Promise<LalamoveProbeResult> => {
  const environment = detectLalamoveEnvironmentFromBaseUrl(
    process.env.LALAMOVE_BASE_URL,
  );
  const mismatchWarning = detectLalamoveCredentialPrefixMismatch(
    credentials.apiKey,
    credentials.apiSecret,
    environment,
  );

  const attempts = [0, 250, 750];
  let lastFailure: LalamoveErrorDetails | null = null;

  for (let i = 0; i < attempts.length; i += 1) {
    if (attempts[i] > 0) {
      await sleep(attempts[i]);
    }
    try {
      // Use a non-existing order path: 404 means auth passed and endpoint is reachable.
      await lalamoveRequest<unknown>(
        "GET",
        market,
        "/v3/orders/non-existent",
        undefined,
        credentials,
      );
      return mismatchWarning
        ? { ok: true, details: { warning: mismatchWarning } }
        : { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to validate credentials.";
      const safeMessage = sanitizeLalamoveErrorMessage(message);
      const statusMatch = safeMessage.match(/^(\d{3})\s*:/);
      const status = statusMatch ? Number(statusMatch[1]) : null;

      if (status === 404 || /404|not found|resource/i.test(safeMessage)) {
        return mismatchWarning
          ? { ok: true, details: { warning: mismatchWarning } }
          : { ok: true };
      }

      lastFailure = normalizeLalamoveError(status, safeMessage);

      if (!lastFailure.retryable || i === attempts.length - 1) {
        break;
      }
    }
  }

  if (lastFailure?.status === 401 || lastFailure?.status === 403) {
    return {
      ok: false,
      error: "Invalid Lalamove API key/secret or signature mismatch.",
      details: lastFailure,
    };
  }
  if (lastFailure?.status === 422) {
    return {
      ok: false,
      error: "Lalamove rejected the request fields (market/service configuration).",
      details: lastFailure,
    };
  }
  if (lastFailure?.status === 429) {
    return {
      ok: false,
      error: "Lalamove rate limit reached. Please wait and try again.",
      details: lastFailure,
    };
  }
  if (lastFailure) {
    return {
      ok: false,
      error: "Unable to validate credentials right now. Please try again.",
      details: lastFailure,
    };
  }
  return {
    ok: false,
    error: "Unable to validate credentials.",
    details: { status: null, retryable: false, message: "Unknown error" },
  };
};

// @ts-nocheck — vendored from cpg-labs; passes their typecheck. Re-enable after fixing exactOptionalPropertyTypes drift if needed.
import crypto from "crypto";

export type LalamoveStop = {
  coordinates: { lat: string; lng: string };
  address: string;
  remarks?: string;
  sourceAddress2?: string | null;
};

export type LalamoveQuotationRequest = {
  market: string;
  language: string;
  serviceType: string;
  stops: LalamoveStop[];
  isRouteOptimized?: boolean;
  specialRequests?: string[];
};

export type LalamoveSpecialRequest = {
  name: string;
  description: string;
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

export class LalamoveApiError extends Error {
  public readonly status: number;
  public readonly payload: any;
  constructor(status: number, message: string, payload: any) {
    super(`${status}: ${message}`);
    this.name = "LalamoveApiError";
    this.status = status;
    this.payload = payload;
  }
}

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

const enrichStopAddressWithAddress2 = (
  value: string,
  address2?: string | null,
) => {
  const normalizedValue = value.trim();
  const normalizedAddress2 = (address2 ?? "").trim();
  if (!normalizedAddress2) return normalizedValue;
  return `${normalizedValue} • ${normalizedAddress2}`;
};

export const buildLalamoveRecipientRemarks = (
  index: number,
  pickupInstructions: string | null | undefined,
  _deliveryAddress2: string | null | undefined,
) => {
  const normalizedPickup = pickupInstructions?.trim() ?? "";
  if (index === 0) {
    return normalizedPickup.length > 0 ? normalizedPickup : undefined;
  }
  return undefined;
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
 * If the phone already starts with "+", it is assumed to be a valid
 * international number and is returned as-is (only non-digit characters
 * other than the leading "+" are stripped). This avoids mangling foreign
 * numbers (e.g. a Portuguese +353 number in a BR market).
 *
 * When the phone does NOT start with "+" and `market` is provided, the
 * market's country dialing prefix is prepended to the local number.
 *
 * Examples (market = "BR", country code = "55"):
 *   "11966208929"     -> "+5511966208929"   (local number, prefix added)
 *   "+5511966208929"  -> "+5511966208929"   (already international, unchanged)
 *   "5511966208929"   -> "+5511966208929"   (digits with country code, prefix added)
 *   "+35312345678"    -> "+35312345678"     (foreign number, preserved as-is)
 */
export function normalizePhoneToE164(
  phone: string | null | undefined,
  market?: string | null,
): string {
  if (phone == null || typeof phone !== "string") return "";
  const trimmed = phone.trim();
  if (trimmed.length === 0) return "";

  // If the phone already has a "+" prefix, trust it as an international number.
  if (trimmed.startsWith("+")) {
    const cleaned = "+" + trimmed.slice(1).replace(/\D/g, "");
    return cleaned.length > 1 ? cleaned : "";
  }

  const digitsOnly = trimmed.replace(/\D/g, "");
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

/**
 * Check whether an E.164 phone number belongs to the expected market.
 * Returns true when the phone's country calling code matches the market's
 * code, or when the market has no known code (permissive fallback).
 */
export function isPhoneValidForMarket(
  e164Phone: string,
  market: string | null | undefined,
): boolean {
  if (!e164Phone || !market) return true;
  const expectedCode =
    LALAMOVE_MARKET_COUNTRY_CODE[market.trim().toUpperCase()];
  if (!expectedCode) return true;
  const digits = e164Phone.replace(/^\+/, "");
  return digits.startsWith(expectedCode);
}

/**
 * Normalize a phone for a specific Lalamove market.
 * If the phone is valid E.164 but belongs to a DIFFERENT country than the
 * market expects (e.g. US +1 phone in BR market), returns empty string so
 * callers can fall back to the store's location phone.
 */
export function normalizePhoneForMarket(
  phone: string | null | undefined,
  market?: string | null,
): string {
  const normalized = normalizePhoneToE164(phone, market);
  if (!normalized || !market) return normalized;
  if (!isPhoneValidForMarket(normalized, market)) {
    console.warn(
      `[lalamove] phone rejected for market mismatch: phone=${normalized.slice(0, 4)}*** market=${market}`,
    );
    return "";
  }
  return normalized;
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

  console.log(`[lalamove] ${method} ${path} market=${market}`);
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
    const errMsg = readErrorMessage(payload, `Lalamove ${method} ${path} failed.`);
    console.error(`[lalamove] ${method} ${path} → ${response.status}: ${errMsg}`);
    throw new LalamoveApiError(response.status, errMsg, payload);
  }
  console.log(`[lalamove] ${method} ${path} → ${response.status} ok`);
  return (payload?.data ?? null) as TResponse;
};

export const createLalamoveQuotation = async (
  request: LalamoveQuotationRequest,
  credentials?: LalamoveCredentials,
) => {
  const stops = request.stops.map((stop, index) => ({
    coordinates: {
      lat: stop.coordinates.lat,
      lng: stop.coordinates.lng,
    },
    address: enrichStopAddressWithAddress2(stop.address, stop.sourceAddress2),
    ...(stop.remarks?.trim()
      ? {
          remarks: stop.remarks.trim(),
        }
      : {}),
  }));
  const result = await lalamoveRequest<LalamoveQuotationResponse>(
    "POST",
    request.market,
    "/v3/quotations",
    {
      language: request.language,
      serviceType: request.serviceType,
      stops,
      isRouteOptimized: Boolean(request.isRouteOptimized),
      ...(request.specialRequests?.length
        ? { specialRequests: request.specialRequests }
        : {}),
    },
    credentials,
  );
  console.info(`[lalamove] quotation → id=${result.quotationId} total=${result.priceBreakdown?.total ?? "?"} ${result.priceBreakdown?.currency ?? ""} stops=${stops.length}`);
  return result;
};

export const placeLalamoveOrder = async (
  request: LalamovePlaceOrderRequest,
  credentials?: LalamoveCredentials,
) => {
  const { market } = request;
  const sender = {
    stopId: request.sender.stopId,
    name: request.sender.name,
    phone: normalizePhoneForMarket(request.sender.phone, market) || request.sender.phone,
    ...(request.sender.remarks?.trim()
      ? {
          remarks: request.sender.remarks.trim(),
        }
      : {}),
  };
  const recipients = request.recipients.map((r, index) => ({
    stopId: r.stopId,
    name: r.name,
    phone: normalizePhoneForMarket(r.phone, market) || r.phone,
    ...(r.remarks?.trim()
      ? {
          remarks: r.remarks.trim(),
        }
      : {}),
  }));
  const result = await lalamoveRequest<LalamovePlaceOrderResponse>(
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
  console.info(`[lalamove] order placed → id=${result.orderId} status=${result.status}`);
  return result;
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

export type LalamoveDriverDetailsResponse = {
  driverId?: string;
  name?: string;
  phone?: string;
  plateNumber?: string;
  photo?: string;
  coordinates?: { lat?: string; lng?: string; updatedAt?: string };
};

export const getLalamoveDriverDetails = async (
  market: string,
  orderId: string,
  driverId: string,
  credentials?: LalamoveCredentials,
) => {
  const safeOrderId = encodeURIComponent(orderId);
  const safeDriverId = encodeURIComponent(driverId);
  return lalamoveRequest<LalamoveDriverDetailsResponse>(
    "GET",
    market,
    `/v3/orders/${safeOrderId}/drivers/${safeDriverId}`,
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
  console.info(`[lalamove] order cancelled → ${orderId}`);
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

  console.warn(`[lalamove] credential probe failed → status=${lastFailure?.status ?? "unknown"} code=${lastFailure?.code ?? "unknown"}`);
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

// ─── City Info (special requests per market) ────────────────────────────────

export type LalamoveCityService = {
  key: string;
  description?: string;
  specialRequests?: LalamoveSpecialRequest[];
};

export type LalamoveCityInfo = {
  locode: string;
  name?: string;
  services: LalamoveCityService[];
};

export const getLalamoveCityInfo = async (
  market: string,
  credentials?: LalamoveCredentials,
): Promise<LalamoveCityInfo[]> => {
  return lalamoveRequest<LalamoveCityInfo[]>(
    "GET",
    market,
    "/v3/cities",
    undefined,
    credentials,
  );
};

const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Validate special requests against the specific city+service available options
 * from the /v3/cities endpoint. Filters out requests not available for the
 * location's city, so e.g. Recife won't attempt wait-time (only supported in
 * Rio/SP for LALAGO).
 */
export const resolveSpecialRequestsForCity = async (
  allRequests: string[],
  config: { market: string; city?: string | null; preferredServiceType?: string },
  credentials: LalamoveCredentials,
): Promise<string[]> => {
  if (allRequests.length === 0) return [];

  try {
    const cities = await getLalamoveCityInfo(config.market, credentials);
    const locationCity = stripAccents(
      (config.city ?? "").trim().toLowerCase(),
    );
    const serviceType = config.preferredServiceType;

    console.info(
      `[lalamove] resolveSpecialRequests: market=${config.market} city=${locationCity || "?"} service=${serviceType ?? "?"} input=[${allRequests.join(", ")}]`,
    );

    const collectAvailable = (
      ignoreCity: boolean,
    ): { availableNames: Set<string>; matchedCityCount: number } => {
      const availableNames = new Set<string>();
      let matchedCityCount = 0;
      for (const city of cities) {
        if (!ignoreCity && locationCity) {
          const matchesLocode =
            stripAccents(city.locode?.toLowerCase() ?? "") === locationCity;
          const matchesName =
            stripAccents(city.name?.trim().toLowerCase() ?? "") === locationCity;
          if (!matchesLocode && !matchesName) continue;
        }
        matchedCityCount += 1;
        for (const service of city.services ?? []) {
          if (serviceType && service.key !== serviceType) continue;
          for (const sr of service.specialRequests ?? []) {
            availableNames.add(sr.name);
          }
        }
      }
      return { availableNames, matchedCityCount };
    };

    let { availableNames, matchedCityCount } = collectAvailable(false);

    // Safety net: if the location's city does not match any city in /v3/cities,
    // the first pass collects zero cities and every request would get filtered
    // out. Treat that case the same as "no city set" — accept all requests from
    // every city in the market. Matches the "one setting per market" intent.
    if (locationCity && matchedCityCount === 0) {
      console.warn(
        `[lalamove] resolveSpecialRequests: city "${locationCity}" not found in /v3/cities response — falling back to market-wide list market=${config.market}`,
      );
      ({ availableNames } = collectAvailable(true));
    }

    const filtered = allRequests.filter((sr) => availableNames.has(sr));
    if (filtered.length !== allRequests.length) {
      const removed = allRequests.filter((sr) => !availableNames.has(sr));
      console.warn(
        `[lalamove] resolveSpecialRequests: filtered out [${removed.join(", ")}] for city=${locationCity || "?"} service=${serviceType ?? "?"}`,
      );
    }

    return filtered;
  } catch (err) {
    console.warn("[lalamove] resolveSpecialRequests: city info fetch failed, proceeding with all requests", err);
    return allRequests;
  }
};

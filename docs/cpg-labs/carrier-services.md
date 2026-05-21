# Carrier Services Integration Docs

Reference for all carrier/delivery platform integrations used in Omnify.

---

## Lalamove

**Sources:** https://developers.lalamove.com/ · https://github.com/lalamove/api-examples/tree/master/nodejs · https://www.npmjs.com/package/@lalamove/lalamove-js

### Base URLs

| Environment | URL |
|-------------|-----|
| Sandbox | `https://rest.sandbox.lalamove.com` |
| Production | `https://rest.lalamove.com` |

All endpoints under `/v3/`. HTTPS only — HTTP requests fail.

### Authentication (HMAC-SHA256)

Credentials: `API_KEY` (prefix `pk_test` / `pk_prod`) and `API_SECRET` (prefix `sk_test` / `sk_prod`).

**Signature formula:**
```
RAW = "<TIMESTAMP_MS>\r\n<METHOD>\r\n<PATH>\r\n\r\n<BODY>"
SIGNATURE = HmacSHA256(RAW, API_SECRET)  // lowercase hex
TOKEN = API_KEY + ":" + TIMESTAMP_MS + ":" + SIGNATURE
```

**Required headers on every request:**
```
Authorization: hmac <TOKEN>
Market: <MARKET_CODE>        // UN/LOCODE, e.g. SG_SIN, HK_HKG
Request-ID: <NONCE>          // unique per request
Content-Type: application/json
```

**Node.js auth snippet (using axios + crypto-js):**
```js
import CryptoJS from 'crypto-js';

function buildHeaders(method, path, body, apiKey, secret) {
  const ts = Date.now().toString();
  const raw = `${ts}\r\n${method.toUpperCase()}\r\n${path}\r\n\r\n${body}`;
  const sig = CryptoJS.HmacSHA256(raw, secret).toString();
  const token = `${apiKey}:${ts}:${sig}`;
  return {
    Authorization: `hmac ${token}`,
    'Content-Type': 'application/json',
    'Request-ID': crypto.randomUUID(),
    Market: 'SG_SIN', // adjust per market
  };
}
```

### Core Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v3/quotations` | Request delivery quotation (5-min price lock) |
| GET | `/v3/quotations/{id}` | Retrieve quotation details |
| POST | `/v3/orders` | Place order using a quotation ID |
| GET | `/v3/orders/{id}` | Get order status/details |
| PATCH | `/v3/orders/{id}` | Edit order (once only) |
| DELETE | `/v3/orders/{id}` | Cancel order |
| POST | `/v3/orders/{id}/priority-fee` | Add tip/priority fee |
| GET | `/v3/orders/{id}/drivers/{driverId}` | Get driver details |
| DELETE | `/v3/orders/{id}/drivers/{driverId}` | Change driver |
| GET | `/v3/cities` | City config / available services |
| PATCH | `/v3/webhook` | Configure webhook URL |

### Quotation Request (POST /v3/quotations)

```json
{
  "serviceType": "MOTORCYCLE",
  "language": "en_SG",
  "stops": [
    {
      "coordinates": { "lat": "1.3369789", "lng": "103.8559788" },
      "address": "Sender address"
    },
    {
      "coordinates": { "lat": "1.2878377", "lng": "103.8503716" },
      "address": "Recipient address"
    }
  ],
  "isRouteOptimized": true
}
```

**Quotation stops** accept only `coordinates` and `address` per stop. Do not send `remarks` — the API returns 422 `additionalProperties 'remarks' not allowed`. Use `remarks` in the Order API recipients instead.

Response includes `quotationId` and `stopIds` — both required for order placement.

### Order Request (POST /v3/orders)

```json
{
  "quotationId": "<from quotation response>",
  "sender": {
    "stopId": "<stopId from quotation>",
    "name": "Sender Name",
    "phone": "+6512345678"
  },
  "recipients": [
    {
      "stopId": "<stopId from quotation>",
      "name": "Recipient Name",
      "phone": "+6598765432",
      "remarks": "Leave at door"
    }
  ],
  "isPODEnabled": false,
  "metadata": { "orderId": "shop-order-123" }
}
```

**Order recipients** (DeliveryDetails) may include optional `remarks` for delivery instructions (e.g. building, floor, apartment). Quotation stops do not support remarks.

### Omnify posting rules (Local Delivery)

- `recipients[0].remarks` sends only location `pickupInstructions`.
- `recipients[n>0].remarks` sends only the matched order's `shippingAddress.address2` (when present).
- Omnify stores an explicit optimized `stopId -> orderId` assignment from quotation before placing the order, so `address2` is attached to the correct recipient after route optimization.

### Order Status Flow

```
ASSIGNING_DRIVER → ON_GOING → PICKED_UP → COMPLETED
                                         → CANCELED / REJECTED / EXPIRED
```

**Cancellation rules:** Only allowed when status is `ASSIGNING_DRIVER`, OR matched less than 5 minutes ago.

### Rate Limits

| API | Sandbox (req/min) | Production (req/min) |
|-----|-------------------|----------------------|
| Quotation | 30 | 100 |
| Place Order | 30 | 100 |
| Get Order | 50 | 300 |
| Get Driver | 50 | 300 |
| Change Driver | 30 | 100 |
| Cancel Order | 30 | 100 |

Max 2 order submissions per second.

### Markets / Coverage

11 markets (UN/LOCODE format):

| Market | Code |
|--------|------|
| Singapore | SG_SIN |
| Hong Kong | HK_HKG |
| Malaysia | MY_KUL |
| Philippines | PH_MNL |
| Thailand | TH_BKK |
| Vietnam | VN_HAN / VN_SGN |
| Indonesia | ID_JKT |
| Taiwan | TW_TPE |
| Japan | JP_TYO |
| Mexico | MX_MEX |
| Brazil | BR_SAO |

### Key Constraints

- Phone numbers: E.164 format with country code (`+6512345678`)
- Timestamps: UTC, Unix milliseconds
- Stops: min 2, max 16 per delivery
- Scheduled orders: up to 30 days ahead
- Order IDs: extended to 19 digits (rollout Sept–Nov 2025 by market)
- Coordinates: up to 15 decimal precision

### Official SDK — `@lalamove/lalamove-js` v1.1.0

```bash
npm install @lalamove/lalamove-js
```

**Available modules and methods:**

```ts
import { Quotation, Order, Driver, Market, City } from '@lalamove/lalamove-js';

// Quotations
Quotation.create(market, quotationPayload)
Quotation.retrieve(market, quotationId)

// Orders
Order.create(market, orderPayload)
Order.retrieve(market, orderId)
Order.edit(market, orderId, patchPayload)
Order.addPriorityFee(market, orderId, fee)
Order.cancel(market, orderId)

// Drivers
Driver.retrieve(market, driverId, orderId)
Driver.cancel(market, driverId, orderId)   // change driver

// Market / City
Market.retrieve(market)
City.retrieve(market, cityId)
```

SDK repo: https://github.com/lalamove/delivery-nodejs-sdk

### Webhooks

Configure via `PATCH /v3/webhook`. Events fired on order status changes. Payload includes `orderId`, `status`, `driverId` when assigned.

### Support

- Production SLA: 2-hour response, 8-hour resolution
- Contact: `partner.support@lalamove.com`
- Sandbox credentials: obtain from Lalamove developer portal

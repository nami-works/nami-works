## Problem Statement

### What was broken

For a 2-order route (Fernanda + Maria), the Lalamove order placement had three issues:

1. **`recipients[0].remarks` (Fernanda's delivery stop)** received `pickupInstructions` — correct position for NOTAS PARA O MOTORISTA display, but this meant Fernanda's own `address2` ("Casa 2") was **never sent anywhere**.

2. **`recipients[1].remarks` (Maria's delivery stop)** received `shippingAddress.address2` ("Edf welconX ap 1003, Perdizes") — but this also appeared in **NOTAS PARA O MOTORISTA** instead of at Maria's individual delivery stop only.

3. **`sender.remarks`** was never sent at all — the field existed in the `LalamoveOrderContact` type but was silently dropped inside `placeLalamoveOrder` in `lalamove.server.ts`.

Additionally, for routes with 3+ orders, the hardcoded string `"Tempo de espera incluído."` was being injected into `recipients[0].remarks`, which was also wrong.

---

### Root cause

In `placeLalamoveOrder` (`app/services/lalamove.server.ts`):
- The `sender` object was constructed without including `remarks`, even though the type supported it.

In the place-order action (`app/routes/app.local-delivery.tsx`, lines 7013–7032):
- `recipients[0].remarks` was special-cased to carry `pickupInstructions` (plus the hardcoded wait-time string).
- `recipients[i > 0].remarks` carried each order's `address2`.
- This meant the first delivery order never got its `address2` sent.

---

### How you asked me to fix it

**Desired field mapping (API terms → Lalamove driver app display):**

| API field | Value | Lalamove display |
|---|---|---|
| `sender.remarks` | `pickupInstructions` | NOTAS PARA O MOTORISTA |
| `recipients[0].remarks` | Fernanda's `shippingAddress.address2` | Fernanda's delivery stop only |
| `recipients[1].remarks` | Maria's `shippingAddress.address2` | Maria's delivery stop only |

Key clarification you provided: **Lalamove internally labels the API `sender` contact as "recipients[0]" in their system.** Its `remarks` is what surfaces as NOTAS PARA O MOTORISTA. The API `recipients` array maps to Lalamove's displayed "recipients[1]", "recipients[2]", etc.

**Changes requested:**

1. **`app/services/lalamove.server.ts`** — propagate `sender.remarks` into the outgoing POST `/v3/orders` body.
2. **`app/routes/app.local-delivery.tsx`** — remove the index-0 special-case from the recipients loop; give every delivery stop its own `address2` as `remarks` uniformly; pass `pickupInstructions` as `sender.remarks`; remove the hardcoded `"Tempo de espera incluído."` string.

---

### What was implemented (and then partially reverted)

- `recipients` mapping was fixed: uniform `address2` for all stops, index-0 special-case and hardcoded string removed. ✅
- `sender.remarks = pickupInstructions` was added to `placeLalamoveOrder` in `lalamove.server.ts`. ✅
- `sender.remarks = pickupInstructions` was added to the sender argument in `app.local-delivery.tsx`. ✅

**Then a 422 error appeared:** `additionalProperties 'remarks' not allowed` — indicating the Lalamove `/v3/orders` API does not accept `remarks` on the `sender` object.

You confirmed: only `sender.remarks` was new — `recipients[i].remarks` was already being sent before the changes. So the fix is to **remove `sender.remarks`** from both files, leaving `pickupInstructions` without a destination for now.

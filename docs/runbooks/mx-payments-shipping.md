# Runbook: MX Payments & Shipping (Openpay + Mercado Pago + Skydropx)

Operational bring-up guide for the `mx-payments-shipping` change (spec PF-4).
Follow it top to bottom on a fresh environment; the final checklist verifies
the proposal's success criteria.

All providers are **env-gated**: a provider registers only when its FULL env
set is present (see `apps/backend/.env.template`). Partial config logs a
warning and skips the provider — boot never fails because of missing keys.

## 1. Prerequisites

- Backend and storefront envs populated from their `.env.template` files:
  - Openpay: `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`, `OPENPAY_PUBLIC_KEY`,
    `OPENPAY_SANDBOX`, `OPENPAY_WEBHOOK_USER`, `OPENPAY_WEBHOOK_PASSWORD`
  - Mercado Pago: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`
  - Shared: `BACKEND_PUBLIC_URL` (publicly reachable HTTPS URL of the backend)
  - Skydropx: `SKYDROPX_API_KEY`, optional `SKYDROPX_BASE_URL`,
    `SKYDROPX_ORIGIN_ZIP` (fallback origin), optional `SKYDROPX_TAX_INCLUSIVE`
  - Storefront: `NEXT_PUBLIC_OPENPAY_MERCHANT_ID`, `NEXT_PUBLIC_OPENPAY_PUBLIC_KEY`,
    `NEXT_PUBLIC_OPENPAY_SANDBOX`, `NEXT_PUBLIC_MP_PUBLIC_KEY`,
    `NEXT_PUBLIC_DEFAULT_REGION=mx`
- Postgres reachable; backend boots (`pnpm dev` in `apps/backend`).

## 2. Store configuration (Admin)

### 2.1 MXN currency

Settings → Store → Currencies → add **MXN**. Optionally set it as the default
store currency for an MX-first store.

### 2.2 MX region + tax region

1. Settings → Regions → Create region:
   - Name: `Mexico`, Currency: `MXN`, Countries: `Mexico`.
2. Settings → Tax Regions → create a tax region for **Mexico** (IVA 16%
   standard rate) so cart totals compute MX tax correctly.

### 2.3 Assign payment providers to the region

In the `Mexico` region settings, add payment providers:

- `Openpay (card)` — runtime id `pp_openpay_openpay`
- `Mercado Pago` — runtime id `pp_mercadopago_mercadopago`

They appear in the list only when their env sets are complete (see §1).

### 2.4 Service zone + shipping options

1. Settings → Locations & Shipping → pick the stock location → create a
   **service zone** covering Mexico. Give the location an address with a
   valid **postal code** — it is the Skydropx origin zip (falls back to
   `SKYDROPX_ORIGIN_ZIP` when absent).
2. Create a shipping option in that zone:
   - Provider: **Skydropx**, fulfillment option: `Envío estándar`
     (`skydropx-standard`), price type: **Calculated**.
3. **Keep the existing manual flat-rate option** in the zone. It is the
   graceful-degradation path: when a Skydropx quote fails (missing dims,
   timeout, zero rates), checkout still completes with the manual option.

### 2.5 Product weight/dimensions precondition

Skydropx quotes require **every variant** in the cart to have positive
`weight`, `length`, `width`, `height`.

- Convention: **weight in grams, dimensions in cm** (starter/Medusa default).
- Variants missing any value degrade the cart to manual shipping options only.

## 3. Webhooks & tunnels (local/staging)

Both payment webhooks are **purchase-critical** (3DS drop-off recovery for
Openpay; OXXO-style delayed payment for Mercado Pago). The backend must be
reachable over HTTPS — locally, run a tunnel (e.g. `cloudflared`, `ngrok`)
and set `BACKEND_PUBLIC_URL` to the tunnel URL.

### 3.1 Openpay webhook (Basic auth + verification handshake)

1. Openpay Dashboard → Webhooks → register:
   `{BACKEND_PUBLIC_URL}/hooks/payment/pp_openpay_openpay`
   with Basic-auth **user/password matching `OPENPAY_WEBHOOK_USER` /
   `OPENPAY_WEBHOOK_PASSWORD`**.
2. Openpay sends a `verification` event containing a **verification code**;
   the dashboard asks you to enter it to activate the endpoint. The provider
   acknowledges `verification` events (logs them, `not_supported` action) —
   read the code from the backend logs or the dashboard delivery detail.
3. Requests failing Basic auth are acknowledged without any state change.

### 3.2 Mercado Pago webhook secret

1. MP Developer Dashboard → your application → Webhooks → register:
   `{BACKEND_PUBLIC_URL}/hooks/payment/pp_mercadopago_mercadopago`
   for **Payments** events.
2. Copy the generated **secret key** into `MP_WEBHOOK_SECRET` — it validates
   the `x-signature` HMAC on every notification.

### 3.3 MP back_urls require HTTPS (risk R13)

MP's `auto_return` requires **HTTPS** `back_urls`. Locally, the storefront
`NEXT_PUBLIC_BASE_URL` must also be a tunnel HTTPS URL, or `auto_return`
stays disabled in sandbox (verify under gate S4.0c).

## 4. PCI scope acknowledgment (SAQ A-EP)

The Openpay integration renders a **self-hosted card form** (card data is
tokenized client-side by openpay.js and never touches our backend). Hosting
the payment form on our own pages places the storefront in **PCI DSS
SAQ A-EP** scope (not the lighter SAQ A of fully hosted/redirect forms).
Acknowledge this in your compliance inventory: serve checkout over TLS, keep
third-party scripts audited, and never log or persist card fields.
Mercado Pago Checkout Pro remains a redirect flow (SAQ A).

## 5. Deferred sandbox-gate checklist

The following gates were **deferred** (sandbox credentials/DB unavailable at
implementation time) and MUST be resolved before the corresponding PR
merge sign-off / production use:

- [ ] **S2.0a** — `completeCart` behavior when `authorizePayment` returns
  `requires_more` (Openpay 3DS) on Medusa 2.15.5.
- [ ] **S2.0b** — Openpay `captured` webhook completes an uncompleted cart
  (3DS drop-off recovery).
- [ ] **S2.0c** — Openpay field-level wire shapes (3DS `charge_pending` +
  `payment_method.url`, webhook `transaction.order_id` echo, refund endpoint);
  remove `TODO(sandbox-verify)` markers in `openpay-payment/types.ts`.
- [ ] **S3.8** — Manual 3DS round-trip: non-3DS success, declined card, 3DS
  success, 3DS abandonment recovered by webhook.
- [ ] **S4.0a** — MP `captured` webhook completes an uncompleted cart
  (OXXO-inside-MP pays days later).
- [ ] **S4.0b** — Exact webhook payload Medusa delivers to
  `getWebhookActionAndData` (query `data.id` availability for the
  x-signature manifest).
- [ ] **S4.0c** — MP `auto_return` HTTPS requirement / local tunnel behavior.
- [ ] **S5.0a** — Variant weight/dims presence in the `calculatePrice`
  context on 2.15.5 (fallback: explicit variant query inside the provider —
  isolated in the `toParcelItems` seam in `skydropx-fulfillment/service.ts`).
- [ ] **S5.0b** — Skydropx API generation (legacy Token vs Pro OAuth) and
  whether `total_pricing` includes IVA (`is_calculated_price_tax_inclusive`
  default / `SKYDROPX_TAX_INCLUSIVE`); remove `TODO(sandbox-verify)` markers
  in `skydropx-fulfillment/types.ts`.
- [ ] **S5.5** — Live sandbox quote at checkout + admin label purchase with
  tracking visible; missing-dims product degrades to manual options.
- [ ] **S5.7** — `NEXT_PUBLIC_DEFAULT_REGION=mx` root-URL behavior check.

## 6. Fresh-environment verification checklist

Run after completing §1–§3 on a clean environment:

- [ ] Backend boots with NO provider env vars: `pp_system_default` and
  `manual_manual` still available (baseline regression, design R4).
- [ ] Backend boots with full env: logs show Openpay, Mercado Pago, and
  Skydropx providers registered (no partial-config warnings).
- [ ] `cd apps/backend && pnpm test:unit` — all suites green.
- [ ] `pnpm build` green in `apps/backend` and `apps/storefront`.
- [ ] Storefront root URL lands on `/mx` with MXN prices
  (`NEXT_PUBLIC_DEFAULT_REGION=mx`).
- [ ] Checkout shows Openpay and Mercado Pago as payment methods for the MX
  region (§2.3).
- [ ] Checkout shows a calculated Skydropx price for a cart whose variants
  all have weight/dims; a cart with a missing-dims variant still completes
  via the manual flat-rate option.
- [ ] Openpay sandbox card payment completes an order; declined card shows
  an inline error with the cart intact.
- [ ] Openpay 3DS flow redirects out and returns to order confirmation;
  abandoning 3DS and paying later is recovered by the webhook (gate S2.0b).
- [ ] MP sandbox payment (approved) confirms the order; OXXO-style pending
  payment confirms later via webhook without the customer returning.
- [ ] Admin: creating a fulfillment with the Skydropx option purchases a
  label and shows tracking number/URL; quote-vs-label rate delta appears in
  backend logs.

## 7. Monitoring & rollback

### 7.1 Signals to watch (backend logs)

| Signal | Log query / pattern | What it means |
|---|---|---|
| Webhook auth rejections | `Openpay webhook` + `401`/`unauthorized` | Basic-auth secret drift or probing; payments may confirm late |
| Authorize failures | `authorizePaymentSession` / provider `authorize` errors | Cards being declined at charge time or provider outage |
| 3DS return route errors | `Openpay 3DS return: order completion failed for cart` | Customers bounced back to review after the bank challenge |
| Skydropx quote failures/timeouts | `Skydropx quotation failed` | Checkout degrading to manual shipping options |
| Label reconciliation ids | `Skydropx label abandoned` (`shipment_id=` / `label_id=`) | Orphaned labels — verify carrier-side cancellation, reconcile billing |

### 7.2 Suggested thresholds

- **> 1%** of checkout sessions hitting any signal above → investigate
  (provider status pages, recent deploys, env/secret rotation).
- **> 2%** → treat as an emergency: consider rolling back the provider
  (see 7.3) and switching the region to manual payment/shipping options.

### 7.3 Rollback procedure

1. **Disable a provider:** remove its env vars (`OPENPAY_*`,
   `MERCADOPAGO_*`, or `SKYDROPX_*`) and restart the backend — providers
   are registered conditionally at boot, so the provider is simply skipped
   and the rest of checkout keeps working.
2. **Storefront:** revert the corresponding `paymentInfoMap` entries and
   predicates in `apps/storefront/src/lib/constants.tsx` if the provider
   should no longer render as an option.
3. **Data safety:** existing orders/payments records persist untouched —
   rollback only prevents NEW sessions from using the provider. Pending
   captures/refunds for the disabled provider must be finished from the
   provider's own dashboard.

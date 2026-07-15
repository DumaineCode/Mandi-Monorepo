# Runbook: MX Payments & Shipping (Openpay + Mercado Pago + Skydropx)

Operational bring-up guide for the `mx-payments-shipping` change (spec PF-4).
Follow it top to bottom on a fresh environment; the final checklist verifies
the proposal's success criteria.

> **Credential model update (change: `admin-provider-settings`).** Provider
> credentials are no longer env-gated at boot. Openpay and Skydropx are now
> **always registered** and resolve their credentials at runtime from the
> **database**, managed in **Admin > Provider Settings** (encrypted at rest,
> AES-256-GCM). An unconfigured provider is inert and fail-safe (boot succeeds,
> checkout degrades gracefully, webhooks reject-all). The only remaining
> provider env vars are the KEK (`PROVIDER_SETTINGS_ENCRYPTION_KEY`) and
> `BACKEND_PUBLIC_URL`; every other `OPENPAY_*` / `MP_*` / `SKYDROPX_*` /
> `NEXT_PUBLIC_*` provider var is **DEPRECATED** and read only once by the
> migration seed (see §1a). See §1a for the seed + KEK contract and §7.3 for
> the per-slice rollback story.

## 1. Prerequisites

- Backend env (from `apps/backend/.env.template`) — provider concerns need only:
  - **ACTIVE** `PROVIDER_SETTINGS_ENCRYPTION_KEY` (KEK; see §1a) and
    `BACKEND_PUBLIC_URL` (publicly reachable HTTPS URL of the backend).
  - **DEPRECATED, seed-only** (populate ONLY for the initial migration seed,
    then remove — see §1a): `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`,
    `OPENPAY_PUBLIC_KEY`, `OPENPAY_SANDBOX`, `OPENPAY_WEBHOOK_USER`,
    `OPENPAY_WEBHOOK_PASSWORD`; `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`,
    `MP_WEBHOOK_SECRET`; `SKYDROPX_API_KEY`, `SKYDROPX_BASE_URL`,
    `SKYDROPX_ORIGIN_ZIP`, `SKYDROPX_TAX_INCLUSIVE`.
- Storefront env (from `apps/storefront/.env.template`):
  `NEXT_PUBLIC_DEFAULT_REGION=mx` (active). `NEXT_PUBLIC_OPENPAY_*` and
  `NEXT_PUBLIC_MP_PUBLIC_KEY` are **DEPRECATED** — public config is fetched at
  runtime from `GET /store/provider-config` (no rebuild on key rotation).
- Postgres reachable; backend boots (`pnpm dev` in `apps/backend`).

## 1a. Provider credentials: seed, KEK, and deprecation

Provider credentials are managed in **Admin > Provider Settings** and stored
encrypted in the database. On an existing deploy, import the current env-based
credentials once, then manage everything from the admin panel.

### 1a.1 KEK (`PROVIDER_SETTINGS_ENCRYPTION_KEY`) — operational contract

- REQUIRED and ACTIVE in every environment. Base64 **or** hex decoding to
  exactly 32 bytes. Generate with `openssl rand -base64 32`.
- Keep it **stable and backed up per environment**. It encrypts every stored
  provider secret (AES-256-GCM).
- **Loss/rotation:** if the KEK is lost or changed, previously stored secrets
  become undecryptable and every provider resolves as **unconfigured**
  (fail-safe — boot still succeeds). Recovery is to set a new KEK and
  **re-paste each provider's credentials via the admin panel**. There is no
  env fallback.
- A missing/invalid KEK disables encryption: admin saves fail loudly and the
  seed aborts without writing anything.

### 1a.2 One-time seed (safe on every deploy)

Run as a deploy step (idempotent — safe to run on every deploy):

```bash
cd apps/backend
npx medusa exec ./src/scripts/seed-provider-settings.ts
```

- Reads the DEPRECATED `OPENPAY_*` / `MP_*` / `SKYDROPX_*` env vars **once** and
  imports each provider whose **full required set** is present into the
  encrypted DB store. Required sets mirror the previous boot gating:
  - openpay: `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`,
    `OPENPAY_WEBHOOK_USER`, `OPENPAY_WEBHOOK_PASSWORD`
    (`OPENPAY_PUBLIC_KEY` → public config; `OPENPAY_SANDBOX` → mode)
  - skydropx: `SKYDROPX_API_KEY`, `SKYDROPX_ORIGIN_ZIP`
    (`SKYDROPX_BASE_URL`, `SKYDROPX_TAX_INCLUSIVE` optional)
  - mercadopago: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `BACKEND_PUBLIC_URL`
    (`MP_PUBLIC_KEY` → public config; `BACKEND_PUBLIC_URL` stays env-based, not
    stored)
- **Idempotent:** a provider that already has a settings row is **skipped**
  (`skipped-existing`) — admin edits/rotations are never overwritten. A partial
  env set is **skipped-incomplete** with a WARN naming the missing vars (no
  partial row). A provider with no env is **skipped-absent**. Per-provider
  outcome lines and a summary are logged; **no secret values are ever logged**.
- Verify idempotency: run it twice against a dev DB — the second run logs
  `skipped-existing` for every already-seeded provider and creates no
  duplicates.

### 1a.3 Post-seed env contract

After the seed, the **DB is strictly authoritative**. Provider env vars are
**not consulted at runtime** — changing `OPENPAY_PRIVATE_KEY` (etc.) has no
effect; a deleted DB row does **not** fall back to env (it resolves
unconfigured). Once every environment is seeded, **remove the deprecated
provider vars**, keeping only `PROVIDER_SETTINGS_ENCRYPTION_KEY` and
`BACKEND_PUBLIC_URL` (plus unrelated `DATABASE_URL`/JWT/COOKIE/CORS).

### 1a.4 Multi-instance staleness

The settings cache is process-local with a **30s TTL backstop** plus
save-triggered invalidation on the saving instance. In a multi-instance
deployment, a credential rotation is guaranteed visible on all instances within
**~30s** (and the public config endpoint adds up to ~60s of Next revalidation).
Acceptable for credential rotation; there is no Redis in this stack.

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

Openpay and Skydropx are always registered (see §1a); configure their
credentials in **Admin > Provider Settings** (or via the one-time seed). An
unconfigured provider is inert — it can be added to the region but yields no
usable payment/quote until credentials are saved.

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

**Disable a single provider (operational, no deploy):** clear its credentials
in **Admin > Provider Settings** (DELETE). The provider reverts to unconfigured
/ inert within the propagation window (~30s) — no restart. This is the fastest
rollback and the preferred one.

**Revert the feature by slice (code rollback during the deprecation window).**
The change shipped as independently revertible slices; the credential env vars
remain populated during the deprecation window, so reverting to env-driven
behavior is safe:

1. **Registration flip (highest-risk slice):** git-revert the runtime-resolution
   + `medusa-config.ts` flip slice to restore env-gated provider registration.
   With the deprecated `OPENPAY_*` / `MP_*` / `SKYDROPX_*` vars still present,
   boot returns to the previous env-driven behavior. Do this if runtime DB
   resolution misbehaves.
2. **Public endpoint / storefront:** revert the storefront slice to restore the
   `NEXT_PUBLIC_OPENPAY_*` reads (requires a storefront rebuild). Only needed if
   the runtime `/store/provider-config` path is the problem.
3. **Admin UI / API / module:** the earlier slices are additive — reverting them
   drops the admin route/API/module; the generated migration reverts via its
   generated `down`. Do this only for a full rollback.
4. **Storefront provider visibility:** revert `paymentInfoMap` entries and
   predicates in `apps/storefront/src/lib/constants.tsx` only if a provider
   should stop rendering entirely (unchanged by this change).
5. **Data safety:** existing orders/payments records persist untouched —
   rollback only prevents NEW sessions from using the provider. Stored
   encrypted settings remain in the DB (decryptable as long as the KEK is
   unchanged). Pending captures/refunds for a disabled provider must be
   finished from the provider's own dashboard.

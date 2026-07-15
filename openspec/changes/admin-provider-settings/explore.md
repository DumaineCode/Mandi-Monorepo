# Exploration — admin-provider-settings (current state)

> Source: SDD explore phase (Engram observation #117, topic `sdd/admin-provider-settings/explore`).

Workspace: pnpm/turbo monorepo. Backend: Medusa 2.15.5 (`apps/backend`, pnpm@11.1.1, Node >=20). Storefront: Next.js (`apps/storefront`). Prior change context: `mx-payments-shipping` (runbook at `docs/runbooks/mx-payments-shipping.md`).

## 1. Provider config surfaces today

### medusa-config.ts (apps/backend/medusa-config.ts)
- Env-gating: `providerEnvReady(provider, required[])` — provider included ONLY when its FULL required env set is present. All-missing → silent skip; partial → console.warn + skip. Boot never fails on missing provider env.
- Required env sets (exact names):
  - Openpay: `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`, `OPENPAY_WEBHOOK_USER`, `OPENPAY_WEBHOOK_PASSWORD` (optional: `OPENPAY_SANDBOX`, default sandbox=true unless === 'false'; `OPENPAY_PUBLIC_KEY` is storefront-only, does NOT gate backend)
  - Mercado Pago: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `BACKEND_PUBLIC_URL`
  - Skydropx: `SKYDROPX_API_KEY`, `SKYDROPX_ORIGIN_ZIP` (optional: `SKYDROPX_BASE_URL` default `https://api.skydropx.com/v1`; `SKYDROPX_TAX_INCLUSIVE` read inside service, default true)
- Registration: payment providers under `@medusajs/medusa/payment` module `options.providers[]`; fulfillment under `@medusajs/medusa/fulfillment` (keeps `fulfillment-manual` id `manual` unconditionally → `manual_manual`).
- **Mercado Pago is a LOCAL module** (`resolve: './src/modules/mercadopago-payment'`), NOT an npm plugin — no MP dependency in package.json. **CRITICAL: the directory `src/modules/mercadopago-payment` DOES NOT EXIST yet** (config comment: "Module directory lands in slice S4"). Config is written defensively: unreachable until MP env set is configured. Storefront also marks MP as "S4 (blocked)".
- Options mapping: openpay → {merchantId, privateKey, sandbox, webhookUser, webhookPassword}; mercadopago (future) → {accessToken, webhookSecret, backendUrl}; skydropx → {apiKey, baseUrl, originZip}.
- Other secrets: `DATABASE_URL`, `JWT_SECRET`/`COOKIE_SECRET` (fallback "supersecret"), CORS vars. No Redis anywhere in backend config/code.

### Provider IDs (apps/backend/src/lib/constants.ts)
- `OPENPAY_IDENTIFIER="openpay"` → runtime `pp_openpay_openpay`; `MERCADOPAGO_IDENTIFIER="mercadopago"` → `pp_mercadopago_mercadopago`; `SKYDROPX_IDENTIFIER="skydropx"` → `skydropx_skydropx`.
- Literals duplicated in `apps/storefront/src/lib/constants.tsx` (paymentInfoMap + isOpenpay/isMercadopago predicates); pinned by contract test `src/lib/__tests__/provider-ids.unit.spec.ts`.

### Module option consumption
- `openpay-payment/index.ts`: `ModuleProvider(Modules.PAYMENT, { services: [OpenpayPaymentProviderService] })`.
- `openpay-payment/service.ts`: `class extends AbstractPaymentProvider<OpenpayOptions>`; `static identifier = OPENPAY_IDENTIFIER`; `static validateOptions()` requires non-empty string merchantId+privateKey; **constructor(cradle, options)** stores `options_` and instantiates `new OpenpayClient(options)` ONCE at boot. Webhook Basic-auth verified in `verifyWebhookAuth()` from `options_.webhookUser/webhookPassword` (timingSafeEqual + length guard; missing creds → fail-safe reject-all).
- `openpay-payment/client.ts`: constructor bakes `baseUrl` (sandbox flag → sandbox-api.openpay.mx vs api.openpay.mx, + merchantId in path) and `authHeader` (Basic, privateKey as user, empty password) into readonly fields. Native fetch, 15s timeout, one bounded GET retry.
- `skydropx-fulfillment/service.ts`: `constructor({logger}, options)` → `options_` + `new SkydropxClient(options)` at boot. `validateOptions` requires apiKey. Origin zip: stock-location zip wins, `originZip` option fallback. Tax-inclusive: module option wins, then **`process.env.SKYDROPX_TAX_INCLUSIVE` read lazily inside the service** (only per-request env read found), default true.
- `skydropx-fulfillment/client.ts`: constructor bakes `baseUrl` (trailing-slash-stripped) and `authHeader` = `Token token={apiKey}`. 8s quotation / 15s admin timeouts.

## 2. Lifecycle constraints (runtime credential change impact)
- Options injected ONCE at boot via constructor; both clients pre-compute auth headers/base URLs as readonly fields. **No lazy/per-request config read except SKYDROPX_TAX_INCLUSIVE env fallback.**
- Env-gating happens at config-load time: a provider missing env is NOT REGISTERED AT ALL — no provider instance exists to update. Changing credentials in DB at runtime today would require: (a) provider always-registered (gating removed/changed), and (b) per-request credential resolution in service/client, or a container-level refresh. Restart currently required for any credential change (runbook §7.3 rollback = remove env + restart).
- Medusa payment module loader registers `pp_system_default` unconditionally; `manual_manual` fulfillment always present — safe boot baseline exists.

## 3. Existing settings/persistence patterns
- **No custom data models or migrations exist** — `src/modules/README.md` only has the template (`model.define("post", ...)` example + migration instructions). Nothing to mirror; this change will create the first custom module with a data model.
- **No workflows directory** (`src/workflows` absent). First workflow too.
- API routes: only starter stubs `src/api/store/custom/route.ts` and `src/api/admin/custom/route.ts` (GET → 200). No custom admin API surface yet. Webhooks use framework route `/hooks/payment/{provider_id}` (not custom code).
- Admin UI extensions: `src/admin/widgets/login-branding.tsx` (+css, zone `login.before`) and `src/admin/i18n/index.ts` (empty default export). No UI routes, no `src/admin/lib/client.ts` SDK instance yet. `@medusajs/admin-sdk` 2.15.5, `@tanstack/react-query` 5.64.2 and `react-router-dom` 6.30.3 already in dependencies (pnpm peer-dep requirement already satisfied).

## 4. Storefront coupling (design problem for proposal)
- `apps/storefront/src/lib/constants.tsx`: paymentInfoMap keys `pp_openpay_openpay`, `pp_mercadopago_mercadopago` (MP marked "S4 blocked"); predicates isOpenpay/isMercadopago.
- `apps/storefront/src/modules/checkout/components/payment-wrapper/openpay-wrapper.tsx:105-117`: reads `NEXT_PUBLIC_OPENPAY_MERCHANT_ID`, `NEXT_PUBLIC_OPENPAY_PUBLIC_KEY`, `NEXT_PUBLIC_OPENPAY_SANDBOX` — build-time/env-baked into the Next.js bundle for client-side openpay.js tokenization + deviceData. Missing config → warns, disables Openpay card payments.
- Runbook also documents `NEXT_PUBLIC_MP_PUBLIC_KEY` for MP.
- **FLAG**: public keys (merchant id + public key + sandbox flag) are duplicated across backend env and storefront NEXT_PUBLIC_ env. If DB becomes source of truth, the storefront still bakes these at build time — proposal must address delivery of public (non-secret) config to the storefront (e.g., a store API endpoint serving public provider config) or accept dual-source for public keys. Rotating keys in Admin would silently desync the storefront otherwise.
- Storefront 3DS return route: `app/[countryCode]/(checkout)/payment/openpay/return/route.ts`; `payment/index.tsx:113-114` sends `device_session_id` + `return_url` into session data.

## 5. Webhook coupling
- Openpay: Basic-auth user/password from provider options (`OPENPAY_WEBHOOK_USER/PASSWORD`), verified per-delivery in `getWebhookActionAndData` via `verifyWebhookAuth` (timingSafeEqual; fail-safe when unset). Webhook URL: `{BACKEND_PUBLIC_URL}/hooks/payment/pp_openpay_openpay`; dashboard `verification` handshake event logged, `not_supported`.
- Mercado Pago (future S4): `MP_WEBHOOK_SECRET` validates `x-signature` HMAC; `BACKEND_PUBLIC_URL` needed for notification URL / back_urls (HTTPS required, risk R13). Module doesn't exist yet — webhook secret consumption is design-only.
- Since webhook handling lives INSIDE the provider (options-injected at boot), moving secrets to DB hits the same boot-time injection constraint as API keys.

## 6. Test landscape
- Unit tests: `src/modules/openpay-payment/__tests__/{service,webhook,client}.unit.spec.ts`, `src/modules/skydropx-fulfillment/__tests__/{service,parcel,...}.unit.spec.ts`, `src/lib/__tests__/provider-ids.unit.spec.ts`. Pattern: **options passed explicitly to constructors** (e.g., MERCHANT_ID="m_test_123", fake container `{logger}`), global fetch mocked with jsonResponse helpers. No env-var dependence in unit tests.
- Integration: `integration-tests/http/health.spec.ts` uses `medusaIntegrationTestRunner` (real Postgres). `integration-tests/setup.js` (jest setupFiles for all 3 commands test:unit / test:integration:modules / test:integration:http): loads `.env.test`, sets only inert non-gating defaults (`OPENPAY_SANDBOX=true`, fake `SKYDROPX_BASE_URL`). **Gating env vars intentionally NOT faked** — faking them would make boot resolve module paths that don't exist (MP). Each provider slice is expected to add its inert fake env set alongside its module.
- Strict TDD mode is active for this project; test commands run with `--runInBand --forceExit`, NODE_OPTIONS=--experimental-vm-modules.

## 7. Encryption/crypto & secret handling today
- **No encryption utilities exist.** Only crypto usage: `timingSafeEqual` from `node:crypto` in openpay service (webhook auth). No cipher/hash/KMS/vault code anywhere in `apps/backend/src`.
- Secrets today are 100% env: DATABASE_URL, JWT_SECRET, COOKIE_SECRET (both default "supersecret" — weak default worth noting), provider keys. No Redis. DB-encrypted secrets will need a NEW encryption seam (e.g., AES-256-GCM with an env-provided master key — note: one env secret must remain as the KEK).
- `.env.template` read blocked by safety policy; env contract reconstructed from medusa-config.ts + runbook §1.

## Key implications for the proposal (facts, not design)
1. MP module doesn't exist — "configure MP from admin" implies also building the MP provider module, or scoping settings UI to store credentials ahead of it.
2. Boot-time-only option injection + env-gated registration are THE central obstacles: DB-as-source-of-truth needs always-registered providers + lazy credential resolution or restart-on-change semantics.
3. Greenfield for: data models/migrations, workflows, admin API routes, admin UI routes/forms, encryption utils — no existing patterns to mirror in-repo; skills (building-with-medusa, building-admin-dashboard-customizations) define the patterns to follow.
4. Storefront NEXT_PUBLIC_* duplication of public keys must be addressed (runtime store-config endpoint vs accepted dual-source).
5. Test seams are clean: providers take explicit options; a settings-loading layer can be unit-tested the same way; integration setup.js documents where inert fakes go.
6. "Test connection" button: Openpay client has getCharge (needs a charge id) — no cheap ping endpoint currently wrapped; Skydropx has createQuotation (usable as connectivity probe with a known zip pair); MP would use its token validity check. Wire shapes for Openpay/Skydropx carry TODO(sandbox-verify) markers — sandbox verification gates (S2.0c, S5.0b) still open per runbook §5.

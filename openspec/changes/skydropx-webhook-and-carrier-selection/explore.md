# Exploration — `skydropx-webhook-and-carrier-selection`

**Status:** exploration only — no production code, tests, or other-change artifacts touched.
**Builds on:** `skydropx-pro-oauth-migration` (S1–S3 landed: PRO OAuth, async quote, async label). This change does not redo that work.
**Session preflight:** execution mode `interactive`, artifact store `openspec` (Engram DOWN), chain strategy `auto-forecast`, review budget 600 changed lines per PR, strict TDD active (`cd apps/backend && pnpm test:unit`).

---

## 1. Scope

Two capabilities, one change, two slices.

| Slice | Capability | Business driver |
|---|---|---|
| **W** | Skydropx PRO webhook endpoint | (a) complete `label_pending` fulfillments with `label_url` + `tracking_number`; (b) reflect package status events on the Medusa fulfillment/order |
| **C** | Admin-restricted carrier list | thread an allowed-carrier list from provider-settings into `requested_carriers` on the quotation; selection stays auto-cheapest **within** the allowed set |

**Explicitly out of scope** (user-confirmed): customer-facing carrier choice in storefront checkout; operator per-label rate picking in admin.

---

## 2. Label / fulfillment lifecycle as it exists today

### 2.1 Where `label_pending` is written

`apps/backend/src/modules/skydropx-fulfillment/service.ts` — `createFulfillment`, return block at **lines 1101–1128**:

```ts
return {
  data: {
    ...(data ?? {}),
    shipment_id: shipment.id,
    rate_id: rate.id,
    tracking_number: trackingNumber,
    label_url: labelUrl,
    // Marks the fulfillment as awaiting its label, so whatever completes it
    // later (job, webhook, manual refresh) can find it without guessing.
    label_pending: labelPending,
    label_status: current.workflowStatus,
  },
  labels: labelUrl ? [{ tracking_number, tracking_url: "", label_url }] : [],
}
```

`labelPending` is set `true` at **lines 1075 / 1082** — the two `break`s out of the poll loop when the shared deadline no longer affords a poll that can *complete* (`remaining < LABEL_POLL_MIN_REQUEST_MS = 3_000`). It is NOT set on terminal failure: `isTerminalLabelFailure` (`error|failed|failure|cancelled|canceled|rejected|expired`) throws `notReady(...)` instead, and SD-4 containment best-effort-cancels the shipment. **So `label_pending: true` always means "healthy shipment, label not ready yet" — exactly the state the webhook must complete.**

### 2.2 `data` keys a Skydropx fulfillment carries

`shipment_id`, `rate_id`, `tracking_number`, `label_url`, `label_pending`, `label_status`, plus whatever the caller passed in `data`. Bounded budget context: `SKYDROPX_FULFILLMENT_BUDGET_MS` (derived), `LABEL_POLL_BOUND_MS = 30_000`, `LABEL_POLL_INTERVAL_MS = 2_000`.

### 2.3 `cancelFulfillment` keying

`service.ts:1168–1171` — reads `data.shipment_id`; absent → `return {}` (nothing purchased, nothing to cancel). Unconfigured provider → log-and-proceed. Carrier cancel failure → log-and-proceed. **`shipment_id` is already the established correlation key for this provider.**

### 2.4 What a webhook payload can realistically join on

| Candidate | Present in fulfillment `data`? | Notes |
|---|---|---|
| `shipment_id` | **always** (set before any polling outcome) | strongest join key; already the cancel key |
| `tracking_number` | only when the label completed in-band | `undefined` for exactly the `label_pending` population the webhook exists to serve → **unusable as the primary key** |
| `master_tracking_number` | same as above | client normalizes `included[0].attributes.tracking_number` with `master_tracking_number` fallback (`client.ts:84–93`) |

**Finding:** `shipment_id` is the only identifier guaranteed present on a pending fulfillment. Tracking number can at best be a secondary/confirmatory key for slice W(b) status events, which arrive after a tracking number exists.

**Open question:** does the Skydropx PRO webhook payload actually carry the shipment id (and under what field name)? See §7 — the verified reference does not say.

---

## 3. Mutating a fulfillment from outside the provider — VERIFIED

### 3.1 Project rule

`openspec/config.yaml` → `conventions.medusa_rules[0]`: *"Mutations go through workflows; never call module services directly from routes."* Confirmed by the `building-with-medusa` skill (`arch-workflow-required`, `arch-layer-bypass`) and by the existing in-repo pattern (`api/admin/provider-settings/[provider]/route.ts` → `upsertProviderSettingsWorkflow` → steps → module service). HTTP methods restricted to GET/POST/DELETE.

### 3.2 In-repo workflow precedent

Exactly one workflow family exists: `apps/backend/src/workflows/upsert-provider-settings.ts` + `steps/` (`validate-provider-payload`, `encrypt-and-upsert-provider-setting`, `invalidate-provider-credential-cache`, `resolve-probe-credentials`, `probes/`). Composition follows the constraints correctly: regular `function`, no `await`, no conditionals. **This is the shape a webhook-side workflow should copy.**

### 3.3 Core-flows introspection — OQ-1 / OQ-2 / OQ-3 CLOSED

Verified by the orchestrator against the installed `@medusajs/core-flows@2.15.5`
(`node_modules/.pnpm/@medusajs+core-flows@2.15.5_.../dist/fulfillment/workflows/`). The explore
subagent could not resolve these with read-only tools; they are now facts, not candidates.

**OQ-1 — CLOSED. `updateFulfillmentWorkflow` can update a fulfillment's `data`.**
`@medusajs/types` → `UpdateFulfillmentWorkflowInput`:

```ts
{ id: string; location_id?; packed_at?; shipped_at?; marked_shipped_by?;
  created_by?; delivered_at?; data?: Record<string, unknown> | null; metadata? }
```

So `data.label_url` / `data.tracking_number` / `data.label_pending` / `data.label_status` are all
writable post-creation through a legitimate workflow. Note `data` is a whole-object replace, not a
merge — the webhook must read the current `data` and write a merged envelope, exactly the
half-applied-envelope hazard `types.ts:160–170` already documents.

**OQ-2 — CLOSED. Labels CAN be appended after fulfillment creation.**
`createShipmentWorkflow` (`create-shipment.js`) is:

```ts
createWorkflow(createShipmentWorkflowId, (input) => {
  validateShipmentStep(input.id)
  const update = transform({ input }, (data) => ({ ...data.input, shipped_at: new Date() }))
  return new WorkflowResponse(updateFulfillmentWorkflow.runAsStep({ input: update }))
})
```

Input: `{ id, labels: [{ tracking_number, tracking_url, label_url }], ... }`. This is the
Admin API's own "create shipment for a fulfillment" path. **It both attaches the label rows and
stamps `shipped_at`** — i.e. one call completes the guía AND marks the fulfillment shipped.
Design decision to make explicitly: is "label ready" the same business event as "shipped"? For
Skydropx it usually is not (the label exists before the carrier picks the package up), so using
`createShipmentWorkflow` for W(a) would advance shipment status prematurely, while
`updateFulfillmentWorkflow` alone would attach no downloadable label row. **This tension is the
core design call of slice W(a).**

**OQ-3 — CLOSED (fulfillment level), open (order level).**
Available order/fulfillment lifecycle workflows in 2.15.5:

```text
updateFulfillmentWorkflow          markFulfillmentAsDeliveredWorkflow
createShipmentWorkflow             cancelFulfillmentWorkflow
createOrderShipmentWorkflow        markOrderFulfillmentAsDeliveredWorkflow
createOrderFulfillmentWorkflow     cancelOrderFulfillmentWorkflow
```

The `*Order*` variants are the order-aware wrappers (they also register the shipment against the
order and emit the order events the notification subscribers listen to). **OQ-3a (new, for design):**
should the webhook drive the fulfillment-level workflows or the order-level ones? The order-level
ones are almost certainly correct for status events (`in_transit` → `createOrderShipmentWorkflow`,
`delivered` → `markOrderFulfillmentAsDeliveredWorkflow`), but they need the `order_id`, which the
webhook must resolve from the fulfillment. Confirm the exact inputs before committing.

---

## 4. Webhook precedent in this repo

### 4.1 There is none — for custom routes

Full route inventory under `apps/backend/src/api/`:

```text
store/custom/route.ts                                        GET
store/provider-config/route.ts                               GET
store/postal-codes/[code]/route.ts                           GET
admin/custom/route.ts                                        GET
admin/provider-settings/route.ts                             GET
admin/provider-settings/[provider]/route.ts                  GET POST DELETE
admin/provider-settings/[provider]/test-connection/route.ts  POST
```

Openpay and Mercado Pago webhooks are **not custom routes**. They ride Medusa's framework route
`/hooks/payment/{provider_id}`, which calls the payment provider's `getWebhookActionAndData(payload)`.
Confirmed in `openspec/changes/admin-provider-settings/explore.md:39` and in
`modules/openpay-payment/service.ts:467` / `modules/mercadopago-payment/service.ts:458`.

**`AbstractFulfillmentProviderService` has no `getWebhookActionAndData` equivalent.** So the Skydropx
webhook will be **the first custom public unauthenticated route in this repo** — new territory, and
the security surface deserves design attention rather than pattern-copying.

### 4.2 What the payment webhooks DO give us as a pattern

From `modules/openpay-payment/service.ts:458–570` and `__tests__/webhook.unit.spec.ts`:

- **DB-resolved secrets per delivery**, not boot-baked — `verifyWebhookAuth` reads
  `webhookUser`/`webhookPassword` through the async `credentialSource` seam on every call, so rotation
  in admin takes effect without restart.
- **`crypto.timingSafeEqual` WITH an explicit length guard** (`timingSafeEqual` throws on length
  mismatch; odd-length auth must be rejected, not crash).
- **Fail-safe reject-all** when the credential source returns `null` (provider unconfigured).
- **Never trust the payload body** — Openpay re-fetches `GET /charges/{id}` server-side; the payload's
  own status/amount is never authoritative.
- **Never log the secret**; unit tests assert this by scanning log output.
- The payload shape available to a provider is `{ data, rawData, headers }` — `rawData` (the raw
  string) is what a signature is computed over.

### 4.3 Raw body for HMAC-SHA512

`apps/backend/src/api/middlewares.ts` registers only two `validateAndTransformBody` entries, both for
admin provider-settings. There is **no raw-body middleware in this repo today**, because the framework
`/hooks/payment/*` route supplies `rawData` itself.

**OQ-4** — a custom route needs the *exact bytes* Skydropx signed. Design must determine whether
Medusa 2.15's JSON body parser preserves a raw buffer on custom routes, or whether the route needs a
dedicated raw-body middleware entry in `middlewares.ts` (`matcher: "/hooks/skydropx"`,
`method: "POST"`). Re-serializing `req.body` to recompute an HMAC is a classic silent-failure trap
(key ordering, unicode escaping) and must not be assumed to work.

Also note the middleware's documented hazard, which will bite the carrier-list field in §5: Medusa's
`zodValidator` **forces `.strict()`** on any object schema, overriding `.passthrough()`/`.strip()`.
Every candidate field across all providers must be listed explicitly or valid saves fail with
"Unrecognized fields."

---

## 5. Provider-settings credential pipeline — the layer list

The prior change (`skydropx-pro-oauth-migration` `tasks.md` §S1) is the authoritative enumeration:
**~10 layers**, deliberately enumerated *"so a missed touchpoint fails a test rather than silently
fail-safe-nulling (R-B)."* Both new fields in this change travel it.

| # | Layer | File | New **public** field `allowedCarriers` (list) | New **secret** field `webhookSecret` |
|---|---|---|---|---|
| L1 | Provider credential interface | `modules/skydropx-fulfillment/types.ts` `SkydropxCredentials` | add | add |
| L2 | Resolved config type | `modules/provider-settings/types.ts` `SkydropxResolvedConfig` (+ header doc table lines 6–10) | add | add |
| L3 | Merge/defaults | `modules/provider-settings/service.ts` `mergeResolvedConfig` (line 108) | only if a default or string→array coercion is needed — see §6 | pass-through (plain spread of `secrets`) |
| L4 | Env seed | `scripts/seed-provider-settings.core.ts` `publicEnv` / `secretEnv` (lines 102–120) | `SKYDROPX_ALLOWED_CARRIERS` in `publicEnv` — **`publicEnv` values are env strings**, so a list arrives as a string here regardless | `SKYDROPX_WEBHOOK_SECRET` in `secretEnv`; **decide whether it joins `requiredEnv`** (adding it makes existing partial envs skip-and-warn — a behavior change for existing deploys) |
| L5 | Storage classification + zod | `workflows/steps/validate-provider-payload.ts` — `PROVIDER_PUBLIC_FIELDS.skydropx` / `PROVIDER_SECRET_FIELDS.skydropx` + `skydropxUpsertSchema` | add to `PROVIDER_PUBLIC_FIELDS` + schema | add to `PROVIDER_SECRET_FIELDS` + schema (`z.string().min(1).optional()`) |
| L6 | HTTP save schema | `api/middlewares.ts` `UpsertProviderSettingsBody` | **mandatory** (forced `.strict()`) | **mandatory** |
| L7 | HTTP test-connection schema | `api/middlewares.ts` `TestProviderConnectionBody` (`.strip()`) | mandatory or silently dropped | mandatory or silently dropped |
| L8 | Admin form model | `admin/routes/provider-settings/form-model.ts` `PROVIDER_FORMS.skydropx` | **blocked on §6** — `FieldType` is `"text" \| "password" \| "boolean"` only | trivial: `{ type: "password", secret: true }`, mirrors `webhookPassword`/`webhookSecret` on the other providers |
| L9 | Probe required fields | `workflows/steps/resolve-probe-credentials.ts` `PROBE_REQUIRED_FIELDS.skydropx` (currently `["clientId","clientSecret","originZip"]`) | not required for the probe | not required — the probe is an OAuth token exchange |
| L10 | Probe dispatcher / impl | `workflows/steps/probes/index.ts`, `probes/skydropx.ts` | only if the probe quotation should honor the carrier restriction (arguably yes, so "test connection" reflects real config) | no |
| L11 | Storefront public projection | `api/store/provider-config/public-config.ts` | **skydropx is entirely omitted from the storefront projection** (pinned by `public-config.unit.spec.ts`) — carrier list must NOT leak; no change | no change |

Note L5's own doc comment: *"'Non-secret' means 'not encrypted at rest', NOT 'publicly servable'."*
`originEmail`/`originCompany`/`originPhone` already live in `public_config` yet never leave admin.
`allowedCarriers` sits in the same category.

**Secret masking** comes free: `prepareProviderSettingRow` (`provider-settings/service.ts:78–102`)
computes `secret_hints` at write time; `last4` only when plaintext ≥ 8 chars.

**Mode-toggle interaction (real, easy to miss):** `validateProviderPayload` requires **all** secrets
re-entered on a mode switch. Adding `webhookSecret` to `PROVIDER_SECRET_FIELDS.skydropx` means any
future sandbox↔production switch will demand three secrets, not two. Existing rows saved before this
change have no `secret_hints.webhookSecret`, so a same-mode save that omits it lands in `missing` →
**rejected**. Design must decide: optional-secret semantics for `webhookSecret`, or a
migration/backfill story. **This is the single highest-risk item in slice W.**

---

## 6. Can `public_config` hold an array today? — concrete finding

**Short answer: the storage layer can, the form and seed layers cannot.**

- **Storage** — `public_config` is a JSON column; `mergeResolvedConfig` spreads it untouched. An array survives.
- **Zod** — `z.array(z.string())` is trivially expressible in all three schemas. No obstacle.
- **Admin form model — BLOCKED.** `form-model.ts:18`: `export type FieldType = "text" | "password" | "boolean"`.
  The three functions driving the form are hard-split into exactly two branches:
  - `initialFormState`: `if (field.type === "boolean") {…} ; values[field.name] = asString(publicConfig[field.name])`
    — **`asString` returns `""` for a non-string**, so a stored array hydrates as empty and a save would wipe it.
  - `buildUpsertBody`: same two-branch split, `asString(...).trim()`, emits a string.
  - `buildTestCandidate`: identical.
- **Env seed — string-only.** `publicEnv` maps field → env var name; env values are strings by construction.

**Two viable shapes, real tradeoff:**

| | **A. Comma-separated string** | **B. Real `string[]`** |
|---|---|---|
| `FieldType` | no change | new `"list"` + a 4th branch in 3 form-model functions + a `.tsx` consumer |
| Zod | `z.string().optional()` | `z.array(z.string()).optional()` in all 3 schemas |
| Seed | natural | needs a split/coercion, mirroring how `taxInclusive` coerces a string env to boolean |
| `mergeResolvedConfig` | needs a parse (split/trim/filter/lowercase) — or the parse lives in the consumer | pass-through |
| Rows saved before | absent → treat as "no restriction" | same |
| Cost | ~1 layer of extra parsing, zero UI work | ~3 form-model functions + 1 UI component + a `FieldType` union widening |
| Honesty | the type says `string`, the meaning is a list | the type says what it is |

**Recommendation for design (not a decision):** B is the architecturally honest option and `FieldType`
is *designed* to be extended, but A is materially cheaper and the seed layer forces a string parse
either way. Decide explicitly; do not let it be decided by whichever file gets edited first.

**Third question regardless of shape:** is the carrier list **free text** or a **fixed enum**? The PRO
reference shows `requested_carriers: ["fedex","dhl"]` but does **not** publish the carrier-code
vocabulary. Free text means a typo silently yields zero rates (§8.2). A `Select`/multi-select needs a
source of truth we do not have.

---

## 7. PRO webhook contract — VERIFIED from official sources

Sources read in full by the orchestrator (both provided by the user, both official):
- `https://help.skydropx.com/articulos-cda/configuracion-de-webhooks` (help center, operator-facing)
- `https://pro.skydropx.com/es-MX/api-docs#webhooks` (integration docs, §Webhooks)

The one-line summary in `pro-api-reference.md` §6 is superseded by this section. **OQ-5, OQ-6, OQ-7,
OQ-8, OQ-9 and OQ-10 are CLOSED.** Only OQ-4 (raw body on a Medusa custom route) remains a code-side
unknown.

### 7.1 OQ-5 CLOSED — package event payload (JSON:API shape)

```json
{
  "data": {
    "id": "6172eb82-7b0b-4852-9954-b1ac1c20e4f8",
    "type": "packages",
    "attributes": {
      "status": "delivered",
      "tracking_number": "794874381730",
      "tracking_url_provider": "https://www.fedex.com/fedextrack/?trknbr=794874381730",
      "label_url": "https://api.example.com/cloud/storage/blobs/proxy/30a9d3/label_794874381730.pdf",
      "returned_status": null,
      "returned": false
    },
    "relationships": {
      "shipment": {
        "data": { "id": "93774c22-8275-4757-9963-71b79b2e8db7", "type": "shipments" },
        "links": { "related": ".../api/v1/shipments/93774c22-..." }
      },
      "order": { "data": { "id": "41ae1bf9-...", "type": "orders" }, "links": { "related": "..." } }
    }
  }
}
```

Load-bearing facts:

- **`data.id` is the PACKAGE id, not the shipment id.** `data.type === "packages"`.
- **The shipment id lives at `data.relationships.shipment.data.id`** — this is exactly the value
  `createFulfillment` persists as `data.shipment_id` (§2.4). The join key exists and is unambiguous.
- **`attributes.label_url` ships INSIDE the package event.** This is the single most important finding
  for slice W(a): the webhook does not merely announce a status, it carries the guía URL.
- `attributes.tracking_number` is also present, so the webhook can fill BOTH fields the
  `label_pending: true` fulfillment is missing.
- The `order` relationship is present only when the Skydropx shipment is linked to a Skydropx order.
  Our integration creates shipments from quotations without a Skydropx order, so the payload will
  usually take the "envíos sin orden" shape (`relationships` containing only `shipment`). **The reader
  must not require `relationships.order`.**
- Return flow: `status` stays `"in_return"` for the entire return trip and the real granular state moves
  to `returned_status`. `returned` and `returned_status` are **always present** (`false` / `null` when
  not returning) — the docs state the payload shape is fixed here.
- Other webhook sections exist with different `data.type` values (`orders`, `quotation`, `rate`,
  `extra_charges`, `pickups`). **The reader must reject/ignore any `data.type !== "packages"`** rather
  than assume the subscription is narrow.

### 7.2 OQ-10 CLOSED — package status vocabulary

From `POST /api/v1/shipments/tracking` (the same state machine Skydropx exposes for own-fleet events):

```text
created · picked_up · in_transit · last_mile · delivery_attempt · delivered_to_branch ·
delivered · exception · in_return · canceled · destroyed · retained
```

This is the complete list; the `…` in the old reference is now enumerated. Design must map each of
these to a Medusa action or an explicit no-op — a silent `default:` branch over 12 known states is a
bug waiting to happen.

### 7.3 OQ-6 CLOSED — HMAC construction

Verbatim from the integration docs:

- Header: `Authorization: HMAC <firma>` (Bearer alternative: `Authorization: Bearer <token>`).
- **The auth header NAME is configurable in the panel** — default `Authorization`, any name of 3–25
  characters with no spaces is accepted. (The panel's "Header" field.)
- Algorithm: **HMAC-SHA512** (RFC 6234) with our secret key.
- Signed message: **the raw request body, exact bytes, unformatted.** No timestamp, no nonce, no
  method/path prefix.
- Encoding: **lowercase hexadecimal string.**

Consequences for the design:
- The `HMAC ` prefix must be stripped before comparison, and the comparison must be
  `crypto.timingSafeEqual` **with an explicit length guard** (the Openpay lesson — `timingSafeEqual`
  throws on length mismatch).
- Because the signature covers only the body, **replay protection cannot come from the signature.** See
  OQ-16 in §9 — mitigation must be value-idempotency plus a status-monotonicity guard, not a timestamp
  window.
- Recommendation: keep the panel's header name at the default `Authorization` so the contract stays
  boring and greppable; if a custom header is chosen it becomes a second piece of config to carry.

### 7.4 OQ-7 CLOSED — secret provenance

**HMAC: the secret is OURS.** The docs say the signature is computed "usando tu clave secreta" — we
generate it and paste it into the panel. Bearer is the inverse ("token proporcionado por nosotros",
i.e. Skydropx issues it). Since we pick HMAC, `webhookSecret` is a value we generate (e.g.
`openssl rand -hex 32`) and enter in BOTH the admin provider-settings form and the Skydropx panel.
This is friendlier than Openpay's flow and matches the existing `webhookPassword` mental model.

**Activation note (operational):** the help center says webhooks may need to be enabled for the account
by writing to `hola@skydropx.com`. If the Webhooks section is not visible in the panel, that request is
a prerequisite, not a bug in our code.

### 7.5 OQ-8 CLOSED — a label-ready signal exists

The help center opens with: *"webhooks envían información … cada vez que ocurre un evento relevante,
como **la creación de una guía** o una actualización en el seguimiento de un envío"*, and every package
event payload carries `attributes.label_url`. Combined with the `created` status in the tracking
vocabulary, the first package event for a shipment is the label-ready signal.

**Therefore the webhook alone CAN complete a `label_pending` fulfillment.** A scheduled re-poll job is
no longer required for correctness. It remains a defensible belt-and-braces addition (webhooks have no
delivery history — see §7.6 — so a permanently lost event has no replay path), but it is explicitly a
separate decision, not a dependency of slice W(a).

### 7.6 OQ-9 CLOSED — delivery, retries, and the "no history" hazard

- Skydropx expects **HTTP 200 OK**. The panel's "Probar API" button asserts a 200 before the webhook can
  be created.
- On failure: **2 additional retries at 5-minute intervals.** After that it gives up, emails an alert,
  and flags the webhook in the platform; an operator must click **"Restablecer"** to re-enable it.
- **There is NO delivery history.** The help center states this explicitly: *"actualmente no existe un
  historial de notificaciones enviadas, por lo que es importante asegurar que tu sistema las procese
  correctamente."* A dropped event is gone.
- Multiple webhook URLs per account are allowed (no limit), and a webhook can be deactivated/reactivated
  from the three-dot menu.

Design consequences:
- Total delivery budget is ~10 minutes across 3 attempts. Returning 5xx on a transient DB error is
  *survivable but not generous*; returning 5xx on a permanent condition (unknown shipment id) just burns
  the budget and then disables the webhook for every other order. **This argues strongly for
  200-ack-and-log on unknown shipment ids (OQ-15) and 5xx only for genuinely retryable failures.**
- Because a failing webhook gets DISABLED account-wide after 3 failures, an unhandled exception in our
  route is not a local bug — it silently stops label completion for all subsequent orders until someone
  notices the email. The handler must be defensively total.

### 7.7 Bonus finding — sandbox `auto_advance` makes the live gate cheap

`POST /api/v1/shipments` accepts `auto_advance: boolean`, **sandbox only**: *"simula la progresión
automática del tracking del envío (created → picked_up → in_transit → last_mile → delivered) cada
minuto, sin esperar al carrier real. En producción se ignora."*

This gives a deterministic, minute-by-minute end-to-end webhook exercise in sandbox without waiting on a
real carrier — the whole status ladder in ~5 minutes. The design should use it for the live gate instead
of inventing a manual test procedure. It is also a candidate provider-settings flag (sandbox-only), but
that is scope to weigh, not an obligation.

### 7.8 Panel registration values (what the operator enters)

| Panel field | Value |
|---|---|
| Nombre | e.g. `Mandi backend — paquetes` |
| URL | `https://<BACKEND_PUBLIC_URL>/hooks/skydropx` (route name is a design decision; must exist and return 200 before "Probar API" can pass) |
| Sección de Skydropx | Envíos / Paquetes (the section that emits `data.type: "packages"`) |
| Eventos | Package status events — at minimum `created` (label ready) and the delivery ladder (`in_transit`, `delivered`, `in_return`, `exception`, `canceled`) |
| Método de autenticación | **HMAC** (recommended; SHA-512 over the raw body) |
| Header | `Authorization` (default; keep it unless there is a reason not to) |

**Sequencing constraint:** the panel refuses to create a webhook whose test delivery does not return
200. So the endpoint must be deployed BEFORE registration. Registration is an apply-time step, not a
prerequisite.

---

## 8. Slice C — threading `requested_carriers`

### 8.1 Where it goes

`SkydropxQuotationRequest.quotation.requested_carriers?: string[]` **already exists and is unused**
(`types.ts:95`). Three call sites construct a quotation body; all go through `client.quoteAndPoll_` →
`client.createQuotation` (`client.ts:302`, `client.ts:341–367`):

| Call site | File:line | Audience |
|---|---|---|
| `calculatePrice` (checkout quote) | `service.ts:816–829` | `"storefront"` |
| `createFulfillment` fresh quote (D4) | `service.ts:925–938` | `"admin"` |
| `probeSkydropx` best-effort quotation | `workflows/steps/probes/skydropx.ts` | test-connection |

The client needs **no change** — the field is already on the request type; only the body literals gain
`requested_carriers`.

**Consistency requirement:** if the storefront quote restricts carriers but the fulfillment-time fresh
quote does not, the quoted price and the purchased label can come from different carriers. The existing
quote-vs-label rate-delta log (`service.ts:1000–1006`, spec Capability 6) would surface it — but as a
mystery, after the fact. **Both paths must pass the same list.**

### 8.2 Zero usable rates — the degrade path already exists

`fetchUsableRates_` (`service.ts:1454–1487`):

```ts
const usable = rates.filter(isUsableRate)
if (!usable.length) {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "Skydropx returned no usable rates for this shipment."
  )
}
```

`isUsableRate` (`service.ts:640–643`) requires `success === true`, finite `Number(total)`, and `status`
not in `{no_coverage, tariff_price_not_found, not_applicable, pending}`.

Audience-split messaging is already correct and must be preserved: `"storefront"` gets the generic
`"Skydropx could not quote this shipment."` because `calculatePrice` is reached from the **public
unauthenticated** `POST /store/shipping-options/:id/calculate` and Medusa passes `UNEXPECTED_STATE`
messages through verbatim; `"admin"` gets full detail. Both always log detail server-side.

**So the degrade-to-manual path needs no new machinery.** But the *message* becomes misleading: an
over-restrictive carrier list produces "Skydropx could not quote this shipment" with no hint that the
admin's own configuration caused it. **OQ-11** — should the admin-audience message name the restriction
(e.g. *"no usable rates among the allowed carriers: fedex, dhl"*)? Storefront wording must not change.

**OQ-12** — semantics of an **empty** allowed list: "no restriction" (omit `requested_carriers`) or
"nothing allowed" (guaranteed zero rates)? Omit-when-empty is the only safe default, and it is what
makes the field backward-compatible with every row saved before this change.

---

## 9. Idempotency / replay / ordering — enumerated, not solved

- **OQ-13 (duplicate delivery)** — Skydropx may deliver the same event more than once. Writing
  `label_url`/`tracking_number` twice is idempotent by value; appending a *label row* twice is not.
  Needs an explicit "already completed → ack and no-op" branch.
- **OQ-14 (out-of-order status)** — `delivered` arriving before `in_transit`. Monotonic status ladder or
  last-write-wins? A regression from `delivered` back to `in_transit` is worse than dropping a stale event.
- **OQ-15 (unknown `shipment_id`)** — no matching fulfillment. 200-ack-and-log (accepts silent loss,
  avoids infinite retries) vs 404/5xx (triggers carrier retries, useful if the fulfillment is merely not
  yet committed — a real race, since `createFulfillment` returns *after* the shipment exists at
  Skydropx). Interacts directly with OQ-9.
- **OQ-16 (replay)** — without a timestamp in the signed message (OQ-6), a captured valid delivery can be
  replayed indefinitely. Mitigation then requires event-id dedupe, which requires OQ-5 to expose an event id.
- **OQ-17 (event ↔ fulfillment cardinality)** — one Skydropx shipment maps to one Medusa fulfillment
  today (single `package_number: "1"`). Confirm PRO does not emit per-package events.
- **OQ-18 (do not trust the payload)** — the Openpay precedent re-fetches server-side. Should the
  Skydropx webhook likewise call `getShipment(shipment_id)` rather than trust the payload's `label_url`?
  Cost: an outbound authenticated call per delivery (rate limit **2 req/s**). Benefit: consistency with
  the established security posture, immunity to a forged/stale payload. Lean re-fetch, but it is a design
  call with a real latency/rate-limit cost.
- **OQ-19 (concurrency)** — the in-band poll loop and a webhook delivery can race on the same fulfillment.
  Both write the same values, so the risk is a duplicate label row (OQ-2/OQ-13), not corruption. Note
  §3.3: `data` is whole-object replace, so a merged read-modify-write is mandatory.

---

## 10. Test surfaces (strict TDD — RED first, no tests written in this phase)

| New/changed surface | Spec file | Model to copy |
|---|---|---|
| Webhook signature verification | `modules/skydropx-fulfillment/__tests__/webhook.unit.spec.ts` (new) | `openpay-payment/__tests__/webhook.unit.spec.ts` — valid/invalid/absent/odd-length auth; `timingSafeEqual` length guard; rotation A-rejected/B-accepted with no restart; source `null` → reject-all; "never logs the secret" scan |
| Webhook payload → fulfillment mapping | same file | unknown `shipment_id`; duplicate delivery; out-of-order status; missing fields |
| Route handler | `api/.../__tests__/` (new) — first custom-route spec in repo | nearest is `public-config.unit.spec.ts` |
| Fulfillment-update workflow step | `workflows/steps/__tests__/` (new) | `validate-provider-payload.unit.spec.ts` / `resolve-probe-credentials.unit.spec.ts` |
| `requested_carriers` threading | `modules/skydropx-fulfillment/__tests__/service.unit.spec.ts` (extend) | assert the field on the **wire body** for both `calculatePrice` and `createFulfillment`, and assert **omitted** when the list is empty |
| Zero-rates-under-restriction | same | existing `fetchUsableRates_` degrade cases; storefront message unchanged |
| Layer-parity assertions (R-B) | `validate-provider-payload.unit.spec.ts`, middlewares spec, `form-model.unit.spec.ts`, `seed-provider-settings.unit.spec.ts`, `resolve-probe-credentials.unit.spec.ts` | the S1 `R1–R7` pattern — one assertion per layer |
| Mode-switch with 3 secrets | `validate-provider-payload.unit.spec.ts` | existing mode-switch reject/accept cases — must cover the §5 back-compat hazard |

---

## 11. Consolidated open questions

**CLOSED by orchestrator introspection (§3.3):** OQ-1 (`updateFulfillmentWorkflow` accepts `data`),
OQ-2 (labels appendable via `createShipmentWorkflow`, which also stamps `shipped_at`),
OQ-3 (fulfillment- and order-level lifecycle workflows enumerated). New sub-question **OQ-3a**:
fulfillment-level vs order-level workflows for status events.

**CLOSED by the official webhook docs (§7):** OQ-5 (payload shape — `data.type: "packages"`, shipment id
at `relationships.shipment.data.id`, `label_url` + `tracking_number` in `attributes`), OQ-6 (HMAC-SHA512
over the raw body, lowercase hex, `Authorization: HMAC <sig>`, configurable header name), OQ-7 (the HMAC
secret is ours to generate), OQ-8 (**a label-ready signal exists** — `label_url` rides every package
event, so no re-poll job is required for correctness), OQ-9 (2 retries at 5-minute intervals, expects
200, **no delivery history**, webhook auto-disables after 3 failures), OQ-10 (full 12-value status
vocabulary).

**Still blocking slice W:**
- OQ-3a — fulfillment-level vs order-level workflow choice, and whether "label ready" should stamp `shipped_at`.
- OQ-4 — raw-body availability for HMAC on a Medusa custom route (the only remaining code-side unknown).
- §5 mode-switch/back-compat hazard for a third skydropx secret.
- New: **the auto-disable hazard (§7.6)** — a single unhandled exception disables the webhook for the
  whole account after 3 failures. The handler must be total, and the unknown-shipment path must ack.

**Blocking slice C:**
- OQ-12 — empty-list semantics (recommend: omit → no restriction).
- §6 — array vs comma-separated string; free text vs enum.

**Non-blocking but decide explicitly:** OQ-9/OQ-10, OQ-11, OQ-13–OQ-19.

---

## 12. Slice sketch and review-budget forecast

Budget: **600 changed lines per PR**, `auto-forecast`.

| PR | Content | Rough size | Risk |
|---|---|---|---|
| **C1** | Carrier list through all ~8 applicable layers (L1, L2, L5–L8, seed, both quote call sites) + specs | ~450–550 | Low. Self-contained, backward-compatible when the list is empty, no new public surface. |
| **W1** | Provider-settings `webhookSecret` (L1, L2, L5–L8, seed) + HMAC-SHA512 verification seam + specs | ~400–500 | Medium — the mode-switch back-compat hazard lives here. |
| **W2** | Custom webhook route + workflow/step + payload→fulfillment mapping + specs | ~500–600 | Medium (was High) — the payload and HMAC contracts are now verified (§7); only OQ-4 and OQ-3a remain. Still the first custom public route in the repo. |

**Ordering is now genuinely open.** The original "C first" recommendation was driven by W being blocked
on unverified external contracts; §7 removed that blocker. W(a) is the higher-value slice (it is the
user's stated primary driver: labels that arrive late currently require manual reconciliation), and its
remaining unknowns are internal and cheap to settle. C stays the smaller, safer slice.

What has NOT changed: the discipline that produced the `GET /shipments/undefined → 404` incident, where
*"the unit tests passed because the mocks encoded the same wrong assumption"* (`types.ts:160–170`). The
fixtures for the webhook specs must be transcribed from the §7.1 payload verbatim, not invented.

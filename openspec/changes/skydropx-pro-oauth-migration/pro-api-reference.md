# Skydropx PRO API — verified reference (from official api-docs)

Source: https://pro.skydropx.com/es-MX/api-docs (fetched during explore/proposal).
This is the authoritative wire-shape reference that closes most `TODO(sandbox-verify)`
markers for gate S5.0b. Field names below are copied from the official OpenAPI doc.

## Hosts & limits
- **API host (production):** `api-pro.skydropx.com` (doc note: "Asegúrate de usar el host correcto: api-pro.skydropx.com"). Doc curl examples use `pro.skydropx.com`; confirm the exact host per environment in sandbox.
- **Token TTL:** `expires_in: 7200` (2 hours).
- **Rate limit:** 2 requests/second.
- All requests `Authorization: Bearer {access_token}`.
- SSRF allowlist impact: hosts are under `*.skydropx.com` → existing `isAllowedSkydropxBaseUrl` guard still matches. Verify `api-pro.skydropx.com` specifically.

## 1. OAuth token — `POST /api/v1/oauth/token`
Request (form or JSON): `grant_type=client_credentials`, `client_id`, `client_secret` (optional `scope`).
Response 200:
```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 7200, "scope": "read write", "created_at": 1784584350 }
```
Errors: 400 `{error, error_description}` (missing creds), 401 (invalid creds).
Also available: `POST /api/v1/oauth/revoke`, `POST /api/v1/oauth/introspect`.

## 2. Create quotation — `POST /api/v1/quotations`  (ASYNC, two-step)
Request:
```json
{ "quotation": {
    "address_from": { "country_code":"MX", "postal_code":"64000", "area_level1":"Nuevo León", "area_level2":"Monterrey", "area_level3":"Monterrey Centro", "tax_id_number":"…" },
    "address_to":   { "country_code":"MX", "postal_code":"64000", "area_level1":"…", "area_level2":"…", "area_level3":"…" },
    "parcels": [ { "length":10, "width":10, "height":10, "weight":2, "package_protected":false, "declared_value":100 } ],
    "requested_carriers": ["fedex","dhl"]   // optional
} }
```
> **Key change vs legacy:** quotation now requires the **full address hierarchy** (`area_level1/2/3` = state/city/neighborhood), not just origin/destination zip. `order_id` optional.

Response 201: `{ "id", "is_completed": bool, "quotation_scope", "rates": [...], "packages": [...] }`.
Rates fill **progressively** — poll GET below until `is_completed: true`.

## 3. Get quotation (poll) — `GET /api/v1/quotations/{id}`
Returns same shape; read `rates[]` when `is_completed: true`. **Rates valid 24h.**

### Rate object (relevant fields)
```
id                          // rate_id used to create the shipment
success                     // bool
status                      // pending | approved | no_coverage | coverage_checked | price_found_internal/external | tariff_price_not_found | not_applicable
provider_name               // e.g. "fedex"
provider_service_name/code  // service selection
currency_code               // "MXN"
amount    (string)          // base rate (NO IVA)
total     (string)          // rate total = shipping + IVA + service fee  ← USE THIS
vat_fee   (string|null)     // IVA amount (separate)
days      (integer)         // delivery days
service_fee (float|null)
total_value_with_protection // total + insurance
shipment_creation_type      // single | multipackage | multishipment
requires_origin_verification// bool — if true, shipment creation fails until origin address verified for that carrier
```

### IVA resolution (gate S5.0b — RESOLVED)
`total_value_with_protection` doc: *"…incluye el total de la tarifa (costo del envío, IVA y cargo por servicio cuando aplica) más el valor de la protección."*
→ `rate.total` is **IVA-inclusive**. Using `calculated_amount = Number(rate.total)` with
`is_calculated_price_tax_inclusive: true` is CORRECT. `rate.amount` excludes IVA; `vat_fee` is the tax line.

## 4. Create shipment / buy label
Two options:

### 4a. From an existing quotation — `POST /api/v1/shipments` (→ 202)
```json
{ "shipment": {
    "rate_id": "…",
    "address_from": { "street1","name","company","phone","email","reference","tax_id_number", "address_template_id?" },
    "address_to":   { "street1","name","company","phone","email","reference","tax_id_number" },
    "packages": [ { "package_number":"1", "package_protected":bool, "declared_value":num, "consignment_note":"53102400", "package_type":"4G" } ]
} }
```
> **MX new required fields for label:** `consignment_note` (Carta Porte SAT code) and `package_type`. Sandbox extra: `auto_advance:true` simulates tracking progression.

### 4b. One-shot (no prior quotation) — `POST /api/v1/rate/shipments` (→ 201)
Sends address+parcel+carrier in one call, computes price internally, returns label directly. Simpler for admin label purchase. `timeout` (seconds) supported.

### Shipment/label response
`master_tracking_number`, `label_url` (top-level in `/rate/shipments`; in `included[].attributes.{tracking_number,label_url,tracking_status}` for the resource form). `workflow_status`: pending/success. `error_detail: {error_code,error_message,error_message_detail}`.

## 5. Cancel — `POST /api/v1/shipments/{shipment_id}/cancellations`
Body `{ "reason": "…" }` → `{ id, reason, status:"approved", success:true }`. (Replaces legacy `POST /labels/{id}/cancel`.)

## 6. Tracking
- `GET /api/v1/shipments/tracking?tracking_number=…&carrier_name=…` → list of events.
- Webhooks (Conexiones > Webhooks): package status events (`delivered`, `in_transit`, `in_return`, …) with HMAC-SHA512 auth (recommended) or Bearer.

## 7. Errors (uniform)
`{ "error": "invalid_request", "error_description": "…" }` OR `{ "errors": { field: [msgs] } }`.
Statuses: 400 bad_request, 401 unauthorized (invalid token), 403 forbidden, 404 not_found, 422 unprocessable_entity (e.g. "Fondos insuficientes"), 429 too_many_requests.

## Impact summary for the migration
- **Auth:** single `apiKey` (`Token token=`) → `clientId`+`clientSecret` → cached Bearer (2h TTL) via `/oauth/token`.
- **Quote:** single synchronous call → async POST + poll GET within the 8s checkout budget; requires full destination address (state/city/neighborhood), not just zip.
- **IVA:** use `rate.total` (tax-inclusive) → `is_calculated_price_tax_inclusive: true` confirmed.
- **Label:** two-step (or `/rate/shipments` one-shot); MX requires `consignment_note` + `package_type`.
- **Cancel:** new cancellations endpoint.
- Endpoints/field names above remove nearly all `TODO(sandbox-verify)` markers; remaining unknowns to confirm in sandbox: exact host (`api-pro` vs `pro`), carrier `consignment_note`/`package_type` sourcing, and `requires_origin_verification` handling.

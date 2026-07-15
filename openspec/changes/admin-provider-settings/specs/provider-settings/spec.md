# Provider Settings Specification

> Change: `admin-provider-settings` · Phase: spec · Status: draft
> Inputs: `proposal.md` (required), `explore.md` (context), orchestrator decision on proposal open question #1 (DB strictly authoritative post-seed).
> Scope note: this spec describes WHAT must be observably true. Cache/invalidation mechanics, the Openpay probe endpoint choice, and public-endpoint caching (proposal open questions #2, #4, #5) are design-owned; this spec constrains only their observable behavior.

## Purpose

Allow a store admin to manage payment/shipping provider credentials (Openpay, Skydropx, Mercado Pago) from the Medusa Admin panel, with the database as the single source of truth: encrypted at rest, masked on read, effective without restarts, fail-safe when unconfigured, and consumable by the storefront at runtime without rebuilds.

## Definitions

- **Provider**: one of `openpay` (payment), `skydropx` (fulfillment), `mercadopago` (payment, settings-only in this change).
- **Credential set**: the full group of values a provider needs to operate, including secret values (private keys, API keys, tokens, webhook secrets) and public values (merchant id, public key, sandbox flag).
- **Mode**: `sandbox` or `production`. Exactly one mode is active per provider at any time.
- **Unconfigured**: no valid, decryptable, complete credential set exists in the DB for a provider.
- **Propagation window**: the maximum delay between a successful settings save and the moment the change is observable in all consuming paths (payment sessions, webhook verification, public config endpoint). A saved change MUST be effective for new operations within **30 seconds** and SHOULD be effective immediately. The mechanism that achieves this (per-request read, TTL cache, save-triggered invalidation) is a design decision.

## Requirements

### Requirement: Persisted Provider Credential Sets

The system MUST persist at most one active credential set per provider in the database, covering all values each provider needs to operate, including webhook secrets, plus the active mode.

Per-provider shapes (requirement-level, mirroring today's env contract):

- `openpay`: merchant id, private key (secret), public key, sandbox flag, webhook user (secret), webhook password (secret).
- `skydropx`: API key (secret), base URL (optional, defaulted), origin zip.
- `mercadopago`: access token (secret), webhook secret (secret), public key.

#### Scenario: Save creates a single active set

- GIVEN a provider with no stored settings
- WHEN an admin saves a complete credential set for that provider
- THEN exactly one active credential set exists for the provider in the DB
- AND saving again replaces (upserts) the same set rather than accumulating rows

### Requirement: Secrets Encrypted at Rest

Secret values MUST be stored encrypted using authenticated encryption (AES-256-GCM class) with a key-encryption key (KEK) provided via a single environment variable. Plaintext secrets MUST never be written to the database or to logs. If a stored value cannot be decrypted (wrong KEK, corruption), the provider MUST be treated as unconfigured — the failure MUST NOT crash boot or requests.

#### Scenario: Stored value is not plaintext

- GIVEN an admin saves an Openpay private key
- WHEN the corresponding DB row is inspected
- THEN the secret column content is ciphertext, not the pasted value

#### Scenario: Undecryptable secret fails safe

- GIVEN a stored credential set whose ciphertext cannot be decrypted with the current KEK
- WHEN the provider attempts to resolve credentials
- THEN the provider behaves as unconfigured (see Fail-Safe requirement)
- AND an operational log entry records the decryption failure without leaking secret material

### Requirement: Masked Secret Reads

No API response — admin or store — SHALL ever contain a plaintext secret. (Spec decision for open question #6:) masked reads MUST render each secret as a fixed mask followed by the last 4 characters (e.g., `••••1234`) when the plaintext length is 8 characters or more, and as a fully masked fixed-width value otherwise. Masked reads MUST include per-provider metadata: whether a set is configured, the active mode, and the last-updated timestamp; the acting admin's identity SHOULD be included when available.

#### Scenario: Admin reads saved settings

- GIVEN Openpay settings are saved with private key ending `…abcd`
- WHEN the admin settings API returns Openpay settings
- THEN the private key field reads `••••abcd`
- AND the response includes `configured: true`, the active mode, and the last-updated timestamp
- AND no field in the response equals the stored plaintext

### Requirement: Admin Settings API

The system MUST expose admin-authenticated API routes to read (masked), save, clear, and test provider settings, using only GET, POST, and DELETE. All mutations MUST run through workflows. Save requests MUST be validated against the provider's shape: a save with a missing required field MUST be rejected with a descriptive validation error and MUST NOT partially persist.

#### Scenario: Partial save rejected

- GIVEN an admin submits Openpay settings without a webhook password
- WHEN the save endpoint processes the request
- THEN the request fails with a validation error naming the missing field
- AND the previously stored settings (if any) remain unchanged and active

#### Scenario: Delete clears configuration

- GIVEN a provider has saved settings
- WHEN the admin issues a delete for that provider's settings
- THEN the provider becomes unconfigured and fail-safe behavior applies within the propagation window

#### Scenario: Unauthenticated access denied

- WHEN a request without admin authentication hits any provider settings route
- THEN the request is rejected with an authentication error and no settings data is returned

### Requirement: Test Connection

Each provider MUST offer a test-connection operation that returns an explicit pass/fail result with a human-readable reason, without persisting anything. The operation MUST accept candidate credentials supplied in the request (so an admin can test before saving); when no candidates are supplied it MUST test the currently saved credentials. Probe fidelity is best-effort per provider (Skydropx: quotation probe; Openpay: cheapest authenticated call — endpoint choice is design-owned; Mercado Pago: token validity check) and the UI MUST label results accordingly. A probe MUST complete or time out within a bounded interval and report timeout as a failure.

#### Scenario: Valid sandbox credentials pass

- GIVEN valid Skydropx sandbox credentials entered in the form but not saved
- WHEN the admin runs test connection
- THEN the result is pass
- AND no settings are persisted or modified

#### Scenario: Invalid credentials fail with reason

- GIVEN an Openpay private key that the Openpay API rejects
- WHEN the admin runs test connection
- THEN the result is fail with a reason indicating an authentication/credential problem

### Requirement: Always-Registered Providers with Runtime Credential Resolution

Openpay and Skydropx providers MUST be registered at boot unconditionally — registration MUST NOT depend on provider env vars or DB state. Providers MUST resolve their credentials (including webhook secrets) from the DB at operation time, not at construction time. A successful settings save MUST be effective — for new payment sessions, fulfillment operations, and webhook verifications — within the propagation window, with no backend restart. Baseline providers (`pp_system_default`, `manual_manual`) MUST remain available regardless of custom provider state.

#### Scenario: Credential rotation without restart

- GIVEN checkout is operating with saved Openpay credentials
- WHEN an admin saves a new Openpay private key
- THEN new payment sessions use the new key within the propagation window
- AND the backend process is not restarted

#### Scenario: Boot without any provider env or DB config

- GIVEN no provider env vars and an empty settings table
- WHEN the backend boots
- THEN boot succeeds and both custom providers are registered
- AND each behaves as unconfigured

### Requirement: Fail-Safe Unconfigured Behavior

An unconfigured provider (no row, incomplete row, or undecryptable row) MUST fail safe: boot succeeds; checkout excludes the provider or gracefully rejects attempts to use it (never a crash or 5xx cascade); webhook deliveries for that provider are rejected (reject-all); fulfillment quoting returns no options from that provider. Errors surfaced to shoppers MUST NOT leak configuration details.

#### Scenario: Unconfigured provider in checkout

- GIVEN Openpay is unconfigured
- WHEN a shopper reaches payment selection
- THEN Openpay is not offered, or selecting it yields a graceful provider-unavailable failure
- AND other providers and `pp_system_default` continue to work

#### Scenario: Webhook to unconfigured provider

- GIVEN Openpay is unconfigured
- WHEN a webhook delivery arrives at the Openpay webhook endpoint
- THEN the delivery is rejected as unauthorized and no payment state changes

### Requirement: DB Strictly Authoritative After Seed

After the one-time seed, the database is the sole runtime source of provider credentials. Provider env vars MUST be read exactly once, at seed/migration time, and MUST NOT be consulted at runtime — including as a fallback when a DB row is missing or corrupt (such cases resolve to unconfigured, per Fail-Safe). This includes the currently lazy `SKYDROPX_TAX_INCLUSIVE` env read, which MUST move into DB-resolved settings. Only the KEK and `BACKEND_PUBLIC_URL` remain env-based.

#### Scenario: Env var changed post-seed has no effect

- GIVEN the seed has run and Openpay settings exist in the DB
- WHEN `OPENPAY_PRIVATE_KEY` in the environment is changed and the backend restarted
- THEN runtime behavior reflects only the DB-stored key

#### Scenario: Missing DB row does not fall back to env

- GIVEN the seed has run and an admin deletes Skydropx settings
- AND Skydropx env vars are still present in the environment
- WHEN a fulfillment quotation is requested
- THEN Skydropx behaves as unconfigured (no env fallback)

### Requirement: One-Time Idempotent Env Seed

A migration-time seed MUST import existing provider env vars into encrypted DB settings so current deploys keep working with no manual re-entry. The seed MUST be idempotent (re-running never duplicates or overwrites admin-modified settings), MUST only seed a provider whose full required env set is present (mirroring today's gating; partial sets are skipped), and MUST log per-provider outcomes (seeded / skipped-partial / skipped-absent / already-present) without logging secret values.

#### Scenario: Existing deploy survives upgrade

- GIVEN a deploy with complete Openpay and Skydropx env sets
- WHEN the migration and seed run
- THEN both providers operate identically to pre-upgrade behavior with no admin action

#### Scenario: Idempotent re-run preserves admin edits

- GIVEN the seed ran and an admin later rotated the Openpay key in the panel
- WHEN the seed runs again (e.g., redeploy)
- THEN the admin-rotated key remains active and no duplicate settings are created

#### Scenario: Partial env set is skipped and logged

- GIVEN only `OPENPAY_MERCHANT_ID` is set
- WHEN the seed runs
- THEN Openpay is not seeded, remains unconfigured, and the skip is logged with the reason

### Requirement: DB-Resolved Webhook Verification

Webhook authentication secrets MUST be resolved from the DB per delivery. For Openpay, Basic-auth verification MUST use the DB-stored webhook user/password (constant-time comparison semantics preserved); rotating the webhook password in admin MUST take effect for deliveries after the propagation window, with no restart. Missing or undecryptable webhook secrets → reject-all.

#### Scenario: Webhook password rotation

- GIVEN Openpay webhooks are verifying against password A
- WHEN an admin saves password B
- THEN a delivery authenticated with B after the propagation window is accepted
- AND a delivery still using A is rejected

### Requirement: Public Store Config Endpoint

The system MUST expose a public (store-scoped) API endpoint serving only non-secret provider config per provider: configured flag, active mode/sandbox flag, merchant id, and public key. The response MUST never include secret values under any condition. The endpoint MUST reflect saved changes within the propagation window. For an unconfigured provider it MUST indicate unconfigured rather than erroring. Response caching/versioning strategy is design-owned within the propagation-window constraint.

#### Scenario: Storefront fetches Openpay public config

- GIVEN Openpay is configured in sandbox mode
- WHEN the storefront requests the public config endpoint
- THEN the response contains Openpay's merchant id, public key, and sandbox flag
- AND contains no private key, webhook credentials, or other secret

#### Scenario: Public key rotation reaches the endpoint

- GIVEN the storefront previously fetched public config
- WHEN an admin saves a new Openpay public key
- THEN the endpoint serves the new key within the propagation window

### Requirement: Storefront Runtime Config Consumption

The storefront checkout MUST obtain Openpay public config (merchant id, public key, sandbox flag) at runtime from the public config endpoint instead of baked `NEXT_PUBLIC_OPENPAY_*` vars, so admin-side key rotation requires no storefront rebuild. When the endpoint is unavailable or reports unconfigured, the storefront MUST degrade exactly as it does today for missing env config: warn and disable Openpay card payments, leaving the rest of checkout functional.

#### Scenario: Key rotation without storefront rebuild

- GIVEN a deployed storefront build
- WHEN an admin rotates the Openpay public key in the panel
- THEN a new checkout session tokenizes with the new key after the propagation window, without a storefront redeploy

#### Scenario: Endpoint unavailable degrades gracefully

- GIVEN the public config endpoint is unreachable
- WHEN a shopper opens checkout
- THEN Openpay card payment is disabled with a logged warning and other payment paths still render

### Requirement: Mode Toggle — Single Active Set with Re-Entry

(Spec decision for open question #3, within the decided constraints: single active credential set; no dual stored sets; re-entry on mode change is acceptable.)

The mode toggle selects the mode for the credential set being saved; it MUST NOT take effect by itself. When an admin switches the form's mode away from the currently saved mode, the UI MUST require re-entry of that provider's secret values and MUST clearly warn that saving will replace the current credentials. Until a valid save for the new mode succeeds, the previously saved set and mode remain fully active. On successful save, the previous mode's credentials are replaced (not retained inactive).

#### Scenario: Toggling mode alone changes nothing

- GIVEN Openpay is configured and active in sandbox mode
- WHEN the admin flips the toggle to production but does not save
- THEN checkout and webhooks continue to operate with the sandbox credentials

#### Scenario: Mode switch requires re-entered secrets

- GIVEN Openpay is configured in sandbox mode
- WHEN the admin switches the form to production
- THEN secret fields are cleared and required, and a replacement warning is shown
- AND a save attempt without re-entered secrets is rejected by validation

#### Scenario: Successful mode switch replaces the set

- GIVEN the admin re-enters valid production credentials and saves
- THEN the production set becomes the single active set within the propagation window
- AND the sandbox credentials are no longer stored or usable

### Requirement: Admin Provider Settings UI

The admin panel MUST provide a Provider Settings section listing the three providers with their configuration status (configured/unconfigured, active mode, last updated). Each provider MUST have a form with: paste-keys inputs for its shape, sandbox/production toggle, masked display of saved secrets, a test-connection button with clear pass/fail feedback (including the best-effort probe label), and save/clear actions with success/error feedback. Actions MUST be disabled while a mutation or probe is pending, and displayed settings MUST refresh after a successful save or clear.

#### Scenario: Admin configures a provider end to end

- GIVEN an unconfigured Skydropx provider
- WHEN the admin opens Provider Settings, pastes credentials, runs test connection (pass), and saves
- THEN the UI shows Skydropx as configured with masked secrets and last-updated metadata
- AND the provider is usable in checkout/fulfillment within the propagation window with no restart

#### Scenario: Failed test connection is actionable

- GIVEN the admin pastes an invalid API key
- WHEN test connection runs
- THEN the UI shows a fail state with the returned reason, and saving remains possible but clearly at the admin's discretion

### Requirement: Mercado Pago Settings-Only

The system MUST store, validate, mask, and test Mercado Pago credentials (access token, webhook secret, public key) in a shape consumable by the future MP payment provider module (matching the options mapping: accessToken, webhookSecret; backendUrl stays env-based via `BACKEND_PUBLIC_URL`), without registering or activating an MP payment provider in this change. Test connection for MP MUST validate token usability. The public config endpoint MAY serve the MP public key once configured; checkout behavior for MP is unchanged (absent/blocked).

#### Scenario: MP credentials persist and validate without a module

- GIVEN the MP provider module does not exist
- WHEN an admin saves and tests MP credentials
- THEN settings persist encrypted, reads are masked, test connection reports token validity
- AND boot and checkout behavior are unchanged (no MP payment option appears)

## Testability Note

All new seams (crypto utility, settings resolution, masking, seed, probes, webhook verification) MUST be unit-testable with explicit options/fakes per the existing test patterns (no env dependence in unit tests); strict TDD applies at apply time. Success criterion 2 (no plaintext secrets in responses) MUST be pinned by tests.

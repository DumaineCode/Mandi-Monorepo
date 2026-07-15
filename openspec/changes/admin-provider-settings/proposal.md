# Proposal — admin-provider-settings

> Change: `admin-provider-settings` · Store: openspec · Status: proposed
> Inputs: `explore.md` (exploration), user-approved product decisions (authoritative)

## 1. Problem

Payment and shipping provider credentials (Mercado Pago, Openpay/BBVA, Skydropx) are managed exclusively through environment variables. This creates real operational pain:

- **Every credential change requires a redeploy/restart.** Options are injected once at boot via provider constructors, and providers are silently skipped when their env set is incomplete (explore §1–2). Rotating a key, switching sandbox↔production, or fixing a typo means editing deployment env and restarting the backend.
- **Misconfiguration is invisible.** Partial env sets cause a silent skip (console.warn only) — a provider "disappears" from checkout with no admin-facing signal and no way to diagnose without server access.
- **Public keys are duplicated and desync silently.** The storefront bakes `NEXT_PUBLIC_OPENPAY_*` / `NEXT_PUBLIC_MP_PUBLIC_KEY` into the Next.js bundle at build time (explore §4). Rotating a key backend-side without a storefront rebuild silently breaks card tokenization.
- **Store operators depend on developers.** Non-technical admins cannot see provider status, verify connectivity, or update credentials — all of it is a DevOps task today.

## 2. Current-State Gap

| Today | Gap |
|-------|-----|
| Env-gated boot registration; provider absent if env incomplete | No runtime activation; no admin visibility of provider state |
| Constructor-injected options; clients pre-bake auth headers at boot | Credential changes require restart; no rotation without downtime |
| Secrets 100% in env; no encryption utilities in repo | No secure persistence layer for credentials in DB |
| Webhook secrets (Openpay basic-auth, future MP x-signature) live in provider options | Webhook auth also frozen at boot; same restart constraint |
| Storefront public keys baked at build time via `NEXT_PUBLIC_*` | Key rotation silently desyncs storefront; requires redeploy of both apps |
| No admin UI/API for provider settings; no way to test connectivity | Operators cannot self-serve; misconfig only discovered at checkout failure |
| MP provider module does not exist ("slice S4") | MP credentials have no home at all — not even env consumption |

## 3. Desired Outcome

After this change, a store admin can open a **Provider Settings** section in the Medusa Admin panel and:

1. **Paste credentials** for Mercado Pago, Openpay, and Skydropx into per-provider forms (paste-keys only; no OAuth redirect).
2. **Toggle sandbox/production** per provider — a single active credential set per mode choice.
3. **Test connectivity** per provider with a "test connection" button that gives an immediate pass/fail signal before saving or activating.
4. **See changes take effect immediately** — no backend restart. Providers become always-registered and resolve credentials lazily from DB per request.
5. **Trust that secrets are safe**: credentials are stored encrypted (AES-256-GCM style) with a KEK that remains a single env var; secrets are always masked when read back through the API.
6. **Rotate keys without storefront redeploys**: a new public store API endpoint serves public (non-secret) provider config at runtime, replacing the storefront's dependency on baked `NEXT_PUBLIC_*` vars.

The DB becomes the **single source of truth** for provider credentials. Provider env vars are **deprecated**: a one-time seed/import from existing env vars during migration keeps current deploys working without manual re-entry. Only the KEK and `BACKEND_PUBLIC_URL` remain env-based.

## 4. Scope

### In scope

1. **Provider settings persistence** — first custom data model + migration in this repo: encrypted credential storage for the three providers, including webhook secrets (Openpay basic-auth user/password; MP webhook secret stored for future consumption).
2. **Encryption seam** — first crypto utility: AES-256-GCM-style encrypt/decrypt with env-provided KEK; secrets masked on all API reads.
3. **Admin API + workflows** — settings read/write/test-connection endpoints following the Module → Workflow → API Route architecture (mutations via workflows; GET/POST/DELETE only).
4. **Admin UI** — Provider Settings page(s) in the admin panel: per-provider paste-keys forms, sandbox/production toggle, masked secret display, test-connection button with clear pass/fail feedback.
5. **Runtime credential resolution** — reverse env-gated boot registration: providers always-registered, resolving credentials lazily from DB per request (covers API keys and webhook secrets). Unconfigured provider behaves safely (rejects/fails closed rather than crashing boot or checkout).
6. **Test-connection probes** — per-provider connectivity checks, acknowledging uneven probe surfaces (explore §7.6): Skydropx via quotation probe, Openpay via cheapest available authenticated call, MP via token validity check.
7. **Env migration path** — one-time seed/import of existing provider env vars into the DB on migration, so current deploys don't break; env vars documented as deprecated afterwards.
8. **Public config endpoint** — public store API route serving non-secret provider config (merchant id, public key, sandbox flag) at runtime; storefront checkout consumes it instead of `NEXT_PUBLIC_*` vars.
9. **Mercado Pago settings-only** — panel stores and validates MP credentials in a shape consumable by the future MP payment provider module (S4), which is NOT built here.

### Affected areas

- `apps/backend/medusa-config.ts` (registration strategy)
- `apps/backend/src/modules/openpay-payment/*`, `skydropx-fulfillment/*` (credential resolution, webhook auth)
- New: custom settings module (data model, migration), workflows, admin API routes, admin UI routes/forms, crypto util, public store config endpoint
- `apps/storefront` checkout config consumption (`openpay-wrapper.tsx`, constants) — switch from baked env to runtime public config
- Test infrastructure: unit tests for new seams (strict TDD active), integration setup inert fakes

## 5. Non-Goals

- MP OAuth / marketplace authorization flow (paste-keys only).
- MP payment provider module itself (slice S4 — settings must merely be consumable by it).
- Multi-tenant support (single store, single credential set per provider per mode).
- Automatic/scheduled key rotation.
- Dual stored credential sets per provider (sandbox AND production simultaneously persisted with instant switch) — the toggle selects a single active mode; re-entering keys on mode change is acceptable.
- Secrets management beyond the single env KEK (no KMS/vault integration).
- Changes to provider IDs or checkout payment flows beyond config delivery.

## 6. Success Criteria

1. An admin can configure Openpay, Skydropx, and MP credentials entirely from the admin panel, with zero backend restarts, and see the provider active in checkout immediately (Openpay/Skydropx; MP settings persist and validate).
2. Secrets at rest in the DB are encrypted; no plaintext secret ever appears in an API response (masked reads verified by tests).
3. "Test connection" returns an accurate pass/fail per provider against sandbox credentials.
4. Existing deploys survive the migration: env-seeded credentials work identically after upgrade with no manual re-entry.
5. Storefront checkout obtains Openpay public config at runtime from the new store endpoint; rotating the Openpay public key in admin takes effect without a storefront rebuild.
6. Webhook verification (Openpay basic-auth) uses DB-resolved secrets; rotating the webhook password in admin takes effect on the next webhook delivery.
7. A provider with no/invalid credentials fails safe: boot succeeds, checkout excludes or gracefully rejects the provider, webhooks reject-all.
8. All new seams covered per strict TDD (unit tests with explicit options/fakes, following existing test patterns in explore §6); integration suites green.

## 7. Risks

| Risk | Severity | Mitigation direction |
|------|----------|---------------------|
| Reversing env-gated boot registration touches live payment/fulfillment paths — regression risk in checkout and webhooks | High | Fail-safe defaults (unconfigured = inert, reject-all webhooks); keep `pp_system_default` / `manual_manual` baseline; integration tests before flipping registration |
| Lazy per-request credential resolution adds latency/DB load on hot checkout paths | Medium | Bounded caching with invalidation on settings save (design phase decision); measure before optimizing |
| KEK loss or rotation renders stored credentials undecryptable | Medium | Document KEK operational contract; env-seed path doubles as recovery; masked-read design means re-paste is always possible |
| One-time env seed runs against a live deploy — partial/failed seed could silently drop a provider | Medium | Idempotent seed, explicit logging, env vars remain readable during a deprecation window as documented fallback story (exact fallback semantics = open question) |
| Test-connection probes are uneven (Openpay lacks a cheap ping; TODO(sandbox-verify) markers outstanding, runbook gates S2.0c/S5.0b open) | Medium | Treat probe fidelity per provider as best-effort and label it in UI; sandbox verification remains a separate gate |
| Storefront runtime config fetch adds a checkout dependency on a new endpoint | Medium | Endpoint serves only public data, cacheable; storefront degrades exactly as today (warn + disable card payments) when unavailable |
| MP settings shape guessed ahead of the S4 module — risk of rework | Low | Shape follows the already-defined options mapping (accessToken, webhookSecret, backendUrl) from medusa-config.ts |
| Greenfield everything (first model, migration, workflow, admin route, crypto util) — no in-repo patterns | Low | Skills (`building-with-medusa`, `building-admin-dashboard-customizations`) prescribe the patterns; follow them strictly |
| Review budget 600 lines/PR vs. broad surface | Process | Chained PRs expected (see §9) |

## 8. Open Questions (for spec/design phases)

1. **Env fallback during deprecation**: after the one-time seed, should the runtime ever fall back to env vars if a DB row is missing/corrupt, or is DB strictly authoritative post-migration? (Affects failure semantics and the deprecation timeline.)
2. **Cache/invalidation strategy** for lazy DB credential resolution (per-request read vs. TTL vs. save-triggered invalidation) — design decision with checkout-latency implications.
3. **Mode-toggle semantics on switch**: when toggling sandbox↔production, are previous-mode credentials cleared, retained-but-inactive, or must the admin re-enter? (User chose single active set; exact UX on switch is open.)
4. **Openpay test-connection probe**: which authenticated endpoint is cheapest/safest as a connectivity check given no ping API is wrapped today.
5. **Public config endpoint caching/versioning** for the storefront (fetch timing: per checkout render vs. cached with revalidation).
6. **Masked-read format** (e.g., last-4 display) and whether "credentials configured on {date} by {user}" metadata is shown.

## 9. Delivery Note

Per `openspec/config.yaml`: review budget is **600 changed lines per PR** with `auto-chain` delivery strategy. This change spans backend module/crypto/workflow/API, admin UI, registration refactor, storefront consumption, and migration/seed — a **chained-PR delivery is expected** (natural seams: persistence+crypto → runtime resolution/registration → admin UI → public endpoint+storefront → env seed/deprecation). Exact slicing is a tasks-phase decision.

## 10. Rollback

- Each PR slice must be independently revertible; the registration flip (env-gated → always-registered) is the highest-risk revert point and should land as an isolated, feature-coherent slice.
- Pre-migration behavior (env-driven) remains reconstructible: env vars are deprecated, not deleted, during the transition window; the runbook rollback procedure (remove env + restart) stays valid until deprecation completes.
- KEK remains env-based, so infrastructure rollback does not orphan secrets handling.

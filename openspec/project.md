# Project Context — mandi-oficial

pnpm/turbo monorepo for a Mexico-focused commerce platform.

## Stack

| Workspace | Package | Stack |
|-----------|---------|-------|
| apps/backend | @dtc/backend | Medusa 2.15.x |
| apps/storefront | @dtc/storefront | Next.js |

## Custom Backend Modules

- **openpay-payment** — Openpay payment provider (env-gated in `apps/backend/medusa-config.ts`)
- **skydropx-fulfillment** — Skydropx fulfillment provider (env-gated in `apps/backend/medusa-config.ts`)
- Mercado Pago payment provider also configured.
- Ops runbook: `docs/runbooks/mx-payments-shipping.md`

## Testing

- Runner: Jest (TEST_TYPE-scoped, experimental VM modules).
- Unit (green, strict TDD baseline): `cd apps/backend && pnpm test:unit`
- Integration: `pnpm test:integration:http`, `pnpm test:integration:modules` (run in apps/backend)
- **Strict TDD Mode: active** for backend unit-testable code.

## Conventions

- Technical artifacts in English.
- Medusa architecture rules: see `.agents/skills/building-with-medusa/SKILL.md`
  (workflows for all mutations, GET/POST/DELETE only, prices stored as-is,
  `query.graph()`/`query.index()` for cross-module data, camelCase module names).

## SDD Session Preferences

- Artifact store: `openspec` (files in repo)
- Execution mode: interactive
- Delivery strategy: auto-chain (chained PR auto-forecast)
- Review budget: 600 changed lines per PR

import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Provider registration (admin-provider-settings slice 3 — registration flip).
 *
 * Openpay and Skydropx are ALWAYS registered with empty options: credentials
 * are resolved from the DB-backed providerSettings module per operation, not
 * injected at boot. An unconfigured provider is inert and fail-safe (payment
 * sessions rejected gracefully, webhooks reject-all, quotes degrade to manual
 * options) — boot never depends on provider env vars or DB state.
 */

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Cloud Postgres (Neon/Supabase/etc.) requires SSL. Only enable it in
    // production-like environments so local development AND the CI/test
    // integration Postgres (both non-SSL) keep connecting. The Medusa
    // integration test runners force NODE_ENV=test, so gating SSL off for
    // 'test' is what lets `test:integration:*` run against a local service.
    databaseDriverOptions:
      process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test'
        ? { connection: { ssl: { rejectUnauthorized: false } } }
        : {},
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
    {
      // DB-backed encrypted provider credential storage (admin-provider-settings
      // slice 1). The provider entries below resolve their credentials from
      // this module at operation time (slice 3).
      resolve: './src/modules/provider-settings',
    },
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          // pp_system_default stays available: the payment module loader
          // registers the system provider unconditionally, independent of
          // this providers list (verified against @medusajs/payment 2.15.5
          // loaders/providers.js — design R4 / PF-3 boot scenario).
          {
            // Always registered (slice 3); credentials DB-resolved per op.
            resolve: './src/modules/openpay-payment',
            id: 'openpay',
            options: {},
          },
          // Mercado Pago stays UNREGISTERED — the module directory lands in
          // slice S4. Its settings are persisted/validated only (settings-only
          // per spec); registration here would fail module resolution.
          // {
          //   resolve: './src/modules/mercadopago-payment',
          //   id: 'mercadopago',
          //   options: {},
          // },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          // Keep the starter's manual flat-rate provider (manual_manual) —
          // SD-3 requires checkout to always be completable via manual options.
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
          {
            // Always registered (slice 3); credentials DB-resolved per op.
            resolve: './src/modules/skydropx-fulfillment',
            id: 'skydropx',
            options: {},
          },
        ],
      },
    },
  ],
})

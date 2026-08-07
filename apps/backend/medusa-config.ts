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

const REDIS_URL = process.env.REDIS_URL

/**
 * Redis-backed infrastructure modules, registered only when REDIS_URL is set.
 *
 * Medusa always provides these concerns; the difference is where the state
 * lives. The defaults are in-memory, which is correct for a single developer
 * process and wrong for a deployed container: a restart drops queued events, so
 * subscribers that were mid-flight (order confirmation mail, inventory
 * adjustments, payment webhooks) never run and leave no trace. The Redis
 * variants move that state out of the process, so a redeploy resumes instead of
 * forgetting.
 *
 * Kept conditional so local development and CI — neither of which runs Redis —
 * fall back to the in-memory defaults untouched.
 *
 * Not registered here: the locking module. Its in-memory provider only becomes
 * unsafe once two Medusa processes share one database. Add the Redis locking
 * provider at the same time you scale past a single backend replica.
 */
const redisModules = REDIS_URL
  ? [
      {
        resolve: '@medusajs/medusa/cache-redis',
        options: { redisUrl: REDIS_URL },
      },
      {
        resolve: '@medusajs/medusa/event-bus-redis',
        options: { redisUrl: REDIS_URL },
      },
      {
        resolve: '@medusajs/medusa/workflow-engine-redis',
        // `redisUrl`, not `url`: the loader still accepts `url` but logs a
        // deprecation warning on every boot.
        options: { redis: { redisUrl: REDIS_URL } },
      },
    ]
  : []

/**
 * Whether to open the Postgres connection with TLS.
 *
 * Managed Postgres (Neon, Supabase, RDS) requires TLS; a Postgres container on
 * a private Docker network has no TLS compiled in and REFUSES the handshake
 * outright. One setting cannot serve both, and NODE_ENV cannot tell them apart:
 * a self-hosted deployment is NODE_ENV=production AND non-TLS, which is exactly
 * the combination the old heuristic got wrong.
 *
 * DATABASE_SSL states it explicitly instead. When unset, the previous
 * NODE_ENV-based behaviour still applies, so environments that never defined it
 * keep connecting exactly as before.
 */
const databaseSslSetting = process.env.DATABASE_SSL
const useDatabaseSsl =
  databaseSslSetting !== undefined && databaseSslSetting !== ''
    ? databaseSslSetting.trim().toLowerCase() === 'true'
    : process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test'

/**
 * Signing secrets, with a development-only fallback.
 *
 * The previous `process.env.JWT_SECRET || "supersecret"` is the upstream Medusa
 * starter default — a constant published in every copy of the template. The
 * admin dashboard and the auth API are exposed on a public domain, so anyone
 * could mint a valid admin token against a deployment that fell back to it. And
 * the fallback WAS silent: no log, no warning, a perfectly healthy boot.
 *
 * Compose-level `:?` guards only protect one start path. `docker run` of the
 * same image, `medusa user` in a one-off container, or a future deploy target
 * all bypass them. Refusing to boot puts the check where the risk actually is.
 */
function requireSecret(name: string, value: string | undefined): string {
  if (value) {
    return value
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} must be set in production. Generate one with: openssl rand -base64 32`
    )
  }

  return 'supersecret'
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Explicit flag rather than an inference from NODE_ENV — see useDatabaseSsl
    // above. Local development and the integration-test Postgres are both
    // non-TLS and keep working through the unset fallback.
    databaseDriverOptions: useDatabaseSsl
      ? { connection: { ssl: { rejectUnauthorized: false } } }
      : {},
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: requireSecret('JWT_SECRET', process.env.JWT_SECRET),
      cookieSecret: requireSecret('COOKIE_SECRET', process.env.COOKIE_SECRET),
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
              // Mercado Pago Checkout Pro (redirect) - always registered
              // (slice 3); credentials DB-resolved per op -> runtime provider id
              // pp_mercadopago_mercadopago (slice S4).
              {
                resolve: './src/modules/mercadopago-payment',
                id: 'mercadopago',
                options: {},
              },
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
    ...redisModules,
  ],
})

import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Env sets required to enable each optional provider (PF-2, PF-3).
 *
 * A provider is included ONLY when its FULL required env set is present.
 * Partial configuration logs a warning and skips the provider so boot always
 * continues (design amendment fix 5). Optional knobs (OPENPAY_SANDBOX,
 * SKYDROPX_BASE_URL) have safe defaults and never gate inclusion.
 *
 * NOTE: OPENPAY_PUBLIC_KEY is part of the documented env contract but is only
 * consumed by the storefront (NEXT_PUBLIC_OPENPAY_PUBLIC_KEY); the backend
 * provider does not need it, so it does not gate registration.
 */
const OPENPAY_REQUIRED_ENV = [
  'OPENPAY_MERCHANT_ID',
  'OPENPAY_PRIVATE_KEY',
  'OPENPAY_WEBHOOK_USER',
  'OPENPAY_WEBHOOK_PASSWORD',
]
const MERCADOPAGO_REQUIRED_ENV = [
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'BACKEND_PUBLIC_URL',
]
const SKYDROPX_REQUIRED_ENV = ['SKYDROPX_API_KEY', 'SKYDROPX_ORIGIN_ZIP']

function providerEnvReady(provider: string, required: string[]): boolean {
  const missing = required.filter((key) => !process.env[key])

  if (missing.length === required.length) {
    // Not configured at all — silently skip (provider simply not enabled).
    return false
  }

  if (missing.length > 0) {
    console.warn(
      `[medusa-config] Skipping ${provider} provider: partial configuration. ` +
        `Missing env vars: ${missing.join(', ')}`
    )
    return false
  }

  return true
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Cloud Postgres (Neon/Supabase/etc.) requires SSL. Only enable it outside
    // local development so your local non-SSL Postgres keeps working.
    databaseDriverOptions:
      process.env.NODE_ENV !== 'development'
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
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          // pp_system_default stays available: the payment module loader
          // registers the system provider unconditionally, independent of
          // this providers list (verified against @medusajs/payment 2.15.5
          // loaders/providers.js — design R4 / PF-3 boot scenario).
          ...(providerEnvReady('openpay', OPENPAY_REQUIRED_ENV)
            ? [
                {
                  // Module directory lands in slice S2; unreachable until the
                  // full Openpay env set above is configured.
                  resolve: './src/modules/openpay-payment',
                  id: 'openpay',
                  options: {
                    merchantId: process.env.OPENPAY_MERCHANT_ID,
                    privateKey: process.env.OPENPAY_PRIVATE_KEY,
                    sandbox: process.env.OPENPAY_SANDBOX !== 'false',
                    webhookUser: process.env.OPENPAY_WEBHOOK_USER,
                    webhookPassword: process.env.OPENPAY_WEBHOOK_PASSWORD,
                  },
                },
              ]
            : []),
          ...(providerEnvReady('mercadopago', MERCADOPAGO_REQUIRED_ENV)
            ? [
                {
                  // Module directory lands in slice S4.
                  resolve: './src/modules/mercadopago-payment',
                  id: 'mercadopago',
                  options: {
                    accessToken: process.env.MP_ACCESS_TOKEN,
                    webhookSecret: process.env.MP_WEBHOOK_SECRET,
                    backendUrl: process.env.BACKEND_PUBLIC_URL,
                  },
                },
              ]
            : []),
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
          ...(providerEnvReady('skydropx', SKYDROPX_REQUIRED_ENV)
            ? [
                {
                  // Module directory lands in slice S5.
                  resolve: './src/modules/skydropx-fulfillment',
                  id: 'skydropx',
                  options: {
                    apiKey: process.env.SKYDROPX_API_KEY,
                    baseUrl:
                      process.env.SKYDROPX_BASE_URL ||
                      'https://api.skydropx.com/v1',
                    originZip: process.env.SKYDROPX_ORIGIN_ZIP,
                  },
                },
              ]
            : []),
        ],
      },
    },
  ],
})

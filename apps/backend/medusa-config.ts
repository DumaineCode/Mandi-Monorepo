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
 * Reads an R2 env var, trimmed, treating a whitespace-only value as absent.
 *
 * These values are pasted into a Dokploy form field, which routinely carries a
 * trailing space along for the ride. Untrimmed, that space lands inside the
 * values it is concatenated into — `R2_ACCOUNT_ID` becomes part of the endpoint
 * HOSTNAME — and the deploy stays green: boot succeeds, the health check passes,
 * and the only symptom is an opaque DNS failure the first time someone uploads
 * an image from the admin, long after anyone connects it to the deploy.
 *
 * Whitespace-only counts as absent so the production guard below stays honest:
 * " " is not a configured bucket, and letting it satisfy the check would ship
 * exactly the ephemeral local storage the guard exists to prevent.
 */
function readR2Env(name: string): string | undefined {
  const value = process.env[name]?.trim()

  return value ? value : undefined
}

/**
 * Optional key prefix, normalized into an actual folder path.
 *
 * The provider concatenates the prefix RAW (`${prefix}${name}-${ulid}${ext}`),
 * so "media" does not create a folder — it writes the object
 * "mediaphoto-01ABC.jpg" at the bucket root. A leading slash is the mirror
 * mistake: "/media/" yields a key starting with "/", which renders as a double
 * slash in every public URL. Both are the same failure class
 * `requireR2PublicUrl` exists to prevent — the wrong value is not undone by
 * fixing the env var afterwards, because it is already baked into every image
 * row written while it was wrong. Normalizing here means the operator cannot
 * get it wrong in the first place.
 */
function normalizeR2Prefix(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const stripped = value.replace(/^\/+/, '')

  if (!stripped) {
    return undefined
  }

  return stripped.endsWith('/') ? stripped : `${stripped}/`
}

const R2_ACCOUNT_ID = readR2Env('R2_ACCOUNT_ID')
const R2_BUCKET = readR2Env('R2_BUCKET')
const R2_ACCESS_KEY_ID = readR2Env('R2_ACCESS_KEY_ID')
const R2_SECRET_ACCESS_KEY = readR2Env('R2_SECRET_ACCESS_KEY')
const R2_PUBLIC_URL = readR2Env('R2_PUBLIC_URL')
const R2_PREFIX = normalizeR2Prefix(readR2Env('R2_PREFIX'))

/**
 * The public base URL images are served from, validated and normalized.
 *
 * This is not a value that is merely read at render time. The provider
 * concatenates it into every URL it returns (`${file_url}/${key}`) and Medusa
 * then PERSISTS that string onto each image row. A malformed value is not a
 * runtime inconvenience you fix by editing an env var — it is baked into every
 * row written while it was wrong, and correcting it afterwards means rewriting
 * those rows or re-uploading the catalog.
 *
 * The protocol check earns its place because omitting it fails in the most
 * confusing way available: "cdn.example.com/photo.jpg" is a RELATIVE URL. The
 * upload succeeds, the bytes reach R2, the bucket is fine, and nothing logs an
 * error — but every browser resolves it against the current page, so the admin
 * requests /app/products/cdn.example.com/photo.jpg and renders a broken image.
 * The symptom points at storage while the cause is a missing "https://".
 * Refusing to boot costs one redeploy; failing silently costs a re-upload.
 */
function requireR2PublicUrl(value: string): string {
  if (!/^https?:\/\//.test(value)) {
    throw new Error(
      `R2_PUBLIC_URL must include the protocol (got "${value}"). ` +
        `Use the full public origin, e.g. https://${value.replace(/^\/+/, '')} — ` +
        `without it the provider stores relative URLs and every image 404s ` +
        `in both the admin and the storefront.`
    )
  }

  // The provider builds `${file_url}/${key}`, so a trailing slash here produces
  // a double slash in every URL it then persists.
  return value.replace(/\/+$/, '')
}

/**
 * Object storage for uploaded files, registered only when R2 is configured.
 *
 * With no `file` module registered Medusa falls back to @medusajs/file-local,
 * which writes into the container's own filesystem and hands back
 * http://localhost:9000/static/... URLs. Both halves of that are wrong once
 * deployed: the URL is unreachable from a browser, and the bytes live in a
 * layer that a redeploy replaces — every product image uploaded since the last
 * deploy 404s afterwards, while the database still points at them.
 *
 * Cloudflare R2 speaks the S3 API, so the stock S3 provider drives it. Two
 * details are R2-specific: `region` must still be sent because the AWS SDK
 * requires one, but R2 ignores its value ('auto' is the documented placeholder;
 * the bucket's real location is fixed at creation). And `file_url` must be the
 * PUBLIC custom domain, never the *.r2.cloudflarestorage.com endpoint — that
 * endpoint only answers signed requests, so images would come back 401.
 *
 * Kept conditional so local development and CI keep using the local provider
 * untouched. Production is guarded below instead, because there the fallback is
 * silent data loss rather than a convenience.
 */
const fileModules =
  R2_ACCOUNT_ID &&
  R2_BUCKET &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_PUBLIC_URL
    ? [
        {
          resolve: '@medusajs/medusa/file',
          options: {
            providers: [
              {
                resolve: '@medusajs/medusa/file-s3',
                id: 's3',
                options: {
                  file_url: requireR2PublicUrl(R2_PUBLIC_URL),
                  access_key_id: R2_ACCESS_KEY_ID,
                  secret_access_key: R2_SECRET_ACCESS_KEY,
                  region: 'auto',
                  bucket: R2_BUCKET,
                  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                  ...(R2_PREFIX ? { prefix: R2_PREFIX } : {}),
                },
              },
            ],
          },
        },
      ]
    : []

if (fileModules.length === 0 && process.env.NODE_ENV === 'production') {
  throw new Error(
    'R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and ' +
      'R2_PUBLIC_URL must all be set in production. Without them Medusa falls ' +
      'back to local file storage, which writes uploads into the container ' +
      'filesystem: every redeploy destroys them and leaves the database ' +
      'pointing at images that no longer exist. Refusing to boot is the only ' +
      'way that failure surfaces before customers see broken product pages.'
  )
}

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
    ...fileModules,
  ],
})

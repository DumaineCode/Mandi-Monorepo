import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

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
  }
})

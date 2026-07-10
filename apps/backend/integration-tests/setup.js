/**
 * Shared jest setup for all backend test suites (PF-1).
 *
 * Loaded via `setupFiles` in jest.config.js for all three test commands:
 * test:unit, test:integration:modules, and test:integration:http
 * (see testMatch globs in jest.config.js).
 *
 * Responsibilities:
 * 1. Load `.env.test` overrides (falls back to process env).
 * 2. Provide inert, non-gating test env defaults so suites never depend on
 *    real provider credentials.
 *
 * NOTE on provider env gating (S1 scope): medusa-config.ts only includes a
 * payment/fulfillment provider when its FULL required env set is present
 * (design amendment fix 5). Gating vars (OPENPAY_MERCHANT_ID, MP_ACCESS_TOKEN,
 * SKYDROPX_API_KEY, ...) are intentionally NOT faked here yet — their module
 * directories land in later slices (S2/S4/S5), and faking them now would make
 * the integration test boot resolve module paths that do not exist. Each
 * provider slice adds its full inert fake env set here together with the
 * module it enables.
 */
const { loadEnv } = require("@medusajs/utils")

loadEnv("test", process.cwd())

// Inert defaults for non-gating provider knobs. Real values are never
// required by any jest suite; provider unit tests pass options explicitly.
process.env.OPENPAY_SANDBOX = process.env.OPENPAY_SANDBOX ?? "true"
process.env.SKYDROPX_BASE_URL =
  process.env.SKYDROPX_BASE_URL ?? "https://api.skydropx.test/v1"

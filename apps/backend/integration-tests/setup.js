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
 * NOTE on provider registration (admin-provider-settings slice 3): Openpay
 * and Skydropx are ALWAYS registered with empty options and resolve their
 * credentials from the DB at operation time. Provider credential env vars
 * stay deliberately UNSET here — booting the app with zero provider env and
 * an empty settings table IS the fail-safe regression test (both providers
 * registered + inert, design §10).
 */
const { loadEnv } = require("@medusajs/utils")

loadEnv("test", process.cwd())

// No provider credential fakes: runtime code reads provider config from the
// DB only (spec: DB strictly authoritative). The inert SKYDROPX_BASE_URL and
// OPENPAY_SANDBOX knobs were removed with the slice-3 registration flip —
// nothing consults them at runtime anymore.

// Deterministic test KEK for the provider-settings module (admin-provider-
// settings slice 1, design §10). Base64 of the 32 ASCII bytes
// "0123456789abcdef0123456789abcdef" — NOT a real key. Needed by every
// suite that boots the app or the module so encryption is enabled and
// ciphertexts are reproducible across runs.
process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY =
  process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY ??
  "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="

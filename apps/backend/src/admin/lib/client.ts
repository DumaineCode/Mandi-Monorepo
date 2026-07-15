import Medusa from "@medusajs/js-sdk"

/**
 * Admin JS SDK instance (skill: building-admin-dashboard-customizations —
 * `data-sdk-always`). ALL admin API requests go through this so the session
 * auth header/cookie are attached automatically; never use raw fetch().
 *
 * Custom provider-settings routes are called with `sdk.client.fetch(...)`.
 */
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
})

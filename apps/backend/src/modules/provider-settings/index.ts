import { Module } from "@medusajs/framework/utils"

import ProviderSettingsModuleService from "./service"

/**
 * Provider settings module (design §1) — DB-backed, encrypted provider
 * credential storage with runtime resolution.
 *
 * Module key is camelCase (F3 — dashes break container property resolution).
 * Registered from medusa-config.ts via
 * `{ resolve: "./src/modules/provider-settings" }`.
 */
export const PROVIDER_SETTINGS_MODULE = "providerSettings"

export default Module(PROVIDER_SETTINGS_MODULE, {
  service: ProviderSettingsModuleService,
})

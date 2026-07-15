/**
 * One-time idempotent env → provider-settings seed (design §8).
 *
 * Run as a `medusa exec` script (safe on every deploy):
 *
 *   npx medusa exec ./src/scripts/seed-provider-settings.ts
 *
 * Exec scripts receive the fully-loaded container, so `providerSettings` is
 * resolvable here. This wrapper is intentionally thin: it only wires the
 * container-resolved service + logger + `process.env` into the pure,
 * unit-tested `seedFromEnv` core, which owns all mapping/idempotency/encryption
 * logic. Keeping the logic in the core means this container-dependent shell
 * needs no unit test (build-verified only).
 */
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PROVIDER_SETTINGS_MODULE } from "../modules/provider-settings"
import type ProviderSettingsModuleService from "../modules/provider-settings/service"
import { seedFromEnv } from "./seed-provider-settings.core"

export default async function seedProviderSettings({
  container,
}: {
  container: MedusaContainer
}): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const settings = container.resolve<ProviderSettingsModuleService>(
    PROVIDER_SETTINGS_MODULE
  )

  logger.info("[seed-provider-settings] Importing provider env vars into encrypted DB settings (idempotent)…")

  await seedFromEnv(settings, process.env, logger)

  logger.info("[seed-provider-settings] Done.")
}

/**
 * GET /admin/provider-settings (design §5) — all three providers, masked via
 * write-time `secret_hints`. Never decrypts; read-only, so no workflow.
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PROVIDER_SETTINGS_MODULE } from "../../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../../modules/provider-settings/service"
import {
  KNOWN_PROVIDERS,
  toMaskedProviderSetting,
  type MaskableProviderSettingRow,
} from "./helpers"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const service = req.scope.resolve<ProviderSettingsModuleService>(
    PROVIDER_SETTINGS_MODULE
  )

  const rows = await service.listProviderSettings({
    provider: [...KNOWN_PROVIDERS],
  })

  const byProvider = new Map(rows.map((row) => [row.provider, row]))

  res.json({
    provider_settings: KNOWN_PROVIDERS.map((provider) =>
      toMaskedProviderSetting(
        provider,
        (byProvider.get(provider) as MaskableProviderSettingRow | undefined) ??
          null
      )
    ),
  })
}

/**
 * /admin/provider-settings/:provider (design §5) — GET masked single read,
 * POST upsert via workflow (returns the masked read), DELETE clear via
 * workflow. GET/POST/DELETE only; no business logic in the route.
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PROVIDER_SETTINGS_MODULE } from "../../../../modules/provider-settings"
import type ProviderSettingsModuleService from "../../../../modules/provider-settings/service"
import { deleteProviderSettingsWorkflow } from "../../../../workflows/delete-provider-settings"
import { upsertProviderSettingsWorkflow } from "../../../../workflows/upsert-provider-settings"
import type { UpsertProviderSettingsBody } from "../../../middlewares"
import {
  KNOWN_PROVIDERS,
  toMaskedProviderSetting,
  type MaskableProviderSettingRow,
} from "../helpers"

const assertKnownProvider = (provider: string): void => {
  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown provider "${provider}". Expected one of: ${KNOWN_PROVIDERS.join(
        ", "
      )}.`
    )
  }
}

const readMasked = async (
  req: AuthenticatedMedusaRequest,
  provider: string
) => {
  const service = req.scope.resolve<ProviderSettingsModuleService>(
    PROVIDER_SETTINGS_MODULE
  )

  const [row] = await service.listProviderSettings({ provider }, { take: 1 })

  return toMaskedProviderSetting(
    provider,
    (row as MaskableProviderSettingRow | undefined) ?? null
  )
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { provider } = req.params
  assertKnownProvider(provider)

  res.json({ provider_setting: await readMasked(req, provider) })
}

export async function POST(
  req: AuthenticatedMedusaRequest<UpsertProviderSettingsBody>,
  res: MedusaResponse
): Promise<void> {
  const { provider } = req.params
  assertKnownProvider(provider)

  await upsertProviderSettingsWorkflow(req.scope).run({
    input: { provider, body: req.validatedBody },
  })

  res.json({ provider_setting: await readMasked(req, provider) })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { provider } = req.params
  assertKnownProvider(provider)

  const { result } = await deleteProviderSettingsWorkflow(req.scope).run({
    input: { provider },
  })

  res.json({
    provider,
    deleted: result.deleted,
    provider_setting: await readMasked(req, provider),
  })
}

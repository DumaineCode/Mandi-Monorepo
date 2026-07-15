/**
 * POST /admin/provider-settings/:provider/test-connection (design §5/§6) —
 * runs the best-effort probe via workflow. Body may carry candidate
 * credentials (test before save) or be empty (test stored). Returns
 * `{ ok, detail, checked_at }`; nothing is persisted except
 * `last_verified_at` on a passing probe.
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { testProviderConnectionWorkflow } from "../../../../../workflows/test-provider-connection"
import type { TestProviderConnectionBody } from "../../../../middlewares"
import { KNOWN_PROVIDERS } from "../../helpers"

export async function POST(
  req: AuthenticatedMedusaRequest<TestProviderConnectionBody>,
  res: MedusaResponse
): Promise<void> {
  const { provider } = req.params

  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown provider "${provider}". Expected one of: ${KNOWN_PROVIDERS.join(
        ", "
      )}.`
    )
  }

  const { result } = await testProviderConnectionWorkflow(req.scope).run({
    input: { provider, candidate: req.validatedBody ?? {} },
  })

  res.json(result)
}

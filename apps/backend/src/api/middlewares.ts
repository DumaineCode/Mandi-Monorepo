/**
 * Global API middlewares (design §5).
 *
 * Admin provider-settings mutations validate their bodies here via Zod +
 * `validateAndTransformBody`. The body schema is intentionally the loose
 * cross-provider shape (mode + optional is_enabled + provider fields) because
 * the strict per-provider shape depends on the `:provider` path param — that
 * business validation runs in the `validate-provider-payload` workflow step
 * (`logic-workflow-validation`), reusing the per-provider Zod schemas
 * exported from that step. `/admin/*` routes are framework-authenticated.
 */
import {
  defineMiddlewares,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { z } from "zod"

export const UpsertProviderSettingsBody = z
  .object({
    mode: z.enum(["sandbox", "production"]),
    is_enabled: z.boolean().optional(),
  })
  .passthrough()

export type UpsertProviderSettingsBody = z.infer<
  typeof UpsertProviderSettingsBody
>

/**
 * Candidate credentials are optional — an empty body tests stored credentials.
 *
 * FIX 1 (SSRF + secret exfiltration): this is a STRICT allowlist of the known
 * candidate fields, NOT a blanket `.passthrough()`. Unknown/hostile keys are
 * stripped (zod's default) so they can never reach an outbound probe request,
 * and a candidate `baseUrl` must at least be a syntactically valid URL here (its
 * host is further restricted to skydropx.com in the probe/merge layer). Field
 * set is the union across providers because `:provider` is a path param; the
 * strict per-provider shape is enforced by the workflow step.
 */
export const TestProviderConnectionBody = z
  .object({
    mode: z.enum(["sandbox", "production"]).optional(),
    // openpay
    merchantId: z.string().optional(),
    publicKey: z.string().optional(),
    privateKey: z.string().optional(),
    webhookUser: z.string().optional(),
    webhookPassword: z.string().optional(),
    // skydropx (PRO two-secret; .strip() drops anything unlisted, so both
    // secrets + Carta Porte public fields MUST be listed explicitly)
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    originZip: z.string().optional(),
    baseUrl: z.string().url().optional(),
    taxInclusive: z.boolean().optional(),
    consignmentNote: z.string().optional(),
    packageType: z.string().optional(),
    // mercadopago
    accessToken: z.string().optional(),
    webhookSecret: z.string().optional(),
  })
  .strip()

export type TestProviderConnectionBody = z.infer<
  typeof TestProviderConnectionBody
>

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/provider-settings/:provider",
      method: "POST",
      middlewares: [validateAndTransformBody(UpsertProviderSettingsBody)],
    },
    {
      matcher: "/admin/provider-settings/:provider/test-connection",
      method: "POST",
      middlewares: [validateAndTransformBody(TestProviderConnectionBody)],
    },
  ],
})

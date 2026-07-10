import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SkydropxFulfillmentProviderService from "./service"

/**
 * Skydropx fulfillment provider module (design §5).
 * Registered from medusa-config.ts with id "skydropx" only when the Skydropx
 * env set is present → runtime provider id `skydropx_skydropx`.
 */
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [SkydropxFulfillmentProviderService],
})

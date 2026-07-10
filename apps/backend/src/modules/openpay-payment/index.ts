import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import OpenpayPaymentProviderService from "./service"

/**
 * Openpay card payment provider module (design §6).
 * Registered from medusa-config.ts with id "openpay" only when the full
 * Openpay env set is present → runtime provider id `pp_openpay_openpay`.
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [OpenpayPaymentProviderService],
})

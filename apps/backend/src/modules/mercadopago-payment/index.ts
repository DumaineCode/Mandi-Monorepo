import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import MercadoPagoPaymentProviderService from "./service"

/**
 * Mercado Pago Checkout Pro payment provider module (design §4/§6).
 * Registered from medusa-config.ts with id "mercadopago" → runtime provider id
 * `pp_mercadopago_mercadopago`. Always registered; credentials DB-resolved.
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [MercadoPagoPaymentProviderService],
})

"use client"

import { Text } from "@modules/common/components/ui"

/**
 * The terms notice, directly above the inline CTA (settled decision 2, task
 * 2c.18).
 *
 * **Informational only.** Not a checkbox, and therefore never a
 * `MissingRequirementCode`: nothing here can block the order. Clicking
 * `Realizar pedido` IS the acceptance, which is what the copy says, and adding a
 * tick box would invent a new way for a ready cart to be refused.
 *
 * The wording is carried VERBATIM from the four-step `review/index.tsx` that
 * PR2c deletes. It is legal copy — rephrasing it while moving it would be a
 * legal change disguised as a refactor.
 *
 * On mobile it stays in the document flow, above the sticky bar rather than
 * inside it. The form column already reserves
 * `pb-[calc(6rem+env(safe-area-inset-bottom))]` so the bar cannot cover it.
 */
const LegalNotice = () => (
  <Text
    className="txt-medium-plus text-ink-muted"
    data-testid="checkout-legal-notice"
  >
    Al hacer clic en Realizar pedido, confirmas que leíste, entendiste y aceptas
    nuestros Términos de uso, Términos de venta y Política de devoluciones, y
    reconoces que leíste la Política de privacidad de MANDO.
  </Text>
)

export default LegalNotice

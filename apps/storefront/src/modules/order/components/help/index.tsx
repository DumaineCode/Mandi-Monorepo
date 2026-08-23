import { Heading } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import React from "react"

const Help = ({ headingLevel = "h2" }: { headingLevel?: "h2" | "h3" }) => {
  return (
    <aside className="rounded-2xl bg-teal p-5 text-ink">
      <Heading
        level={headingLevel}
        className="font-bricolage !text-xl font-bold"
      >
        ¿Necesitas ayuda con tu pedido?
      </Heading>
      <div className="mt-3 text-sm">
        <ul className="flex flex-wrap gap-x-6 gap-y-3 font-semibold underline decoration-ink/30 underline-offset-4">
          <li>
            <LocalizedClientLink href="/contact">
              Contáctanos
            </LocalizedClientLink>
          </li>
          <li>
            <LocalizedClientLink href="/contact">
              Devoluciones y cambios
            </LocalizedClientLink>
          </li>
        </ul>
      </div>
    </aside>
  )
}

export default Help

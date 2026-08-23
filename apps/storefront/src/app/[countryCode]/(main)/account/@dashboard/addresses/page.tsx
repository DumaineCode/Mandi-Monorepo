import { Metadata } from "next"
import { notFound } from "next/navigation"

import AddressBook from "@modules/account/components/address-book"

import { getRegion } from "@lib/data/regions"
import { retrieveCustomer } from "@lib/data/customer"

export const metadata: Metadata = {
  title: "Mis direcciones | MANDO",
  description: "Consulta y administra tus direcciones de envío.",
}

export default async function Addresses(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params
  const { countryCode } = params
  const customer = await retrieveCustomer()
  const region = await getRegion(countryCode)

  if (!customer || !region) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="addresses-page-wrapper">
      <header className="mb-8 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
          Mi cuenta
        </p>
        <h2 className="mt-2 font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
          Mis direcciones
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
          Guarda y actualiza tus direcciones de envío para encontrarlas listas
          al momento de pagar.
        </p>
      </header>
      <AddressBook customer={customer} region={region} />
    </div>
  )
}

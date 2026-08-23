import { Metadata } from "next"

import ProfilePhone from "@modules/account/components/profile-phone"
import ProfileBillingAddress from "@modules/account/components/profile-billing-address"
import ProfileEmail from "@modules/account/components/profile-email"
import ProfileName from "@modules/account/components/profile-name"
import { notFound } from "next/navigation"
import { listRegions } from "@lib/data/regions"
import { retrieveCustomer } from "@lib/data/customer"

export const metadata: Metadata = {
  title: "Mis datos | MANDO",
  description: "Consulta y actualiza los datos de tu cuenta MANDO.",
}

export default async function Profile() {
  const customer = await retrieveCustomer()
  const regions = await listRegions()

  if (!customer || !regions) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="profile-page-wrapper">
      <header className="mb-8 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
          Mi cuenta
        </p>
        <h2 className="mt-2 font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
          Mis datos
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
          Consulta y actualiza tu nombre, correo, teléfono y dirección de
          facturación.
        </p>
      </header>
      <div className="flex w-full flex-col gap-4">
        <ProfileName customer={customer} />
        <ProfileEmail customer={customer} />
        <ProfilePhone customer={customer} />
        <ProfileBillingAddress customer={customer} regions={regions} />
      </div>
    </div>
  )
}

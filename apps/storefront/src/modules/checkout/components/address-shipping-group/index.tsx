"use client"

import { HttpTypes } from "@medusajs/types"
import { useRef, useState } from "react"
import Addresses from "../addresses"
import Shipping from "../shipping"
import type { PrefetchedShipping } from "../shipping-address"

/**
 * Client wrapper that co-locates the `Addresses` and `Shipping` steps so the
 * background shipping-price prefetch produced during the address step can be
 * handed to the delivery step in-memory (prop-thread, no store / no context).
 *
 * `Addresses` and `Shipping` are siblings in the checkout form; this component
 * is the smallest client boundary that lets the prefetch result flow between
 * them while `Payment` and `Review` stay untouched server-rendered children.
 */
const AddressShippingGroup = ({
  cart,
  customer,
  availableShippingMethods,
}: {
  cart: HttpTypes.StoreCart
  customer: HttpTypes.StoreCustomer | null
  availableShippingMethods: HttpTypes.StoreCartShippingOption[] | null
}) => {
  // ref = authoritative latest value read synchronously by Shipping on mount;
  // state = triggers a re-render so a late-arriving prefetch still propagates.
  const prefetchRef = useRef<PrefetchedShipping | null>(null)
  const [prefetched, setPrefetched] = useState<PrefetchedShipping | null>(null)

  const handlePrefetch = (result: PrefetchedShipping) => {
    prefetchRef.current = result
    setPrefetched(result)
  }

  return (
    <>
      <Addresses
        cart={cart}
        customer={customer}
        availableShippingMethods={availableShippingMethods}
        onPrefetch={handlePrefetch}
      />

      <Shipping
        cart={cart}
        availableShippingMethods={availableShippingMethods}
        prefetchedShipping={prefetched}
      />
    </>
  )
}

export default AddressShippingGroup

import { Listbox, Transition } from "@headlessui/react"
import { ChevronUpDown } from "@medusajs/icons"
import { clx } from "@modules/common/components/ui"
import { Fragment, useMemo } from "react"

import compareAddresses from "@lib/util/compare-addresses"
import { formatCountryName } from "@lib/util/store-locale"
import { HttpTypes } from "@medusajs/types"
import Radio from "@modules/common/components/radio"

/**
 * The saved-address picker at checkout.
 *
 * This was the last component in the checkout flow still wearing the Medusa
 * starter's default theme — `bg-white`, `border-gray-300`, `rounded-rounded`,
 * `hover:bg-gray-50` — and still showing the starter's English placeholder
 * ("Choose an address") to a store that is otherwise entirely in Spanish. Both
 * were visible to every returning customer with a saved address, which is
 * exactly the customer least likely to forgive a half-translated checkout.
 *
 * Restyled onto the ink/cream/paper/coral palette the rest of the checkout
 * uses, and localized. The behaviour is unchanged.
 */
type AddressSelectProps = {
  addresses: HttpTypes.StoreCustomerAddress[]
  addressInput: HttpTypes.StoreCartAddress | null
  onSelect: (
    address: HttpTypes.StoreCartAddress | undefined,
    email?: string
  ) => void
}

/** One-line summary shown on the closed button. Enough to tell two saved addresses apart. */
const summarize = (address: HttpTypes.StoreCustomerAddress): string =>
  [address.address_1, address.address_2, address.postal_code]
    .filter(Boolean)
    .join(", ")

const AddressSelect = ({
  addresses,
  addressInput,
  onSelect,
}: AddressSelectProps) => {
  /**
   * `string | null`, not `string`, because {@link Listbox} is typed off its
   * `value` — and that value is `null` while nothing is selected. See the note
   * on the `value` prop below.
   */
  const handleSelect = (id: string | null) => {
    const savedAddress = addresses.find((a) => a.id === id)
    if (savedAddress) {
      onSelect(savedAddress as HttpTypes.StoreCartAddress)
    }
  }

  const selectedAddress = useMemo(() => {
    return addresses.find(
      (a) => addressInput && compareAddresses(a, addressInput)
    )
  }, [addresses, addressInput])

  return (
    /**
     * `?? null`, and it is load-bearing.
     *
     * Headless UI decides controlled-vs-uncontrolled with a bare
     * `value !== undefined` (`use-controllable.js`), ONCE, and then complains
     * for the rest of the component's life if that answer changes:
     *
     *   A component is changing from uncontrolled to controlled.
     *
     * `selectedAddress?.id` is `undefined` until the customer picks something,
     * so the Listbox was born uncontrolled and switched the instant it was used.
     * The bug was unreachable until a customer HAD a saved address — this whole
     * block is gated on `addressesInRegion?.length` in `shipping-address` — which
     * is why it surfaced the first time an address was saved from the account.
     *
     * `null` is a defined value, so the Listbox is controlled from first render,
     * and it matches no option's `value`, so "nothing selected" still renders as
     * the placeholder.
     */
    <Listbox onChange={handleSelect} value={selectedAddress?.id ?? null}>
      <div className="relative">
        <Listbox.Button
          className="relative flex h-12 w-full items-center justify-between rounded-xl border border-line bg-paper px-4 text-left text-base text-ink transition-colors hover:border-coral focus:border-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/20"
          data-testid="shipping-address-select"
        >
          {({ open }) => (
            <>
              <span
                className={clx("block truncate", {
                  "text-ink-muted": !selectedAddress,
                })}
              >
                {selectedAddress
                  ? summarize(selectedAddress)
                  : "Elige una dirección guardada"}
              </span>
              <span className="ml-2 shrink-0 text-ink-muted">
                <ChevronUpDown
                  className={clx("transition-transform duration-200", {
                    "rotate-180": open,
                  })}
                />
              </span>
            </>
          )}
        </Listbox.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-150"
          enterFrom="opacity-0 -translate-y-1"
          enterTo="opacity-100 translate-y-0"
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options
            className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-line bg-paper py-1 text-sm shadow-xl focus:outline-none"
            data-testid="shipping-address-options"
          >
            {addresses.map((address) => {
              const isSelected = selectedAddress?.id === address.id

              return (
                <Listbox.Option
                  key={address.id}
                  value={address.id}
                  className={({ active }) =>
                    clx(
                      "cursor-pointer select-none px-4 py-3 transition-colors",
                      {
                        "bg-cream": active,
                        "bg-cream/60": isSelected && !active,
                      }
                    )
                  }
                  data-testid="shipping-address-option"
                >
                  <div className="flex items-start gap-x-3">
                    <Radio
                      checked={isSelected}
                      data-testid="shipping-address-radio"
                    />
                    <div className="flex flex-col">
                      <span className="text-left font-semibold text-ink">
                        {address.first_name} {address.last_name}
                      </span>
                      {address.company && (
                        <span className="text-sm text-ink-muted">
                          {address.company}
                        </span>
                      )}
                      <div className="mt-1 flex flex-col text-left text-sm leading-6 text-ink-muted">
                        <span>
                          {address.address_1}
                          {address.address_2 && (
                            <span>, {address.address_2}</span>
                          )}
                        </span>
                        <span>
                          {address.postal_code}, {address.city}
                        </span>
                        <span>
                          {address.province && `${address.province}, `}
                          {/*
                           * The country NAME, not the raw ISO code. Every other
                           * address surface in the storefront (the account card,
                           * the country picker) resolves it through
                           * `formatCountryName`, and this one printing "MX" was
                           * the same address described two different ways on two
                           * screens of the same flow.
                           */}
                          {formatCountryName(
                            address.country_code,
                            address.country_code?.toUpperCase()
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </Listbox.Option>
              )
            })}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  )
}

export default AddressSelect

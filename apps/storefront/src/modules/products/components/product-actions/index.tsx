"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"
import Divider from "@modules/common/components/divider"
import OptionSelect from "@modules/products/components/product-actions/option-select"
import { isEqual } from "lodash"
import { useParams, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"
import { useRouter } from "next/navigation"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt) => {
    if (varopt.option_id) acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

export default function ProductActions({
  product,
  disabled,
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  // Deliberately NOT `useTransition`: a transition keeps `isPending` true until
  // React commits the update the action produced, and `addToCart` revalidates
  // the `carts` tag, so that commit waits on a full RSC refresh of this route.
  // The button would stay locked long after the item was already in the cart.
  // This flag tracks the mutation only, and is released the moment the server
  // confirms it; the refreshed tree lands on its own schedule.
  const [isAdding, setIsAdding] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const countryCode = useParams().countryCode as string

  // If there is only 1 variant, preselect the options
  useEffect(() => {
    if (product.variants?.length === 1) {
      const variantOptions = optionsAsKeymap(product.variants[0].options)
      setOptions(variantOptions ?? {})
    }
  }, [product.variants])

  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) {
      return
    }

    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // update the options when a variant is selected
  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  //check if the selected options produce a valid variant
  const isValidVariant = useMemo(() => {
    return product.variants?.some((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = isValidVariant ? selectedVariant?.id : null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
  }, [selectedVariant, isValidVariant])

  // check if the selected variant is in stock
  const inStock = useMemo(() => {
    // If we don't manage inventory, we can always add to cart
    if (selectedVariant && !selectedVariant.manage_inventory) {
      return true
    }

    // If we allow back orders on the variant, we can add to cart
    if (selectedVariant?.allow_backorder) {
      return true
    }

    // If there is inventory available, we can add to cart
    if (
      selectedVariant?.manage_inventory &&
      (selectedVariant?.inventory_quantity || 0) > 0
    ) {
      return true
    }

    // Otherwise, we can't add to cart
    return false
  }, [selectedVariant])

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = () => {
    const variantId = selectedVariant?.id

    if (!variantId) return

    setIsAdding(true)

    addToCart({
      variantId,
      quantity,
      countryCode,
    })
      .catch((error) => {
        // The previous code awaited without catching, so a failed add left the
        // button stuck on "Agregando…" forever. Containing the rejection keeps
        // the button usable and lets the shopper retry.
        console.error("Failed to add product to cart", error)
      })
      .finally(() => {
        setIsAdding(false)
      })
  }

  const decrement = () => setQuantity((q) => Math.max(1, q - 1))
  const increment = () => setQuantity((q) => q + 1)

  return (
    <>
      <div className="flex flex-col gap-y-2" ref={actionsRef}>
        <div>
          {(product.variants?.length ?? 0) > 1 && (
            <div className="flex flex-col gap-y-4">
              {(product.options || []).map((option) => {
                return (
                  <div key={option.id}>
                    <OptionSelect
                      option={option}
                      current={options[option.id]}
                      updateOption={setOptionValue}
                      title={option.title ?? ""}
                      data-testid="product-options"
                      disabled={!!disabled || isAdding}
                    />
                  </div>
                )
              })}
              <Divider />
            </div>
          )}
        </div>

        <ProductPrice product={product} variant={selectedVariant} />

        {(() => {
          const isDisabled =
            !inStock ||
            !selectedVariant ||
            !!disabled ||
            isAdding ||
            !isValidVariant

          const label =
            !inStock || !isValidVariant ? "Agotado" : "Agregar al carrito"

          return (
            <div className="mt-4 flex max-w-[420px] items-stretch gap-3">
              {/* Quantity stepper (wireframe lines 358-364) */}
              <div className="flex items-center rounded-xl border-[1.5px] border-ink">
                <button
                  type="button"
                  onClick={decrement}
                  // Kept locked while the add is in flight: the request already
                  // captured the quantity shown at click time, so a live stepper
                  // would display a number the cart never received.
                  disabled={quantity <= 1 || isAdding}
                  aria-label="Disminuir cantidad"
                  className="flex h-12 w-12 items-center justify-center rounded-l-[10px] text-xl transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40 motion-reduce:transition-none"
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  className="min-w-[48px] border-x-[1.5px] border-ink px-2 text-center font-bricolage text-base font-bold tabular-nums"
                  data-testid="product-quantity"
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={increment}
                  disabled={isAdding}
                  aria-label="Aumentar cantidad"
                  className="flex h-12 w-12 items-center justify-center rounded-r-[10px] text-xl transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40 motion-reduce:transition-none"
                >
                  +
                </button>
              </div>

              {/* Add to cart */}
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={isDisabled}
                aria-label={label}
                className={clx(
                  "flex h-12 flex-1 items-center justify-center rounded-xl bg-coral px-6 text-[15px] font-semibold text-coral-foreground transition-colors hover:bg-coral-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
                )}
                data-testid="add-product-button"
              >
                {isAdding ? "Agregando…" : label}
              </button>
            </div>
          )
        })()}
        <MobileActions
          product={product}
          variant={selectedVariant}
          options={options}
          updateOptions={setOptionValue}
          inStock={inStock}
          handleAddToCart={handleAddToCart}
          isAdding={isAdding}
          show={!inView}
          optionsDisabled={!!disabled || isAdding}
        />
      </div>
    </>
  )
}

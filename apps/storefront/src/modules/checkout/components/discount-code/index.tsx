"use client"

import { Badge, Heading, Text } from "@modules/common/components/ui"
import React from "react"

import { applyPromotions } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { useOptionalCheckoutActions } from "@modules/checkout/state/checkout-context"
import Trash from "@modules/common/icons/trash"
import ErrorMessage from "../error-message"

type DiscountCodeProps = {
  cart: HttpTypes.StoreCart
}

const DiscountCode: React.FC<DiscountCodeProps> = ({ cart }) => {
  const [errorMessage, setErrorMessage] = React.useState("")

  /**
   * `null` on the cart page, which renders this same component OUTSIDE
   * `CheckoutProvider`. There the `revalidateTag` inside `applyPromotions` is
   * still the whole mechanism and nothing has to be synced.
   */
  const checkout = useOptionalCheckoutActions()

  const { promotions = [] } = cart

  /**
   * 2b.8 / edge case 7 — apply the returned cart to client state.
   *
   * `applyPromotions` still calls `revalidateTag("carts")`, and until PR2a that
   * was the whole mechanism: the RSC pass re-ran and the summary re-rendered with
   * the new totals. The single-page checkout deliberately does not re-run that
   * pass for an in-flight mutation (D1), so the client no longer READS the
   * revalidation — a customer could apply a valid coupon and watch nothing at all
   * happen to their total.
   *
   * The sequence comes from the same counter every other cart write draws from,
   * allocated before the request goes out, so a promotion and an autosave that
   * overlap resolve by issue order rather than by arrival order.
   *
   * Allocating that sequence is NOT enough on its own, and an earlier revision of
   * this function stopped there. `CART_UPDATED` is guarded by
   * `action.sequence < state.issuedWriteSequence`, and only `CART_WRITE_STARTED`
   * advances `issuedWriteSequence` — so a promotion that drew sequence 1 and
   * never announced it was silently discarded the moment a field blur issued
   * sequence 2 while it was in flight. The customer applied a valid coupon and
   * watched nothing happen to their total: exactly the bug this block describes
   * fixing. Announcing the write is what makes the sequence mean anything.
   */
  const applyAndSync = async (codes: string[]) => {
    const sequence = checkout?.nextWriteSequence()

    if (checkout && sequence !== undefined) {
      checkout.dispatch({ type: "CART_WRITE_STARTED", sequence })
    }

    try {
      const updated = await applyPromotions(codes)

      if (checkout && sequence !== undefined) {
        checkout.dispatch({ type: "CART_UPDATED", cart: updated, sequence })
      }
    } catch (error) {
      // Without this the status line is left reading "Guardando…" forever on a
      // failed promotion, because nothing else resolves a started write.
      if (checkout && sequence !== undefined) {
        checkout.dispatch({ type: "CART_WRITE_FAILED", sequence })
      }
      throw error
    }
  }

  const removePromotionCode = async (code: string) => {
    const validPromotions = promotions.filter(
      (promotion) => promotion.code !== code
    )

    try {
      await applyAndSync(
        validPromotions.filter((p) => p.code !== undefined).map((p) => p.code!)
      )
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const addPromotionCode = async (formData: FormData) => {
    setErrorMessage("")

    const code = formData.get("code")
    if (!code) {
      return
    }
    const input = document.getElementById("promotion-input") as HTMLInputElement
    const codes = promotions
      .filter((p) => p.code !== undefined)
      .map((p) => p.code!)
    codes.push(code.toString())

    try {
      await applyAndSync(codes)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }

    if (input) {
      input.value = ""
    }
  }

  return (
    <div className="flex w-full flex-col">
      <form action={(a) => addPromotionCode(a)} className="w-full">
        <div className="flex w-full gap-2">
          <input
            id="promotion-input"
            name="code"
            type="text"
            autoFocus={false}
            placeholder="Código de cupón"
            data-testid="discount-input"
            className="min-w-0 flex-1 rounded-[10px] border border-line bg-white px-3 py-[11px] font-mono text-[13px] text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          />
          <button
            type="submit"
            data-testid="discount-apply-button"
            className="shrink-0 rounded-[10px] bg-ink px-4 py-[11px] text-sm font-semibold text-white transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none"
          >
            Aplicar
          </button>
        </div>

        <ErrorMessage
          error={errorMessage}
          data-testid="discount-error-message"
        />
      </form>

      <div className="txt-medium">
        {promotions.length > 0 && (
          <div className="mt-3 flex w-full items-center">
            <div className="flex flex-col w-full">
              <Heading className="txt-medium mb-2">
                Promociones aplicadas:
              </Heading>

              {promotions.map((promotion) => {
                return (
                  <div
                    key={promotion.id}
                    className="flex items-center justify-between w-full max-w-full mb-2"
                    data-testid="discount-row"
                  >
                    <Text className="flex gap-x-1 items-baseline txt-small-plus w-4/5 pr-1">
                      <span className="truncate" data-testid="discount-code">
                        <Badge
                          color={promotion.is_automatic ? "green" : "grey"}
                        >
                          {promotion.code}
                        </Badge>{" "}
                        (
                        {promotion.application_method?.value !== undefined &&
                          promotion.application_method.currency_code !==
                            undefined && (
                            <>
                              {promotion.application_method.type ===
                              "percentage"
                                ? `${promotion.application_method.value}%`
                                : convertToLocale({
                                    amount: +promotion.application_method.value,
                                    currency_code:
                                      promotion.application_method
                                        .currency_code,
                                  })}
                            </>
                          )}
                        )
                        {/* {promotion.is_automatic && (
                          <Tooltip content="This promotion is automatically applied">
                            <InformationCircleSolid className="inline text-zinc-400" />
                          </Tooltip>
                        )} */}
                      </span>
                    </Text>
                    {!promotion.is_automatic && (
                      <button
                        className="flex items-center"
                        onClick={() => {
                          if (!promotion.code) {
                            return
                          }

                          removePromotionCode(promotion.code)
                        }}
                        data-testid="remove-discount-button"
                      >
                        <Trash size={14} />
                        <span className="sr-only">
                          Eliminar cupón del pedido
                        </span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DiscountCode

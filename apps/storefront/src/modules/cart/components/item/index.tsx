"use client"

import { Table, Text } from "@modules/common/components/ui"
import { deleteLineItem, updateLineItem } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import ErrorMessage from "@modules/checkout/components/error-message"
import DeleteButton from "@modules/common/components/delete-button"
import LineItemOptions from "@modules/common/components/line-item-options"
import LineItemPrice from "@modules/common/components/line-item-price"
import LineItemUnitPrice from "@modules/common/components/line-item-unit-price"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import QtyStepper from "@modules/common/components/qty-stepper"
import Spinner from "@modules/common/icons/spinner"
import Thumbnail from "@modules/products/components/thumbnail"
import { useState, useTransition } from "react"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem
  type?: "full" | "preview"
  currencyCode: string
}

const Item = ({ item, type = "full", currencyCode }: ItemProps) => {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Card (cart page) handlers — increase, or decrease that deletes at qty 1.
  const handleIncrease = () => {
    setError(null)
    startTransition(async () => {
      try {
        await updateLineItem({ lineId: item.id, quantity: item.quantity + 1 })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const handleDecrease = () => {
    setError(null)
    startTransition(async () => {
      try {
        if (item.quantity <= 1) {
          await deleteLineItem(item.id)
        } else {
          await updateLineItem({ lineId: item.id, quantity: item.quantity - 1 })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  // ── PREVIEW: keep the original table row (used in checkout/order summaries) ──
  if (type === "preview") {
    return (
      <Table.Row className="w-full" data-testid="product-row">
        <Table.Cell className="!pl-0 p-4 w-24">
          <LocalizedClientLink
            href={`/products/${item.product_handle}`}
            className="flex w-16"
          >
            <Thumbnail
              thumbnail={item.thumbnail}
              images={item.variant?.product?.images}
              size="square"
            />
          </LocalizedClientLink>
        </Table.Cell>

        <Table.Cell className="text-left">
          <Text
            className="txt-medium-plus text-ui-fg-base"
            data-testid="product-title"
          >
            {item.product_title}
          </Text>
          <LineItemOptions
            variant={item.variant}
            data-testid="product-variant"
          />
        </Table.Cell>

        <Table.Cell className="!pr-0">
          <span className="flex flex-col items-end h-full justify-center !pr-0">
            <span className="flex gap-x-1 ">
              <Text className="text-ui-fg-muted">{item.quantity}x </Text>
              <LineItemUnitPrice
                item={item}
                style="tight"
                currencyCode={currencyCode}
              />
            </span>
            <LineItemPrice
              item={item}
              style="tight"
              currencyCode={currencyCode}
            />
          </span>
        </Table.Cell>
      </Table.Row>
    )
  }

  // ── FULL: Tienda C line-item CARD ──
  const busy = isPending

  return (
    <div
      className="flex flex-col rounded-2xl border border-line bg-paper p-4"
      data-testid="product-row"
    >
      <div className="flex items-center gap-4">
        <LocalizedClientLink
          href={`/products/${item.product_handle}`}
          className="block size-[84px] shrink-0 overflow-hidden rounded-xl bg-cream"
        >
          <Thumbnail
            thumbnail={item.thumbnail}
            images={item.variant?.product?.images}
            size="square"
          />
        </LocalizedClientLink>

        <div className="min-w-0 flex-1">
          <LocalizedClientLink href={`/products/${item.product_handle}`}>
            <Text
              className="truncate font-bricolage text-[18px] font-bold leading-snug text-ink"
              data-testid="product-title"
            >
              {item.product_title}
            </Text>
          </LocalizedClientLink>
          <div className="mt-1 font-mono text-xs text-ink-muted">
            <LineItemOptions
              variant={item.variant}
              data-testid="product-variant"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <QtyStepper
            quantity={item.quantity}
            onIncrease={handleIncrease}
            onDecrease={handleDecrease}
            disabled={busy}
            size="sm"
            aria-label={`Cantidad de ${item.product_title}`}
          />
          {busy && <Spinner />}
        </div>

        <div className="w-[88px] shrink-0 text-right font-bricolage text-[18px] font-bold text-ink">
          <LineItemPrice
            item={item}
            style="tight"
            currencyCode={currencyCode}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <DeleteButton
          id={item.id}
          className="text-xs text-ink-muted hover:text-coral"
          data-testid="product-delete-button"
        >
          Eliminar
        </DeleteButton>
        <ErrorMessage error={error} data-testid="product-error-message" />
      </div>
    </div>
  )
}

export default Item

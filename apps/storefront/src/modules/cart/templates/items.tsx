import repeat from "@lib/util/repeat"
import { HttpTypes } from "@medusajs/types"

import Item from "@modules/cart/components/item"

type ItemsTemplateProps = {
  cart?: HttpTypes.StoreCart
}

const ItemsTemplate = ({ cart }: ItemsTemplateProps) => {
  const items = cart?.items
  return (
    <div className="flex flex-col gap-3.5">
      {items
        ? items
            .sort((a, b) => {
              return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
            })
            .map((item) => {
              return (
                <Item
                  key={item.id}
                  item={item}
                  currencyCode={cart?.currency_code}
                />
              )
            })
        : repeat(3).map((i) => {
            return (
              <div
                key={i}
                className="h-[120px] animate-pulse rounded-2xl border border-line bg-cream"
              />
            )
          })}
    </div>
  )
}

export default ItemsTemplate

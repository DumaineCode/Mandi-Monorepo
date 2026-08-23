import repeat from "@lib/util/repeat"
import { HttpTypes } from "@medusajs/types"
import { Heading, Table } from "@modules/common/components/ui"

import Item from "@modules/order/components/item"
import SkeletonLineItem from "@modules/skeletons/components/skeleton-line-item"

type ItemsProps = {
  order: HttpTypes.StoreOrder
  headingLevel?: "h2" | "h3"
}

const Items = ({ order, headingLevel = "h2" }: ItemsProps) => {
  const items = order.items

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line px-5 py-4">
        <Heading
          level={headingLevel}
          className="font-bricolage !text-xl font-bold text-ink"
        >
          Productos
        </Heading>
      </div>
      <div className="overflow-x-auto px-4">
        <Table>
          <Table.Body data-testid="products-table">
            {items?.length
              ? items
                  .sort((a, b) => {
                    return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
                  })
                  .map((item) => {
                    return (
                      <Item
                        key={item.id}
                        item={item}
                        currencyCode={order.currency_code}
                      />
                    )
                  })
              : repeat(5).map((i) => {
                  return <SkeletonLineItem key={i} />
                })}
          </Table.Body>
        </Table>
      </div>
    </section>
  )
}

export default Items

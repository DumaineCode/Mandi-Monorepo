import ItemsTemplate from "./items"
import Summary from "./summary"
import EmptyCartMessage from "../components/empty-cart-message"
import SignInPrompt from "../components/sign-in-prompt"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

const CartTemplate = ({
  cart,
  customer,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
}) => {
  const items = cart?.items ?? []
  // Count total units in the cart (more accurate for "N productos" than line count).
  const productCount = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0)

  if (!items.length) {
    return (
      <div className="py-12">
        <div className="content-container" data-testid="cart-container">
          <EmptyCartMessage />
        </div>
      </div>
    )
  }

  return (
    <div className="py-10" data-testid="cart-container">
      <div className="content-container">
        <div className="mb-6 flex items-center justify-end">
          <LocalizedClientLink
            href="/store"
            className="text-[15px] text-ink-soft transition-colors hover:text-coral motion-reduce:transition-none"
          >
            ← Seguir comprando
          </LocalizedClientLink>
        </div>

        <h1 className="mb-6 font-bricolage text-[34px] font-extrabold tracking-[-0.03em] text-ink small:text-[44px]">
          Tu carrito{" "}
          <span className="font-semibold text-ink-muted">
            · {productCount} {productCount === 1 ? "producto" : "productos"}
          </span>
        </h1>

        <div className="grid grid-cols-1 items-start gap-7 small:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-4">
            {!customer && <SignInPrompt />}
            <ItemsTemplate cart={cart ?? undefined} />
          </div>

          {cart && cart.region && (
            <div className="small:sticky small:top-[90px]">
              <Summary cart={cart} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CartTemplate

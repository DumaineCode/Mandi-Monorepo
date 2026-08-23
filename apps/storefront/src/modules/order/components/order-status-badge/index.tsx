import {
  formatOrderStatus,
  getOrderStatusTone,
  type OrderStatusTone,
} from "@lib/util/order-status"
import { clx } from "@modules/common/components/ui"

const TONE_CLASSES: Record<OrderStatusTone, string> = {
  success: "bg-teal/30",
  warning: "bg-gold/25",
  danger: "bg-hero-highlight-pink/10",
  neutral: "bg-coral-light/40",
}

const OrderStatusBadge = ({
  status,
  "data-testid": dataTestId,
}: {
  status?: string | null
  "data-testid"?: string
}) => {
  return (
    <span
      className={clx(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold text-ink",
        TONE_CLASSES[getOrderStatusTone(status)]
      )}
      data-testid={dataTestId}
    >
      {formatOrderStatus(status)}
    </span>
  )
}

export default OrderStatusBadge

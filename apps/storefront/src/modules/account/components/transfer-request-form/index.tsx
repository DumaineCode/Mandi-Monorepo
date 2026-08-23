"use client"
import { createTransferRequest } from "@lib/data/orders"
import { CheckCircleMiniSolid, XCircleSolid } from "@medusajs/icons"
import { Heading, IconButton, Text } from "@modules/common/components/ui"
import Input from "@modules/common/components/input"
import { useActionState } from "react"
// TODO: Re-add Toaster component when needed
import { SubmitButton } from "@modules/checkout/components/submit-button"
import { useEffect, useState } from "react"

export default function TransferRequestForm() {
  const [showSuccess, setShowSuccess] = useState(false)

  const [state, formAction] = useActionState(createTransferRequest, {
    success: false,
    error: null,
    order: null,
  })

  useEffect(() => {
    if (state.success && state.order) {
      setShowSuccess(true)
    }
  }, [state.success, state.order])

  return (
    <section className="flex w-full flex-col gap-y-4 rounded-2xl border border-line bg-cream/40 p-5">
      <div className="grid w-full items-center gap-x-8 gap-y-4 xsmall:grid-cols-2">
        <div className="flex flex-col gap-y-1">
          <Heading
            level="h3"
            className="font-bricolage !text-xl font-bold text-ink"
          >
            Vincular un pedido
          </Heading>
          <p className="text-sm leading-6 text-ink-muted">
            Si compraste como invitado, solicita agregar ese pedido a tu cuenta.
          </p>
        </div>
        <form
          action={formAction}
          className="flex flex-col gap-y-1 xsmall:items-end"
        >
          <div className="flex flex-col gap-y-2 w-full">
            <Input
              id="account-transfer-order-id"
              label="ID del pedido"
              name="order_id"
              required
              data-testid="order-id-input"
            />
            <SubmitButton className="min-h-11 w-full whitespace-nowrap xsmall:w-fit xsmall:self-end">
              Solicitar vinculación
            </SubmitButton>
          </div>
        </form>
      </div>
      {!state.success && state.error && (
        <Text className="text-right text-sm text-rose-600">{state.error}</Text>
      )}
      {showSuccess && (
        <div
          className="flex w-full items-center justify-between gap-4 rounded-xl bg-teal/30 p-4"
          aria-live="polite"
        >
          <div className="flex gap-x-2 items-center">
            <CheckCircleMiniSolid className="w-4 h-4 text-emerald-500" />
            <div className="flex flex-col gap-y-1">
              <Text className="font-semibold text-ink">
                Solicitaste vincular el pedido {state.order?.id}
              </Text>
              <Text className="text-sm text-ink-muted">
                Enviamos la solicitud a {state.order?.email}
              </Text>
            </div>
          </div>
          <IconButton
            className="h-fit"
            onClick={() => setShowSuccess(false)}
            aria-label="Cerrar mensaje"
          >
            <XCircleSolid className="w-4 h-4 text-neutral-500" />
          </IconButton>
        </div>
      )}
    </section>
  )
}

"use client"

import { Plus } from "@medusajs/icons"
import { Button, Heading } from "@modules/common/components/ui"
import { useActionState, useEffect, useState } from "react"

import { addCustomerAddress } from "@lib/data/customer"
import useToggleState from "@lib/hooks/use-toggle-state"
import { HttpTypes } from "@medusajs/types"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import AddressForm from "@modules/account/components/address-form"
import Modal from "@modules/common/components/modal"

const AddAddress = ({ region }: { region: HttpTypes.StoreRegion }) => {
  const [successState, setSuccessState] = useState(false)
  const { state, open, close: closeModal } = useToggleState(false)

  const [formState, formAction] = useActionState(addCustomerAddress, {
    success: false,
    error: null,
  } as { success: boolean; error: string | null })

  const close = () => {
    setSuccessState(false)
    closeModal()
  }

  useEffect(() => {
    if (successState) {
      close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successState])

  useEffect(() => {
    if (formState.success) {
      setSuccessState(true)
    }
  }, [formState])

  return (
    <>
      <button
        type="button"
        className="flex min-h-[190px] h-full w-full flex-col justify-between rounded-2xl border border-dashed border-line bg-cream/40 p-5 text-left text-ink transition-colors hover:border-coral hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        onClick={open}
        data-testid="add-address-button"
      >
        <span className="font-bricolage text-xl font-bold">
          Nueva dirección
        </span>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-coral-light text-ink">
          <Plus />
        </span>
      </button>

      <Modal isOpen={state} close={close} data-testid="add-address-modal">
        <Modal.Title>
          <Heading className="mb-2 font-bricolage text-2xl font-extrabold">
            Agregar dirección
          </Heading>
        </Modal.Title>
        <form action={formAction}>
          <Modal.Body>
            {/*
             * `Modal.Body` is a ROW flex (`flex justify-center`), so the fields
             * and the error banner have to share one column child or the banner
             * renders beside the form instead of under it.
             */}
            <div className="flex w-full flex-col">
              <AddressForm region={region} />
              {formState.error && (
                <div
                  className="py-2 text-small-regular text-rose-500"
                  role="alert"
                  data-testid="address-error"
                >
                  {formState.error}
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <div className="mt-6 flex w-full flex-col-reverse gap-3 xsmall:w-auto xsmall:flex-row">
              <Button
                type="reset"
                variant="secondary"
                onClick={close}
                className="min-h-11 w-full !border-line !bg-paper !text-ink hover:!border-coral hover:!bg-cream xsmall:w-auto"
                data-testid="cancel-button"
              >
                Cancelar
              </Button>
              <SubmitButton
                className="min-h-11 w-full xsmall:w-auto"
                data-testid="save-button"
              >
                Guardar dirección
              </SubmitButton>
            </div>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  )
}

export default AddAddress

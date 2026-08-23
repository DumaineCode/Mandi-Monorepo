"use client"

import { Plus } from "@medusajs/icons"
import { Button, Heading } from "@modules/common/components/ui"
import { useActionState, useEffect, useState } from "react"

import { addCustomerAddress } from "@lib/data/customer"
import useToggleState from "@lib/hooks/use-toggle-state"
import { HttpTypes } from "@medusajs/types"
import CountrySelect from "@modules/checkout/components/country-select"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
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
            <div className="flex w-full flex-col gap-y-3">
              <div className="grid grid-cols-1 gap-3 xsmall:grid-cols-2">
                <Input
                  label="Nombre"
                  name="first_name"
                  required
                  autoComplete="given-name"
                  data-testid="first-name-input"
                />
                <Input
                  label="Apellidos"
                  name="last_name"
                  required
                  autoComplete="family-name"
                  data-testid="last-name-input"
                />
              </div>
              <Input
                label="Empresa (opcional)"
                name="company"
                autoComplete="organization"
                data-testid="company-input"
              />
              <Input
                label="Calle y número"
                name="address_1"
                required
                autoComplete="address-line1"
                data-testid="address-1-input"
              />
              <Input
                label="Interior, departamento, etc. (opcional)"
                name="address_2"
                autoComplete="address-line2"
                data-testid="address-2-input"
              />
              <div className="grid grid-cols-1 gap-3 xsmall:grid-cols-[144px_1fr]">
                <Input
                  label="Código postal"
                  name="postal_code"
                  required
                  autoComplete="postal-code"
                  data-testid="postal-code-input"
                />
                <Input
                  label="Ciudad"
                  name="city"
                  required
                  autoComplete="locality"
                  data-testid="city-input"
                />
              </div>
              <Input
                label="Estado"
                name="province"
                autoComplete="address-level1"
                data-testid="state-input"
              />
              <CountrySelect
                region={region}
                name="country_code"
                required
                autoComplete="country"
                data-testid="country-select"
              />
              <Input
                label="Teléfono"
                name="phone"
                type="tel"
                autoComplete="tel"
                data-testid="phone-input"
              />
            </div>
            {formState.error && (
              <div
                className="text-rose-500 text-small-regular py-2"
                data-testid="address-error"
              >
                {formState.error}
              </div>
            )}
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

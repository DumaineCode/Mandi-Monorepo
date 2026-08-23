"use client"

import {
  deleteCustomerAddress,
  updateCustomerAddress,
} from "@lib/data/customer"
import useToggleState from "@lib/hooks/use-toggle-state"
import { PencilSquare as Edit, Trash } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import AddressForm from "@modules/account/components/address-form"
import Modal from "@modules/common/components/modal"
import { Button, Heading, Text, clx } from "@modules/common/components/ui"
import Spinner from "@modules/common/icons/spinner"
import React, { useActionState, useEffect, useState } from "react"
import { formatCountryName } from "@lib/util/store-locale"

type EditAddressProps = {
  region: HttpTypes.StoreRegion
  address: HttpTypes.StoreCustomerAddress
  isActive?: boolean
}

const EditAddress: React.FC<EditAddressProps> = ({
  region,
  address,
  isActive = false,
}) => {
  const [removing, setRemoving] = useState(false)
  const [successState, setSuccessState] = useState(false)
  const { state, open, close: closeModal } = useToggleState(false)

  const [formState, formAction] = useActionState(updateCustomerAddress, {
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

  const removeAddress = async () => {
    setRemoving(true)
    await deleteCustomerAddress(address.id)
    setRemoving(false)
  }

  const countryName = formatCountryName(
    address.country_code,
    address.country_code?.toUpperCase()
  )

  return (
    <>
      <div
        className={clx(
          "flex min-h-[190px] h-full w-full flex-col justify-between rounded-2xl border border-line bg-cream/40 p-5 text-ink transition-colors",
          {
            "border-coral": isActive,
          }
        )}
        data-testid="address-container"
      >
        <div className="flex flex-col">
          <Heading
            className="text-left font-bricolage text-xl font-bold"
            data-testid="address-name"
          >
            {address.first_name} {address.last_name}
          </Heading>
          {address.company && (
            <Text
              className="mt-1 text-sm text-ink-muted"
              data-testid="address-company"
            >
              {address.company}
            </Text>
          )}
          <Text className="mt-3 flex flex-col text-left text-sm leading-6 text-ink-muted">
            <span data-testid="address-address">
              {address.address_1}
              {address.address_2 && <span>, {address.address_2}</span>}
            </span>
            <span data-testid="address-postal-city">
              {address.postal_code}, {address.city}
            </span>
            <span data-testid="address-province-country">
              {address.province && `${address.province}, `}
              {countryName}
            </span>
          </Text>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex min-h-11 items-center gap-x-2 rounded-xl px-3 text-sm font-semibold text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            onClick={open}
            data-testid="address-edit-button"
          >
            <Edit />
            Editar
          </button>
          <button
            type="button"
            className="flex min-h-11 items-center gap-x-2 rounded-xl px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            onClick={removeAddress}
            data-testid="address-delete-button"
          >
            {removing ? <Spinner /> : <Trash />}
            Eliminar
          </button>
        </div>
      </div>

      <Modal isOpen={state} close={close} data-testid="edit-address-modal">
        <Modal.Title>
          <Heading className="mb-2 font-bricolage text-2xl font-extrabold">
            Editar dirección
          </Heading>
        </Modal.Title>
        <form action={formAction}>
          <input type="hidden" name="addressId" value={address.id} />
          <Modal.Body>
            {/*
             * `Modal.Body` is a ROW flex (`flex justify-center`), so the fields
             * and the error banner have to share one column child or the banner
             * renders beside the form instead of under it.
             */}
            <div className="flex w-full flex-col">
              <AddressForm region={region} address={address} />
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
                Guardar cambios
              </SubmitButton>
            </div>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  )
}

export default EditAddress

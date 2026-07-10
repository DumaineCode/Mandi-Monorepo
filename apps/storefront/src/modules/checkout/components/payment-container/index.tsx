import { Radio as RadioGroupOption } from "@headlessui/react"
import { Text, clx } from "@modules/common/components/ui"
import React, {
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from "react"

import Radio from "@modules/common/components/radio"

import { isManual } from "@lib/constants"
import SkeletonCardDetails from "@modules/skeletons/components/skeleton-card-details"
import { CardElement } from "@stripe/react-stripe-js"
import { StripeCardElementOptions } from "@stripe/stripe-js"
import PaymentTest from "../payment-test"
import {
  OpenpayContext,
  type OpenpayCardFields,
} from "../payment-wrapper/openpay-wrapper"
import { StripeContext } from "../payment-wrapper/stripe-wrapper"

type PaymentContainerProps = {
  paymentProviderId: string
  selectedPaymentOptionId: string | null
  disabled?: boolean
  paymentInfoMap: Record<string, { title: string; icon: JSX.Element }>
  children?: React.ReactNode
}

const PaymentContainer: React.FC<PaymentContainerProps> = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  children,
}) => {
  const isDevelopment = process.env.NODE_ENV === "development"

  return (
    <RadioGroupOption
      key={paymentProviderId}
      value={paymentProviderId}
      disabled={disabled}
      className={clx(
        "flex flex-col gap-y-2 text-small-regular cursor-pointer py-4 border rounded-rounded px-8 mb-2 hover:shadow-borders-interactive-with-active",
        {
          "border-ui-border-interactive":
            selectedPaymentOptionId === paymentProviderId,
        }
      )}
    >
      <div className="flex items-center justify-between ">
        <div className="flex items-center gap-x-4">
          <Radio checked={selectedPaymentOptionId === paymentProviderId} />
          <Text className="text-base-regular">
            {paymentInfoMap[paymentProviderId]?.title || paymentProviderId}
          </Text>
          {isManual(paymentProviderId) && isDevelopment && (
            <PaymentTest className="hidden small:block" />
          )}
        </div>
        <span className="justify-self-end text-ui-fg-base">
          {paymentInfoMap[paymentProviderId]?.icon}
        </span>
      </div>
      {isManual(paymentProviderId) && isDevelopment && (
        <PaymentTest className="small:hidden text-[10px]" />
      )}
      {children}
    </RadioGroupOption>
  )
}

export default PaymentContainer

export const StripeCardContainer = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  setCardBrand,
  setError,
  setCardComplete,
}: Omit<PaymentContainerProps, "children"> & {
  setCardBrand: (brand: string) => void
  setError: (error: string | null) => void
  setCardComplete: (complete: boolean) => void
}) => {
  const stripeReady = useContext(StripeContext)

  const useOptions: StripeCardElementOptions = useMemo(() => {
    return {
      style: {
        base: {
          fontFamily: "Inter, sans-serif",
          color: "#424270",
          "::placeholder": {
            color: "rgb(107 114 128)",
          },
        },
      },
      classes: {
        base: "pt-3 pb-1 block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover transition-all duration-300 ease-in-out",
      },
    }
  }, [])

  return (
    <PaymentContainer
      paymentProviderId={paymentProviderId}
      selectedPaymentOptionId={selectedPaymentOptionId}
      paymentInfoMap={paymentInfoMap}
      disabled={disabled}
    >
      {selectedPaymentOptionId === paymentProviderId &&
        (stripeReady ? (
          <div className="my-4 transition-all duration-150 ease-in-out">
            <Text className="txt-medium-plus text-ui-fg-base mb-1">
              Enter your card details:
            </Text>
            <CardElement
              options={useOptions as StripeCardElementOptions}
              onChange={(e) => {
                setCardBrand(
                  e.brand && e.brand.charAt(0).toUpperCase() + e.brand.slice(1)
                )
                setError(e.error?.message || null)
                setCardComplete(e.complete)
              }}
            />
          </div>
        ) : (
          <SkeletonCardDetails />
        ))}
    </PaymentContainer>
  )
}

const cardInputClasses =
  "block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover transition-all duration-300 ease-in-out"

export const OpenpayCardContainer = ({
  paymentProviderId,
  selectedPaymentOptionId,
  paymentInfoMap,
  disabled = false,
  setError,
  setCardComplete,
}: Omit<PaymentContainerProps, "children"> & {
  setError: (error: string | null) => void
  setCardComplete: (complete: boolean) => void
}) => {
  const { ready, setCardData } = useContext(OpenpayContext)

  // Card data lives ONLY in client-side React state. It is handed to
  // openpay.js for tokenization and is NEVER sent to our backend (SF-2 / OP-2).
  const [cardNumber, setCardNumber] = useState("")
  const [holderName, setHolderName] = useState("")
  const [expiry, setExpiry] = useState("")
  const [cvv2, setCvv2] = useState("")

  useEffect(() => {
    const openpay = window.OpenPay

    if (!ready || !openpay) {
      setCardData(null)
      setCardComplete(false)
      return
    }

    const digits = cardNumber.replace(/\s+/g, "")
    const [monthRaw, yearRaw] = expiry.split("/").map((part) => part.trim())
    const month = monthRaw || ""
    const year = yearRaw?.length === 2 ? `20${yearRaw}` : yearRaw || ""

    const numberValid = digits.length > 0 && openpay.card.validateCardNumber(digits)
    const expiryValid =
      month.length > 0 &&
      year.length === 4 &&
      openpay.card.validateExpiry(month, year)
    const cvvValid = cvv2.length > 0 && openpay.card.validateCVC(cvv2, digits)
    const holderValid = holderName.trim().length > 0

    if (digits.length >= 15 && !numberValid) {
      setError("Invalid card number")
    } else if (expiry.length >= 5 && !expiryValid) {
      setError("Invalid expiration date")
    } else if (cvv2.length >= 3 && !cvvValid) {
      setError("Invalid security code")
    } else {
      setError(null)
    }

    if (numberValid && expiryValid && cvvValid && holderValid) {
      const card: OpenpayCardFields = {
        card_number: digits,
        holder_name: holderName.trim(),
        expiration_month: month.padStart(2, "0"),
        expiration_year: year.slice(-2),
        cvv2,
      }
      setCardData(card)
      setCardComplete(true)
    } else {
      setCardData(null)
      setCardComplete(false)
    }
  }, [
    ready,
    cardNumber,
    holderName,
    expiry,
    cvv2,
    setCardData,
    setCardComplete,
    setError,
  ])

  return (
    <PaymentContainer
      paymentProviderId={paymentProviderId}
      selectedPaymentOptionId={selectedPaymentOptionId}
      paymentInfoMap={paymentInfoMap}
      disabled={disabled}
    >
      {selectedPaymentOptionId === paymentProviderId &&
        (ready ? (
          <div className="my-4 flex flex-col gap-y-2 transition-all duration-150 ease-in-out">
            <Text className="txt-medium-plus text-ui-fg-base mb-1">
              Enter your card details:
            </Text>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="Card number"
              aria-label="Card number"
              className={cardInputClasses}
              value={cardNumber}
              onChange={(e) =>
                setCardNumber(e.target.value.replace(/[^\d\s]/g, ""))
              }
              maxLength={23}
              data-testid="openpay-card-number-input"
            />
            <input
              type="text"
              autoComplete="cc-name"
              placeholder="Name on card"
              aria-label="Name on card"
              className={cardInputClasses}
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              data-testid="openpay-card-holder-input"
            />
            <div className="flex gap-x-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/YY"
                aria-label="Expiration date (MM/YY)"
                className={cardInputClasses}
                value={expiry}
                onChange={(e) =>
                  setExpiry(e.target.value.replace(/[^\d/]/g, ""))
                }
                maxLength={5}
                data-testid="openpay-card-expiry-input"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVV"
                aria-label="Security code"
                className={cardInputClasses}
                value={cvv2}
                onChange={(e) => setCvv2(e.target.value.replace(/\D/g, ""))}
                maxLength={4}
                data-testid="openpay-card-cvv-input"
              />
            </div>
          </div>
        ) : (
          <SkeletonCardDetails />
        ))}
    </PaymentContainer>
  )
}

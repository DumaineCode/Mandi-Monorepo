import { Radio as RadioGroupOption } from "@headlessui/react"
import { Text, clx } from "@modules/common/components/ui"
import React, { useContext, useEffect, useState } from "react"

import { isManual, type PaymentInfo } from "@lib/constants"
import SkeletonCardDetails from "@modules/skeletons/components/skeleton-card-details"
import PaymentTest from "../payment-test"
import {
  OpenpayContext,
  type OpenpayCardFields,
} from "../payment-wrapper/openpay-wrapper"

type PaymentContainerProps = {
  paymentProviderId: string
  selectedPaymentOptionId: string | null
  disabled?: boolean
  paymentInfoMap: Record<string, PaymentInfo>
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
        // `group` so the decorative indicator below can react to this row's
        // own `data-checked`, which Headless UI sets.
        "group flex flex-col gap-y-2 text-small-regular cursor-pointer py-4 border rounded-rounded px-8 mb-2 hover:shadow-borders-interactive-with-active",
        {
          "border-ui-border-interactive":
            selectedPaymentOptionId === paymentProviderId,
        }
      )}
    >
      <div className="flex items-center justify-between gap-x-3">
        <div className="flex items-center gap-x-4">
          {/*
           * Decorative, and it has to be (task 2c.35).
           *
           * This slot used to hold the shared `common/components/radio` — a
           * `<button role="radio" aria-checked="true">`. Two defects in one
           * element: it nests an interactive control inside a radio option, and
           * it hard-codes EVERY row as checked, so a screen-reader user was told
           * all payment methods were selected at once. That becomes
           * customer-visible the moment this list is the only way to pay.
           *
           * The `RadioGroupOption` wrapping it already carries `role="radio"`
           * and the real `aria-checked`, so the indicator only has to be a
           * picture. Same pattern, and same reasoning, as `shipping-section`.
           */}
          <span
            aria-hidden="true"
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line bg-white group-data-[checked]:border-coral"
          >
            <span className="h-2 w-2 rounded-full bg-transparent group-data-[checked]:bg-coral" />
          </span>
          <div className="flex flex-col">
            <Text className="text-base-regular">
              {paymentInfoMap[paymentProviderId]?.title || paymentProviderId}
            </Text>
            {paymentInfoMap[paymentProviderId]?.caption && (
              <Text className="txt-small text-ui-fg-subtle">
                {paymentInfoMap[paymentProviderId]?.caption}
              </Text>
            )}
          </div>
          {isManual(paymentProviderId) && isDevelopment && (
            <PaymentTest className="hidden small:block" />
          )}
        </div>
        <span className="justify-self-end shrink-0 text-ui-fg-base">
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

/**
 * `StripeCardContainer` was deleted here alongside
 * `payment-wrapper/stripe-wrapper.tsx` (PR1b, task 1b.18).
 *
 * It had to go in the SAME commit as the wrapper: it was the only consumer of
 * `StripeContext`, so deleting the wrapper on its own would have left the branch
 * with a dangling import and a broken build. Per `design.md` §0 CONFLICT-1
 * RESOLUTION the component was unreachable — `apps/backend/medusa-config.ts`
 * registers only `openpay` and `mercadopago`, and `listCartPaymentMethods` is
 * backend-driven, so `isStripeLike` could never match a real provider id.
 *
 * `@stripe/react-stripe-js` and `@stripe/stripe-js` have since been dropped from
 * `package.json` (task 2c.13, pulled forward into PR1b) — the last source import
 * of either package left with `StripePaymentButton` in `payment-button/`.
 */
const cardInputClasses =
  "block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover transition-all duration-300 ease-in-out"

// Shortest valid PAN (Amex is 15 digits) — don't flag Luhn errors before this.
const MIN_PAN_DIGITS = 15
// Longest PAN is 19 digits; allow up to 4 grouping spaces in the input.
const MAX_PAN_INPUT_LENGTH = 23
// Full "MM/YY" expiry input length.
const EXPIRY_INPUT_LENGTH = 5
// Shortest valid CVV (Amex uses 4) — don't flag errors before this.
const MIN_CVV_LENGTH = 3

/**
 * Formats raw expiry keystrokes into "MM/YY" as the user types: keeps only
 * digits and auto-inserts the "/" once two month digits are entered. This is
 * what the expiry validation below expects — it splits on "/" to separate
 * month and year, so without the slash the year is never parsed and the form
 * can never complete.
 */
const formatExpiry = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 4)
  if (digits.length <= 2) {
    return digits
  }
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

// Longest PAN is 19 digits (Amex 15, Visa/MC 16, some cards 19) — cap on digits,
// never on brand. The trailing length/Luhn check is openpay.card.validateCardNumber.
const MAX_PAN_DIGITS = 19

/**
 * Formats raw card-number keystrokes into 4-digit groups as the user types
 * (e.g. "4111 1111 1111 1111"), keeping only digits and capping at 19 digits
 * so Amex (15) and 19-digit PANs are never truncated. The validation below
 * strips the spaces before running openpay.js Luhn/brand checks.
 */
const formatCardNumber = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_PAN_DIGITS)
  return digits.replace(/(.{4})/g, "$1 ").trim()
}

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
  const { ready, unavailable, setCardData } = useContext(OpenpayContext)

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

    if (digits.length >= MIN_PAN_DIGITS && !numberValid) {
      setError("Número de tarjeta inválido")
    } else if (expiry.length >= EXPIRY_INPUT_LENGTH && !expiryValid) {
      setError("Fecha de vencimiento inválida")
    } else if (cvv2.length >= MIN_CVV_LENGTH && !cvvValid) {
      setError("Código de seguridad inválido")
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
        (unavailable ? (
          <Text
            className="txt-medium text-ui-fg-subtle my-4"
            data-testid="openpay-unavailable-message"
          >
            Los pagos con tarjeta no están disponibles en este momento. Elige
            otro método de pago.
          </Text>
        ) : ready ? (
          <div
            className="my-4 flex flex-col gap-y-2 transition-all duration-150 ease-in-out"
            /**
             * The card form is a text-entry region nested inside a
             * `RadioGroup`, and Headless UI's group handler does not look at
             * `event.target`.
             *
             * `@headlessui/react@2.2.9` attaches `onKeyDown` to the RadioGroup
             * ROOT (`payment-section/index.tsx` renders it; these inputs are
             * children of a `Radio` inside it) and switches on `event.key`
             * alone. `ArrowLeft`/`ArrowUp` and `ArrowRight`/`ArrowDown` call
             * `preventDefault()`, `stopPropagation()`, move focus to the
             * neighbouring row and fire `change(value)`. `Space` does the same
             * to the currently focused option. React dispatches from its root
             * container during the native bubble phase, so that
             * `preventDefault()` lands before the browser's default action.
             *
             * Two customer-visible consequences, both at the moment of
             * purchase. Pressing the left arrow to correct a digit in the PAN
             * does not move the caret — it selects Mercado Pago instead, which
             * unmounts this form and discards everything typed into it. And
             * the space bar does nothing in "Nombre en la tarjeta", so
             * `JUAN PÉREZ` becomes `JUANPÉREZ` — which still passes
             * `holderName.trim().length > 0` and is tokenized and sent to the
             * issuer as the cardholder name.
             *
             * Stopping the SYNTHETIC event here keeps it from reaching the
             * group's handler while leaving the inputs' own default behaviour
             * intact. Radio navigation still works everywhere else in the
             * group, because nothing outside this div is a text field.
             *
             * NOT reachable by this repo's runner — `environment: "node"`, no
             * jsdom, no `@testing-library`. Verified by manual QA; see task
             * 2c.36 in `tasks.md` for the exact steps.
             */
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Text className="txt-medium-plus text-ui-fg-base mb-1">
              Ingresa los datos de tu tarjeta:
            </Text>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="Número de tarjeta"
              aria-label="Número de tarjeta"
              className={cardInputClasses}
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              maxLength={MAX_PAN_INPUT_LENGTH}
              data-testid="openpay-card-number-input"
            />
            <input
              type="text"
              autoComplete="cc-name"
              placeholder="Nombre en la tarjeta"
              aria-label="Nombre en la tarjeta"
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
                placeholder="MM/AA"
                aria-label="Fecha de vencimiento (MM/AA)"
                className={cardInputClasses}
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                maxLength={EXPIRY_INPUT_LENGTH}
                data-testid="openpay-card-expiry-input"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVV"
                aria-label="Código de seguridad"
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

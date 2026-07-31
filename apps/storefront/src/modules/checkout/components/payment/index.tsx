"use client"
import { RadioGroup } from "@headlessui/react"
import {
  isMercadopago,
  isOpenpay,
  isStripeLike,
  paymentInfoMap,
} from "@lib/constants"
import { initiatePaymentSession } from "@lib/data/cart"
import { getBaseURL } from "@lib/util/env"
import { CheckCircleSolid, CreditCard } from "@medusajs/icons"
import ErrorMessage from "@modules/checkout/components/error-message"
import PaymentContainer, {
  OpenpayCardContainer,
  StripeCardContainer,
} from "@modules/checkout/components/payment-container"
import { OpenpayContext } from "@modules/checkout/components/payment-wrapper/openpay-wrapper"
import {
  Button,
  Container,
  Heading,
  Text,
  clx,
} from "@modules/common/components/ui"
import { HttpTypes } from "@medusajs/types"
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { CORAL_CTA } from "../submit-button"

const Payment = ({
  cart,
  availablePaymentMethods,
}: {
  cart: HttpTypes.StoreCart
  availablePaymentMethods: { id: string }[]
}) => {
  const activeSession = cart.payment_collection?.payment_sessions?.find(
    (paymentSession) => paymentSession.status === "pending"
  )

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardBrand, setCardBrand] = useState<string | null>(null)
  const [cardComplete, setCardComplete] = useState(false)
  // Default preference: an already-active session wins (the shopper's own prior
  // choice is never overridden); otherwise pre-select Openpay when it's offered
  // — it carries the lower processing fee — while still letting the shopper
  // switch to Mercado Pago or any other method.
  const defaultPaymentMethod =
    activeSession?.provider_id ??
    availablePaymentMethods.find((method) => isOpenpay(method.id))?.id ??
    ""

  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState(defaultPaymentMethod)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams<{ countryCode: string }>()
  const openpay = useContext(OpenpayContext)

  const isOpen = searchParams.get("step") === "payment"

  const setPaymentMethod = async (method: string) => {
    setError(null)
    setSelectedPaymentMethod(method)
    // Openpay behaves like Stripe here: the session is created on selection so
    // the wrapper mounts and openpay.js loads; the card token is attached later
    // by re-initiating the session in handleSubmit (design §3.2 updatePayment).
    if (isStripeLike(method) || isOpenpay(method)) {
      await initiatePaymentSession(cart, {
        provider_id: method,
      })
    }
  }

  const paidByGiftcard = !!(
    (cart as unknown as Record<string, unknown>)?.gift_cards && ((cart as unknown as Record<string, unknown>)?.gift_cards as unknown[])?.length > 0 && cart?.total === 0
  )

  const paymentReady =
    (activeSession && (cart?.shipping_methods?.length ?? 0) !== 0) || paidByGiftcard

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams)
      params.set(name, value)

      return params.toString()
    },
    [searchParams]
  )

  const handleEdit = () => {
    router.push(pathname + "?" + createQueryString("step", "payment"), {
      scroll: false,
    })
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    try {
      if (isOpenpay(selectedPaymentMethod)) {
        if (!openpay.cardData) {
          throw new Error(
            "Please complete your card details before continuing."
          )
        }

        // Tokenization happens in the browser via openpay.js — card data never
        // reaches our backend (SF-2 / OP-2). A tokenization failure throws
        // BEFORE any backend mutation; the catch below shows the inline error
        // and the finally block re-enables the button.
        const tokenId = await openpay.tokenize(openpay.cardData)

        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
          data: {
            token_id: tokenId,
            device_session_id: openpay.deviceSessionId,
            return_url: `${getBaseURL()}/${params.countryCode}/payment/openpay/return`,
            // Openpay requires a `customer` object on the charge (API error 1001
            // otherwise). These come from the cart so they are present for guest
            // AND logged-in checkout; the backend keeps input.context.customer as
            // a fallback. Card data is NEVER included here (PCI boundary).
            customer: {
              name: cart.billing_address?.first_name ?? undefined,
              last_name: cart.billing_address?.last_name ?? undefined,
              email: cart.email ?? undefined,
              phone_number: cart.billing_address?.phone ?? undefined,
            },
          },
        })

        return router.push(
          pathname + "?" + createQueryString("step", "review"),
          {
            scroll: false,
          }
        )
      }

      if (isMercadopago(selectedPaymentMethod)) {
        // Checkout Pro is a pure redirect: create the preference now, passing
        // the storefront base for MP's back_urls. The init_point returned by
        // the backend is stored on the session and consumed by the payment
        // button on the review step (SF-4). No card data, no wrapper.
        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
          data: {
            back_urls_base: `${getBaseURL()}/${params.countryCode}/payment/mercadopago`,
          },
        })

        return router.push(
          pathname + "?" + createQueryString("step", "review"),
          {
            scroll: false,
          }
        )
      }

      const shouldInputCard =
        isStripeLike(selectedPaymentMethod) && !activeSession

      const checkActiveSession =
        activeSession?.provider_id === selectedPaymentMethod

      if (!checkActiveSession) {
        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
        })
      }

      if (!shouldInputCard) {
        return router.push(
          pathname + "?" + createQueryString("step", "review"),
          {
            scroll: false,
          }
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setError(null)
  }, [isOpen])

  // When Openpay (or Stripe) is the pre-selected default, no click ran through
  // setPaymentMethod, so its payment session was never created and openpay.js
  // never mounts. Initiate it once on open for the pre-selected provider —
  // unless a session for that same provider already exists. A manual switch
  // goes through setPaymentMethod as before, so this only covers the default.
  const initiatedDefaultRef = useRef(false)
  useEffect(() => {
    if (initiatedDefaultRef.current || !isOpen || !selectedPaymentMethod) {
      return
    }
    if (activeSession?.provider_id === selectedPaymentMethod) {
      return
    }
    if (isStripeLike(selectedPaymentMethod) || isOpenpay(selectedPaymentMethod)) {
      initiatedDefaultRef.current = true
      initiatePaymentSession(cart, { provider_id: selectedPaymentMethod }).catch(
        (err) => setError(err instanceof Error ? err.message : String(err))
      )
    }
  }, [isOpen, selectedPaymentMethod, activeSession, cart])

  return (
    <div className="rounded-large border border-line bg-paper p-6 small:p-8">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className={clx(
            "flex flex-row font-bricolage text-2xl text-ink gap-x-2 items-baseline",
            {
              "opacity-50 pointer-events-none select-none":
                !isOpen && !paymentReady,
            }
          )}
        >
          Pago
          {!isOpen && paymentReady && <CheckCircleSolid className="text-coral" />}
        </Heading>
        {!isOpen && paymentReady && (
          <Text>
            <button
              onClick={handleEdit}
              className="text-ink-muted hover:text-ink transition-colors"
              data-testid="edit-payment-button"
            >
              Editar
            </button>
          </Text>
        )}
      </div>
      <div>
        <div className={isOpen ? "block" : "hidden"}>
          {!paidByGiftcard && availablePaymentMethods?.length && (
            <>
              <RadioGroup
                value={selectedPaymentMethod}
                onChange={(value: string) => setPaymentMethod(value)}
              >
                {availablePaymentMethods.map((paymentMethod) => (
                  <div key={paymentMethod.id}>
                    {isStripeLike(paymentMethod.id) ? (
                      <StripeCardContainer
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                        paymentInfoMap={paymentInfoMap}
                        setCardBrand={setCardBrand}
                        setError={setError}
                        setCardComplete={setCardComplete}
                      />
                    ) : isOpenpay(paymentMethod.id) ? (
                      <OpenpayCardContainer
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                        paymentInfoMap={paymentInfoMap}
                        setError={setError}
                        setCardComplete={setCardComplete}
                      />
                    ) : (
                      <PaymentContainer
                        paymentInfoMap={paymentInfoMap}
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                      />
                    )}
                  </div>
                ))}
              </RadioGroup>
            </>
          )}

          {paidByGiftcard && (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ink mb-1">
                Método de pago
              </Text>
              <Text
                className="txt-medium text-ink-muted"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          )}

          <ErrorMessage
            error={error}
            data-testid="payment-method-error-message"
          />

          <Button
            size="large"
            className={`mt-6 ${CORAL_CTA}`}
            onClick={handleSubmit}
            isLoading={isLoading}
            disabled={
              (isStripeLike(selectedPaymentMethod) && !cardComplete) ||
              (isOpenpay(selectedPaymentMethod) && !cardComplete) ||
              (!selectedPaymentMethod && !paidByGiftcard)
            }
            data-testid="submit-payment-button"
          >
            {!activeSession && isStripeLike(selectedPaymentMethod)
              ? "Ingresar datos de la tarjeta"
              : "Continuar a la revisión"}
          </Button>
        </div>

        <div className={isOpen ? "hidden" : "block"}>
          {cart && paymentReady && activeSession ? (
            <div className="flex items-start gap-x-1 w-full">
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ink mb-1">
                  Método de pago
                </Text>
                <Text
                  className="txt-medium text-ink-muted"
                  data-testid="payment-method-summary"
                >
                  {paymentInfoMap[activeSession?.provider_id]?.title ||
                    activeSession?.provider_id}
                </Text>
              </div>
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ink mb-1">
                  Detalles del pago
                </Text>
                <div
                  className="flex gap-2 txt-medium text-ink-muted items-center"
                  data-testid="payment-details-summary"
                >
                  <Container className="flex items-center h-fit w-fit px-2 py-1 bg-cream">
                    {paymentInfoMap[selectedPaymentMethod]?.icon || (
                      <CreditCard />
                    )}
                  </Container>
                  <Text>
                    {isStripeLike(selectedPaymentMethod) && cardBrand
                      ? cardBrand
                      : "Aparecerá otro paso"}
                  </Text>
                </div>
              </div>
            </div>
          ) : paidByGiftcard ? (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ink mb-1">
                Método de pago
              </Text>
              <Text
                className="txt-medium text-ink-muted"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default Payment

"use client"

import Script from "next/script"
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

/**
 * Card fields collected by OpenpayCardContainer. These values live ONLY in
 * client-side React state and are handed to openpay.js for tokenization.
 * They are NEVER sent to our backend (PCI boundary — SF-2 / OP-2).
 */
export type OpenpayCardFields = {
  card_number: string
  holder_name: string
  expiration_month: string
  expiration_year: string
  cvv2: string
}

type OpenpayTokenResponse = {
  data: {
    id: string
  }
}

type OpenpayErrorResponse = {
  message?: string
  data?: {
    description?: string
    error_code?: number
  }
}

/** Minimal typing for the OpenPay global exposed by openpay.v1.min.js. */
type OpenpayGlobal = {
  setId: (merchantId: string) => void
  setApiKey: (publicKey: string) => void
  setSandboxMode: (enabled: boolean) => void
  deviceData: {
    setup: () => string
  }
  token: {
    create: (
      card: OpenpayCardFields,
      onSuccess: (response: OpenpayTokenResponse) => void,
      onError: (error: OpenpayErrorResponse) => void
    ) => void
  }
  card: {
    validateCardNumber: (cardNumber: string) => boolean
    validateCVC: (cvc: string, cardNumber?: string) => boolean
    validateExpiry: (month: string, year: string) => boolean
  }
}

declare global {
  interface Window {
    OpenPay?: OpenpayGlobal
  }
}

/**
 * Non-secret Openpay config served at runtime by GET /store/provider-config
 * (admin-managed, no storefront rebuild on key rotation). Structurally matches
 * `OpenpayPublicConfig` from `@lib/data/provider-config`.
 */
export type OpenpayPublicConfig = {
  merchantId: string
  publicKey: string
  sandbox: boolean
}

export type OpenpayContextValue = {
  /** True once both openpay.js scripts are loaded and the client is initialized. */
  ready: boolean
  /**
   * True when Openpay can never become ready in this session (missing runtime
   * provider config or a CDN script failure). Consumers should show a
   * "temporarily unavailable" state instead of a loading skeleton.
   */
  unavailable: boolean
  /** Antifraud device session id from OpenPay.deviceData.setup(). */
  deviceSessionId: string | null
  /**
   * Tokenizes card data in the browser via OpenPay.token.create.
   * Resolves with the token id. Card data never touches our backend.
   */
  tokenize: (card: OpenpayCardFields) => Promise<string>
  /** Current card form data published by OpenpayCardContainer (null until complete). */
  cardData: OpenpayCardFields | null
  setCardData: (card: OpenpayCardFields | null) => void
}

/**
 * What a consumer reads OUTSIDE `OpenpayWrapper`, and it fails CLOSED.
 *
 * ## The state this describes is reachable in production
 *
 * `getProviderConfig()` returns `{ openpay: null }` on any failure, and
 * `PaymentWrapper` then renders `<div>{children}</div>` with no provider at
 * all. `PaymentSection` still renders the Openpay row, because it reads
 * `availablePaymentMethods` — a different source, answered by
 * `listCartPaymentMethods`, which succeeded. So `OpenpayCardContainer` mounts
 * and reads this object.
 *
 * `unavailable` was `false` here, which is a claim that Openpay might still
 * become ready. Outside the provider it cannot: there is no `<Script>`, no
 * `deviceData.setup()`, nothing that could ever flip `ready`. The container's
 * branch is `unavailable ? message : ready ? form : skeleton`, so the customer
 * got `<SkeletonCardDetails />` FOREVER — no timeout — with the CTA disabled
 * beside "Completa los datos de tu tarjeta.", pointing at a card form that does
 * not exist. The `openpay-unavailable-message` written for exactly this case
 * could not render, because the default failed open on the one field that
 * selects it.
 *
 * Same principle as `isOpenpayOffered` and `hasShippingMethod`: absence of
 * evidence is not evidence of availability. Named and exported so a spec can
 * hold it — see `openpay-wrapper.spec.ts`; almost nothing else in this file is
 * reachable from a node runner.
 */
export const OPENPAY_CONTEXT_DEFAULT: OpenpayContextValue = {
  ready: false,
  unavailable: true,
  deviceSessionId: null,
  tokenize: () => Promise.reject(new Error("Openpay is not initialized")),
  cardData: null,
  setCardData: () => {},
}

export const OpenpayContext = createContext<OpenpayContextValue>(
  OPENPAY_CONTEXT_DEFAULT
)

const OPENPAY_CORE_SRC = "https://js.openpay.mx/openpay.v1.min.js"
const OPENPAY_DATA_SRC = "https://js.openpay.mx/openpay-data.v1.min.js"

type OpenpayWrapperProps = {
  /**
   * Non-secret Openpay config resolved at runtime from
   * GET /store/provider-config and threaded from the checkout server
   * component. `null`/missing → graceful degradation (card payments disabled).
   */
  config?: OpenpayPublicConfig | null
  /**
   * Whether the customer has chosen to pay through Openpay (`design.md` §12b).
   *
   * Gates the SCRIPTS, not the provider. The context is mounted either way, so
   * flipping this cannot remount the checkout subtree underneath it — a remount
   * here would throw away every section's local state on a payment-method
   * click.
   *
   * The decision itself is `shouldCollectOpenpayDeviceData`, in a module a spec
   * can load. This prop is wiring.
   */
  collectDeviceData?: boolean
  children: React.ReactNode
}

const OpenpayWrapper: React.FC<OpenpayWrapperProps> = ({
  config,
  collectDeviceData = false,
  children,
}) => {
  const [coreLoaded, setCoreLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [scriptFailed, setScriptFailed] = useState(false)
  const [deviceSessionId, setDeviceSessionId] = useState<string | null>(null)
  const [cardData, setCardData] = useState<OpenpayCardFields | null>(null)

  const merchantId = config?.merchantId
  const publicKey = config?.publicKey
  const sandbox = config?.sandbox ?? false

  // Graceful degradation: missing config must never crash the payment step —
  // other providers keep working; the Openpay option shows an unavailable state.
  const configMissing = !merchantId || !publicKey
  const unavailable = configMissing || scriptFailed

  useEffect(() => {
    if (configMissing) {
      console.error(
        "Openpay runtime configuration is unavailable (GET /store/provider-config returned no Openpay merchant id / public key, or the endpoint is unreachable). Openpay card payments are disabled."
      )
    }
  }, [configMissing])

  const handleScriptError = useCallback((src: string) => {
    return (error: unknown) => {
      console.error(`Failed to load Openpay script ${src}`, error)
      setScriptFailed(true)
    }
  }, [])

  const handleDataScriptLoaded = useCallback(() => {
    const openpay = window.OpenPay

    if (!openpay || !merchantId || !publicKey) {
      return
    }

    openpay.setId(merchantId)
    openpay.setApiKey(publicKey)
    openpay.setSandboxMode(sandbox)

    setDeviceSessionId(openpay.deviceData.setup())
    setReady(true)
  }, [merchantId, publicKey, sandbox])

  const tokenize = useCallback(
    (card: OpenpayCardFields): Promise<string> => {
      return new Promise((resolve, reject) => {
        const openpay = window.OpenPay

        if (!openpay || !ready) {
          reject(new Error("Openpay is not ready"))
          return
        }

        openpay.token.create(
          card,
          (response) => resolve(response.data.id),
          (error) =>
            reject(
              new Error(
                error?.data?.description ||
                  error?.message ||
                  "Card tokenization failed"
              )
            )
        )
      })
    },
    [ready]
  )

  /**
   * Memoized, which it was not before and now has to be.
   *
   * This component re-renders whenever the selected provider moves, and the
   * selection lives in a context that churns per keystroke. An unmemoized value
   * would push a new object at every `OpenpayContext` consumer — the card
   * container and the CTA — on every character typed anywhere in the checkout.
   */
  const value = useMemo(
    () => ({
      ready,
      unavailable,
      deviceSessionId,
      tokenize,
      cardData,
      setCardData,
    }),
    [ready, unavailable, deviceSessionId, tokenize, cardData]
  )

  return (
    <OpenpayContext.Provider value={value}>
      {/* WHEN THESE LOAD, AND WHAT THEY COLLECT.

          `openpay.v1.min.js` is the tokenization SDK. `openpay-data.v1.min.js`
          is NOT: it is Openpay's antifraud DEVICE-FINGERPRINTING collector. On
          load, `handleDataScriptLoaded` calls `deviceData.setup()`, which
          profiles the browser and returns a device session id identifying this
          device to Openpay.

          Neither loads until `collectDeviceData` is true, which per
          `design.md` §12b means the customer has SELECTED Openpay as their
          payment method — not merely opened the checkout. PR1b scoped this to
          regions where Openpay is purchasable, which still profiled every
          visitor who paid with Mercado Pago or abandoned. The rule is
          `shouldCollectOpenpayDeviceData`, in `lib/util/checkout-readiness.ts`
          where a spec can contradict it; this is the wire.

          `strategy="lazyOnload"` defers past hydration. It does not make the
          load conditional; it only makes it late. The gate is what makes it
          conditional.

          The cost is a short pending state on the card fields while the SDK
          arrives — the container already renders its skeleton until `ready`, so
          the customer cannot type a card before it lands. That is the trade
          §12b accepts. Treat this as a data-collection boundary, not a script
          tag: anything that widens `collectDeviceData` widens who is profiled.

          The CONTEXT still mounts unconditionally, and must. Gating the
          provider instead of the scripts would remount the whole checkout
          subtree on a payment-method click. */}
      {collectDeviceData && !configMissing && (
        <Script
          src={OPENPAY_CORE_SRC}
          strategy="lazyOnload"
          onLoad={() => setCoreLoaded(true)}
          onError={handleScriptError(OPENPAY_CORE_SRC)}
        />
      )}
      {coreLoaded && (
        <Script
          src={OPENPAY_DATA_SRC}
          strategy="lazyOnload"
          onLoad={handleDataScriptLoaded}
          onError={handleScriptError(OPENPAY_DATA_SRC)}
        />
      )}
      {children}
    </OpenpayContext.Provider>
  )
}

export default OpenpayWrapper

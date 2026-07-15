"use client"

import Script from "next/script"
import React, { createContext, useCallback, useEffect, useState } from "react"

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

export const OpenpayContext = createContext<OpenpayContextValue>({
  ready: false,
  unavailable: false,
  deviceSessionId: null,
  tokenize: () => Promise.reject(new Error("Openpay is not initialized")),
  cardData: null,
  setCardData: () => {},
})

const OPENPAY_CORE_SRC = "https://js.openpay.mx/openpay.v1.min.js"
const OPENPAY_DATA_SRC = "https://js.openpay.mx/openpay-data.v1.min.js"

type OpenpayWrapperProps = {
  /**
   * Non-secret Openpay config resolved at runtime from
   * GET /store/provider-config and threaded from the checkout server
   * component. `null`/missing → graceful degradation (card payments disabled).
   */
  config?: OpenpayPublicConfig | null
  children: React.ReactNode
}

const OpenpayWrapper: React.FC<OpenpayWrapperProps> = ({
  config,
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

  return (
    <OpenpayContext.Provider
      value={{ ready, unavailable, deviceSessionId, tokenize, cardData, setCardData }}
    >
      {/* Scripts load ONLY while an Openpay session is active on the payment
          step — this wrapper is rendered conditionally by payment-wrapper/index. */}
      {!configMissing && (
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

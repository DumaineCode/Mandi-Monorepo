"use server"

import { sdk } from "@lib/config"

/**
 * Mexican postal-code (SEPOMEX) lookup for the checkout address autocomplete.
 *
 * Server action: it runs on the server (keeps the SDK + locale headers off the
 * client bundle) but is callable from the client shipping-address form on CP
 * change. Mirrors `getProviderConfig` — SDK fetch, hard timeout, and a null
 * return on any failure so the form degrades to manual entry (never throws,
 * never blocks checkout).
 */

export type PostalCodeResult = {
  postal_code: string
  found: boolean
  state: string | null
  city: string | null
  municipality: string | null
  colonias: string[]
}

/** Fast degrade: a slow/hung backend must not stall the address form. */
const POSTAL_CODE_TIMEOUT_MS = 3_000

export async function getPostalCode(
  code: string
): Promise<PostalCodeResult | null> {
  const cp = (code ?? "").trim()

  // Mexican CPs are exactly 5 digits; skip the round-trip otherwise.
  if (!/^\d{5}$/.test(cp)) {
    return null
  }

  try {
    // The dataset is static, so cache hard (backend also sends max-age=1d).
    const result = await sdk.client.fetch<PostalCodeResult>(
      `/store/postal-codes/${cp}`,
      {
        method: "GET",
        cache: "force-cache",
        signal: AbortSignal.timeout(POSTAL_CODE_TIMEOUT_MS),
      }
    )

    return result?.found ? result : null
  } catch (error) {
    console.error(
      `Failed to look up postal code "${cp}" — address autocomplete unavailable for this entry.`,
      error
    )
    return null
  }
}

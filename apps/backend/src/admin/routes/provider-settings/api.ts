/**
 * Typed data-access wrappers for the admin provider-settings routes (slice 2
 * API). Everything goes through the JS SDK (`sdk.client.fetch`) so admin auth
 * headers/cookies are attached — never raw fetch (skill `data-sdk-always`).
 */
import { sdk } from "../../lib/client"
import type { MaskedProviderSetting } from "./form-model"

export type { MaskedProviderSetting }

export interface TestConnectionResult {
  ok: boolean
  detail: string
  checked_at: string
}

const BASE = "/admin/provider-settings"

/** Shared query key root so mutations can invalidate the display query. */
export const PROVIDER_SETTINGS_QUERY_KEY = ["provider-settings"] as const

export async function listProviderSettings(): Promise<MaskedProviderSetting[]> {
  const res = await sdk.client.fetch<{
    provider_settings: MaskedProviderSetting[]
  }>(BASE)
  return res.provider_settings
}

export async function upsertProviderSettings(
  provider: string,
  body: Record<string, unknown>
): Promise<MaskedProviderSetting> {
  const res = await sdk.client.fetch<{ provider_setting: MaskedProviderSetting }>(
    `${BASE}/${provider}`,
    { method: "POST", body }
  )
  return res.provider_setting
}

export async function clearProviderSettings(
  provider: string
): Promise<MaskedProviderSetting> {
  const res = await sdk.client.fetch<{ provider_setting: MaskedProviderSetting }>(
    `${BASE}/${provider}`,
    { method: "DELETE" }
  )
  return res.provider_setting
}

export async function testProviderConnection(
  provider: string,
  candidate: Record<string, unknown>
): Promise<TestConnectionResult> {
  return sdk.client.fetch<TestConnectionResult>(
    `${BASE}/${provider}/test-connection`,
    { method: "POST", body: candidate }
  )
}

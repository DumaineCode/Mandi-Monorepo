import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useQuery } from "@tanstack/react-query"
import { Container, Heading, Text } from "@medusajs/ui"
import { CogSixTooth } from "@medusajs/icons"

import {
  listProviderSettings,
  PROVIDER_SETTINGS_QUERY_KEY,
  type MaskedProviderSetting,
} from "./api"
import { PROVIDER_FORMS, PROVIDER_ORDER } from "./form-model"
import { ProviderPanel } from "./components/provider-panel"

const emptySetting = (provider: string): MaskedProviderSetting => ({
  provider,
  configured: false,
  mode: null,
  is_enabled: false,
  public_config: null,
  secrets: {},
  last_verified_at: null,
  updated_at: null,
})

const ProviderSettingsPage = () => {
  // Display query — loads on mount, no `enabled` tied to UI state
  // (skill `data-display-on-mount`). Panels re-seed from this on save/clear.
  const { data, isLoading, isError } = useQuery({
    queryKey: PROVIDER_SETTINGS_QUERY_KEY,
    queryFn: listProviderSettings,
  })

  const byProvider = new Map((data ?? []).map((row) => [row.provider, row]))

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Heading level="h1">Provider Settings</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage payment and shipping provider credentials. Secrets are
            encrypted at rest and never shown after saving. Changes take effect
            without a restart.
          </Text>
        </div>
      </Container>

      {isLoading ? (
        <Container className="flex items-center justify-center px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle">
            Loading provider settings…
          </Text>
        </Container>
      ) : isError ? (
        <Container className="px-6 py-8">
          <Text size="small" className="text-ui-fg-error">
            Could not load provider settings. Refresh to try again.
          </Text>
        </Container>
      ) : (
        PROVIDER_ORDER.map((provider) => (
          <ProviderPanel
            key={provider}
            def={PROVIDER_FORMS[provider]}
            data={byProvider.get(provider) ?? emptySetting(provider)}
          />
        ))
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Provider Settings",
  icon: CogSixTooth,
})

export default ProviderSettingsPage

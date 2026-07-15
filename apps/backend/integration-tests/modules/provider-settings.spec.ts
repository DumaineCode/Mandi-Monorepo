import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { PROVIDER_SETTINGS_MODULE } from "../../src/modules/provider-settings"
import { createProviderSettingsCrypto } from "../../src/modules/provider-settings/crypto"
import ProviderSetting from "../../src/modules/provider-settings/models/provider-setting"
import ProviderSettingsModuleService, {
  prepareProviderSettingRow,
} from "../../src/modules/provider-settings/service"

jest.setTimeout(120 * 1000)

/**
 * Slice 1 (task 1.8) — provider-settings module integration tests.
 *
 * TEST DATABASE REQUIREMENT: `moduleIntegrationTestRunner` provisions a
 * throwaway Postgres database and runs this module's generated migration
 * against it (mirrors the health.spec.ts caveat — a reachable Postgres is an
 * environment requirement, not a test concern).
 *
 * The deterministic test KEK comes from integration-tests/setup.js
 * (PROVIDER_SETTINGS_ENCRYPTION_KEY), so encryption is enabled end to end.
 */
const cryptoSeam = createProviderSettingsCrypto(
  process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY
)

const OPENPAY_SECRETS = {
  privateKey: "sk_test_private_key_1234",
  webhookUser: "hook_user_abcd",
  webhookPassword: "hook_pass_efgh",
}

const openpayRow = () =>
  prepareProviderSettingRow(cryptoSeam, {
    provider: "openpay",
    mode: "sandbox",
    publicConfig: { merchantId: "m_test_123", publicKey: "pk_test_5678" },
    secrets: OPENPAY_SECRETS,
  })

moduleIntegrationTestRunner<ProviderSettingsModuleService>({
  moduleName: PROVIDER_SETTINGS_MODULE,
  moduleModels: [ProviderSetting],
  resolve: "./src/modules/provider-settings",
  moduleOptions: { ttlMs: 0 },
  testSuite: ({ service }) => {
    describe("provider_setting CRUD + migration (real Postgres)", () => {
      it("creates and retrieves a settings row with ciphertext at rest", async () => {
        const created = await service.createProviderSettings(openpayRow())

        expect(created.id).toBeDefined()
        expect(created.provider).toBe("openpay")
        expect(created.mode).toBe("sandbox")
        expect(created.is_enabled).toBe(true)

        const [stored] = await service.listProviderSettings({
          provider: "openpay",
        })

        // Encrypted at rest: envelope format, no plaintext secret values.
        expect(stored.encrypted_secrets).toMatch(/^pset\.v1\./)
        const serialized = JSON.stringify(stored)
        for (const value of Object.values(OPENPAY_SECRETS)) {
          expect(serialized).not.toContain(value)
        }
        expect(stored.secret_hints).toMatchObject({
          privateKey: { last4: "1234", set: true },
        })
      })

      it("enforces one row per provider (unique index)", async () => {
        await service.createProviderSettings(openpayRow())

        await expect(
          service.createProviderSettings(openpayRow())
        ).rejects.toThrow()
      })

      it("resolves merged credentials from a stored row", async () => {
        await service.createProviderSettings(openpayRow())

        const resolved = await service.getResolvedCredentials("openpay")

        expect(resolved).toEqual({
          merchantId: "m_test_123",
          publicKey: "pk_test_5678",
          sandbox: true,
          ...OPENPAY_SECRETS,
        })
      })

      it("updates a row (upsert-style replace) and resolves the new secrets", async () => {
        const created = await service.createProviderSettings(openpayRow())

        const rotated = prepareProviderSettingRow(cryptoSeam, {
          provider: "openpay",
          mode: "production",
          publicConfig: { merchantId: "m_test_123", publicKey: "pk_live_9999" },
          secrets: { ...OPENPAY_SECRETS, privateKey: "sk_live_rotated_7777" },
        })
        await service.updateProviderSettings({ id: created.id, ...rotated })

        const resolved = await service.getResolvedCredentials("openpay")
        expect(resolved).toMatchObject({
          privateKey: "sk_live_rotated_7777",
          publicKey: "pk_live_9999",
          sandbox: false,
        })

        const rows = await service.listProviderSettings({
          provider: "openpay",
        })
        expect(rows).toHaveLength(1)
      })

      it("resolves null for unconfigured and disabled providers (fail-safe)", async () => {
        expect(await service.getResolvedCredentials("skydropx")).toBeNull()

        const created = await service.createProviderSettings(openpayRow())
        await service.updateProviderSettings({
          id: created.id,
          is_enabled: false,
        })
        expect(await service.getResolvedCredentials("openpay")).toBeNull()
      })

      it("resolves null after the row is deleted", async () => {
        const created = await service.createProviderSettings(openpayRow())
        expect(await service.getResolvedCredentials("openpay")).not.toBeNull()

        await service.deleteProviderSettings(created.id)
        expect(await service.getResolvedCredentials("openpay")).toBeNull()
      })
    })
  },
})

/**
 * Task 2.9 — admin provider-settings HTTP integration suite.
 *
 * Spec pins: unauthenticated → 401; upsert → masked GET where NO response
 * field equals any stored plaintext (success criterion #2, `••••` + last-4
 * for secrets >= 8 chars); partial save → validation error naming the field
 * with the previous row unchanged; test-connection (fetch-mocked, in-process)
 * stamps last_verified_at; DELETE → unconfigured.
 *
 * TEST DATABASE REQUIREMENT: same as health.spec.ts — a reachable local
 * Postgres; run via `pnpm test:integration:http` at verify time.
 */
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, generateJwtToken } from "@medusajs/framework/utils"

jest.setTimeout(120 * 1000)

const OPENPAY_BODY = {
  mode: "sandbox",
  merchantId: "m_test_123",
  publicKey: "pk_test_public",
  privateKey: "sk_secret_12345678",
  webhookUser: "hook",
  webhookPassword: "hook-pass-9123",
}

const PLAINTEXT_SECRETS = [
  OPENPAY_BODY.privateKey,
  OPENPAY_BODY.webhookUser,
  OPENPAY_BODY.webhookPassword,
]

/** Recursively collects every string value in a JSON payload. */
const collectStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") {
    out.push(value)
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out))
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, out))
  }
  return out
}

const MERCADOPAGO_BODY = {
  mode: "production",
  publicKey: "APP_USR-public-key",
  accessToken: "APP_USR-secret-access-token",
  webhookSecret: "mp-webhook-secret-123",
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("Admin provider-settings API", () => {
      let headers: { Authorization: string }
      let publishableHeaders: { "x-publishable-api-key": string }

      beforeEach(async () => {
        const container = getContainer()
        const userModule = container.resolve(Modules.USER)
        const authModule = container.resolve(Modules.AUTH)
        const apiKeyModule = container.resolve(Modules.API_KEY)

        const publishable = await apiKeyModule.createApiKeys({
          title: "provider-config-test",
          type: "publishable",
          created_by: "provider-settings-test",
        })
        publishableHeaders = { "x-publishable-api-key": publishable.token }

        const user = await userModule.createUsers({
          email: "admin@provider-settings.test",
        })
        const authIdentity = await authModule.createAuthIdentities({
          provider_identities: [
            {
              provider: "emailpass",
              entity_id: "admin@provider-settings.test",
            },
          ],
          app_metadata: { user_id: user.id },
        })

        const { http } = container.resolve("configModule").projectConfig
        const token = generateJwtToken(
          {
            actor_id: user.id,
            actor_type: "user",
            auth_identity_id: authIdentity.id,
            app_metadata: { user_id: user.id },
          },
          { secret: http.jwtSecret!, expiresIn: "1d" }
        )

        headers = { Authorization: `Bearer ${token}` }
      })

      it("rejects unauthenticated access to every route", async () => {
        const paths = [
          ["get", "/admin/provider-settings"],
          ["get", "/admin/provider-settings/openpay"],
          ["post", "/admin/provider-settings/openpay"],
          ["delete", "/admin/provider-settings/openpay"],
          ["post", "/admin/provider-settings/openpay/test-connection"],
        ] as const

        for (const [method, path] of paths) {
          const response = await (api as any)
            [method](path, method === "get" ? undefined : {})
            .catch((error: any) => error.response)
          expect(response.status).toEqual(401)
        }
      })

      it("upserts, returns masked reads with zero plaintext, and deletes", async () => {
        const saved = await api.post(
          "/admin/provider-settings/openpay",
          OPENPAY_BODY,
          { headers }
        )

        expect(saved.status).toEqual(200)
        expect(saved.data.provider_setting.configured).toBe(true)
        expect(saved.data.provider_setting.mode).toBe("sandbox")
        expect(saved.data.provider_setting.secrets.privateKey).toBe("••••5678")
        expect(saved.data.provider_setting.secrets.webhookUser).toBe(
          "••••••••"
        )
        expect(saved.data.provider_setting.secrets.webhookPassword).toBe(
          "••••9123"
        )

        // Success criterion #2: no response field equals any stored plaintext.
        for (const response of [
          saved,
          await api.get("/admin/provider-settings", { headers }),
          await api.get("/admin/provider-settings/openpay", { headers }),
        ]) {
          const strings = collectStrings(response.data)
          for (const secret of PLAINTEXT_SECRETS) {
            expect(strings).not.toContain(secret)
          }
        }

        const list = await api.get("/admin/provider-settings", { headers })
        expect(list.data.provider_settings).toHaveLength(3)
        expect(
          list.data.provider_settings.find(
            (p: any) => p.provider === "skydropx"
          ).configured
        ).toBe(false)

        const deleted = await api.delete("/admin/provider-settings/openpay", {
          headers,
        })
        expect(deleted.status).toEqual(200)
        expect(deleted.data.deleted).toBe(true)
        expect(deleted.data.provider_setting.configured).toBe(false)
      })

      it("rejects a partial save naming the field and keeps the previous row", async () => {
        await api.post("/admin/provider-settings/openpay", OPENPAY_BODY, {
          headers,
        })

        const { webhookPassword: _omit, ...partial } = {
          ...OPENPAY_BODY,
          mode: "production", // mode switch forces full secret re-entry
          privateKey: "sk_other_87654321",
          webhookUser: "hook2",
        }

        const rejected = await api
          .post("/admin/provider-settings/openpay", partial, { headers })
          .catch((error: any) => error.response)

        expect(rejected.status).toEqual(400)
        expect(JSON.stringify(rejected.data)).toContain("webhookPassword")

        const current = await api.get("/admin/provider-settings/openpay", {
          headers,
        })
        expect(current.data.provider_setting.mode).toBe("sandbox")
        expect(current.data.provider_setting.secrets.privateKey).toBe(
          "••••5678"
        )
      })

      it("runs test-connection (fetch-mocked) and stamps last_verified_at", async () => {
        await api.post("/admin/provider-settings/openpay", OPENPAY_BODY, {
          headers,
        })

        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => [],
        } as unknown as Response)

        try {
          const result = await api.post(
            "/admin/provider-settings/openpay/test-connection",
            {},
            { headers }
          )

          expect(result.status).toEqual(200)
          expect(result.data.ok).toBe(true)
          expect(result.data.checked_at).toBeTruthy()
          expect(String(fetchSpy.mock.calls[0][0])).toContain(
            "/m_test_123/charges?limit=1"
          )

          const current = await api.get("/admin/provider-settings/openpay", {
            headers,
          })
          expect(current.data.provider_setting.last_verified_at).toBeTruthy()
        } finally {
          fetchSpy.mockRestore()
        }
      })

      it("serves the public store config with only non-secret fields and null for unconfigured", async () => {
        // Unconfigured before any save: both providers null, Skydropx absent.
        const empty = await api.get("/store/provider-config", {
          headers: publishableHeaders,
        })
        expect(empty.status).toEqual(200)
        expect(empty.data).toEqual({ openpay: null, mercadopago: null })

        await api.post("/admin/provider-settings/openpay", OPENPAY_BODY, {
          headers,
        })
        await api.post("/admin/provider-settings/mercadopago", MERCADOPAGO_BODY, {
          headers,
        })

        const configured = await api.get("/store/provider-config", {
          headers: publishableHeaders,
        })
        expect(configured.status).toEqual(200)
        expect(configured.data.openpay).toEqual({
          merchantId: "m_test_123",
          publicKey: "pk_test_public",
          sandbox: true,
        })
        expect(configured.data.mercadopago).toEqual({
          publicKey: "APP_USR-public-key",
          sandbox: false,
        })
        expect(configured.data.skydropx).toBeUndefined()

        // No secret material anywhere in the public response.
        const strings = collectStrings(configured.data)
        for (const secret of [
          ...PLAINTEXT_SECRETS,
          MERCADOPAGO_BODY.accessToken,
          MERCADOPAGO_BODY.webhookSecret,
        ]) {
          expect(strings).not.toContain(secret)
        }

        // After an admin DELETE the provider drops back to null (not 5xx).
        await api.delete("/admin/provider-settings/openpay", { headers })
        const afterDelete = await api.get("/store/provider-config", {
          headers: publishableHeaders,
        })
        expect(afterDelete.data.openpay).toBeNull()
        expect(afterDelete.data.mercadopago).not.toBeNull()
      })

      it("fails test-connection with a reason for rejected credentials, persisting nothing", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          json: async () => ({}),
        } as unknown as Response)

        try {
          const result = await api.post(
            "/admin/provider-settings/openpay/test-connection",
            {
              mode: "sandbox",
              merchantId: "m_candidate",
              privateKey: "sk_bad_candidate",
            },
            { headers }
          )

          expect(result.status).toEqual(200)
          expect(result.data.ok).toBe(false)
          expect(result.data.detail).toMatch(/private key|credential/i)

          // Candidate credentials are never persisted.
          const current = await api.get("/admin/provider-settings/openpay", {
            headers,
          })
          expect(current.data.provider_setting.configured).toBe(false)
        } finally {
          fetchSpy.mockRestore()
        }
      })
    })
  },
})

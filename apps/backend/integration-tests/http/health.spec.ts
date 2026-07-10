import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"

jest.setTimeout(60 * 1000)

/**
 * HTTP harness smoke test (PF-1 "Jest commands run green").
 *
 * TEST DATABASE REQUIREMENT: `medusaIntegrationTestRunner` boots a real
 * Medusa app against a throwaway Postgres database that it creates and drops
 * per suite. A local Postgres server must be reachable (it uses the standard
 * DB_* / DATABASE_URL env resolution from @medusajs/test-utils). Without a
 * reachable Postgres, `pnpm test:integration:http` fails at boot — that is an
 * environment limitation, not a test failure.
 */
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("HTTP smoke", () => {
      it("responds on the framework /health endpoint", async () => {
        const response = await api.get("/health")

        expect(response.status).toEqual(200)
      })

      it("responds on the existing /store/custom route", async () => {
        // Store routes require a publishable API key header in Medusa 2.x.
        const apiKeyModule = getContainer().resolve(Modules.API_KEY)
        const publishableKey = await apiKeyModule.createApiKeys({
          title: "http-smoke",
          type: "publishable",
          created_by: "integration-test",
        })

        const response = await api.get("/store/custom", {
          headers: { "x-publishable-api-key": publishableKey.token },
        })

        expect(response.status).toEqual(200)
      })
    })
  },
})

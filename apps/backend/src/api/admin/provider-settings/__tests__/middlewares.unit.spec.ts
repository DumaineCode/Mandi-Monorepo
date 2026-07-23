/**
 * S1 (RED) — TestProviderConnectionBody two-secret + Carta Porte survival.
 *
 * The admin test-connection middleware body (api/middlewares.ts) uses `.strip()`,
 * so ANY field not listed on the schema is silently dropped before it can reach a
 * probe. This pins that the two PRO secrets (clientId/clientSecret) and the new
 * public Carta Porte fields (consignmentNote/packageType) are explicitly listed
 * (survive the strip) and that the legacy `apiKey` is not accepted (spec
 * Capability 1, R-B two-secret presence for the middleware layer).
 */
import { TestProviderConnectionBody } from "../../../middlewares"

describe("TestProviderConnectionBody (strip schema)", () => {
  it("keeps the two skydropx secrets + Carta Porte public fields, drops apiKey", () => {
    const parsed = TestProviderConnectionBody.parse({
      mode: "production",
      clientId: "sd_client_1234",
      clientSecret: "sd_secret_12345678",
      originZip: "64000",
      baseUrl: "https://api-pro.skydropx.com/api/v1",
      taxInclusive: true,
      consignmentNote: "31181701",
      packageType: "4G",
      // Legacy + hostile keys must be stripped.
      apiKey: "sd_key_12345678",
      evil: "http://attacker.example",
    })

    expect(parsed.clientId).toBe("sd_client_1234")
    expect(parsed.clientSecret).toBe("sd_secret_12345678")
    expect(parsed.originZip).toBe("64000")
    expect(parsed.baseUrl).toBe("https://api-pro.skydropx.com/api/v1")
    expect(parsed.taxInclusive).toBe(true)
    expect(parsed.consignmentNote).toBe("31181701")
    expect(parsed.packageType).toBe("4G")
    // Stripped, unlisted fields never survive.
    expect(parsed).not.toHaveProperty("apiKey")
    expect(parsed).not.toHaveProperty("evil")
  })

  it("accepts an empty body (tests stored credentials)", () => {
    expect(() => TestProviderConnectionBody.parse({})).not.toThrow()
  })

  it("rejects a non-url baseUrl", () => {
    expect(() =>
      TestProviderConnectionBody.parse({ baseUrl: "not-a-url" })
    ).toThrow()
  })
})

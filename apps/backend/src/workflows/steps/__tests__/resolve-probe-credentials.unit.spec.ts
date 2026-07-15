/**
 * Task 2.7 (RED) — resolve-probe-credentials pure merge.
 *
 * Spec "Test Connection": candidate credentials from the request win; when no
 * candidates are supplied the stored credentials are tested; nothing is ever
 * persisted here. Missing material resolves to a failed result, not a throw.
 */
import { mergeProbeCredentials } from "../resolve-probe-credentials"

const storedOpenpay = {
  merchantId: "m_stored",
  publicKey: "pk_stored",
  sandbox: true,
  privateKey: "sk_stored_12345678",
  webhookUser: "hook",
  webhookPassword: "hook-pass-9123",
}

describe("mergeProbeCredentials", () => {
  it("uses stored credentials when no candidate fields are supplied", () => {
    const result = mergeProbeCredentials("openpay", storedOpenpay, {})

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.creds.merchantId).toBe("m_stored")
      expect(result.creds.privateKey).toBe("sk_stored_12345678")
    }
  })

  it("fails with a not-configured detail when nothing is stored or supplied", () => {
    const result = mergeProbeCredentials("openpay", null, {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).toMatch(/not configured/i)
    }
  })

  it("builds credentials purely from a full candidate (test before save)", () => {
    const result = mergeProbeCredentials("openpay", null, {
      mode: "production",
      merchantId: "m_candidate",
      privateKey: "sk_candidate_1234",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.creds.merchantId).toBe("m_candidate")
      expect(result.creds.sandbox).toBe(false)
    }
  })

  it("overlays candidate fields onto stored credentials", () => {
    const result = mergeProbeCredentials("openpay", storedOpenpay, {
      privateKey: "sk_new_87654321",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.creds.privateKey).toBe("sk_new_87654321")
      expect(result.creds.merchantId).toBe("m_stored")
    }
  })

  it("fails naming the missing probe-required field", () => {
    const result = mergeProbeCredentials("openpay", null, {
      merchantId: "m_candidate",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).toMatch(/privateKey/)
    }
  })

  it("fails for an unknown provider", () => {
    const result = mergeProbeCredentials("stripe", null, {})

    expect(result.ok).toBe(false)
  })

  it("requires apiKey and originZip for skydropx probes", () => {
    const result = mergeProbeCredentials("skydropx", null, {
      apiKey: "sd_key_12345678",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).toMatch(/originZip/)
    }
  })

  it("requires only the access token for mercadopago probes", () => {
    const result = mergeProbeCredentials("mercadopago", null, {
      accessToken: "APP_USR-token-123",
    })

    expect(result.ok).toBe(true)
  })

  // FIX 1 (SSRF + stored-secret exfiltration): a candidate baseUrl that is not
  // https or not an allowlisted skydropx host MUST NOT cause the stored apiKey
  // to flow to that host. The merge fails before returning any creds.
  describe("skydropx probe baseUrl allowlist (SSRF guard)", () => {
    const storedSkydropx = {
      apiKey: "sd_stored_apikey_123456",
      originZip: "64000",
      baseUrl: "https://api.skydropx.com/v1",
      taxInclusive: true,
    }

    it("rejects a non-https candidate baseUrl and never exposes the stored apiKey", () => {
      const result = mergeProbeCredentials("skydropx", storedSkydropx, {
        baseUrl: "http://attacker.example",
      })

      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(storedSkydropx.apiKey)
    })

    it.each([
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:6379",
      "http://127.0.0.1/admin",
      "https://evil.example.com/v1",
    ])("rejects SSRF target %s", (baseUrl) => {
      const result = mergeProbeCredentials("skydropx", storedSkydropx, {
        baseUrl,
      })

      expect(result.ok).toBe(false)
    })

    it("accepts a re-entered https skydropx baseUrl paired with an apiKey", () => {
      const result = mergeProbeCredentials("skydropx", null, {
        apiKey: "sd_new_apikey_123456",
        originZip: "06600",
        baseUrl: "https://api-sandbox.skydropx.com/v1",
      })

      expect(result.ok).toBe(true)
    })

    it("uses stored credentials with the safe stored base when no candidate baseUrl is supplied", () => {
      const result = mergeProbeCredentials("skydropx", storedSkydropx, {})

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.creds.baseUrl).toBe("https://api.skydropx.com/v1")
      }
    })
  })
})

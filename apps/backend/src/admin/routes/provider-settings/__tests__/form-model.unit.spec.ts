/**
 * Unit tests for the pure Provider Settings form model (strict TDD, slice 4).
 *
 * This module holds ALL the non-trivial admin-UI logic (per-provider field
 * split, mode-toggle re-entry rules, request-body construction, test-connection
 * candidate building) so the `.tsx` components can stay thin and this behavior
 * is pinned without a browser. Zero React / SDK / `import.meta` imports here so
 * jest (swc, `.ts` only) can run it.
 */
import {
  PROVIDER_FORMS,
  PROVIDER_ORDER,
  initialFormState,
  deriveSecretState,
  buildUpsertBody,
  buildTestCandidate,
  type MaskedProviderSetting,
  type ProviderFormState,
} from "../form-model"

const masked = (
  over: Partial<MaskedProviderSetting> & { provider: string }
): MaskedProviderSetting => ({
  configured: false,
  mode: null,
  is_enabled: false,
  public_config: null,
  secrets: {},
  last_verified_at: null,
  updated_at: null,
  ...over,
})

describe("PROVIDER_FORMS field split", () => {
  it("declares the three providers in a stable order", () => {
    expect(PROVIDER_ORDER).toEqual(["openpay", "skydropx", "mercadopago"])
    for (const provider of PROVIDER_ORDER) {
      expect(PROVIDER_FORMS[provider].provider).toBe(provider)
      expect(PROVIDER_FORMS[provider].probeLabel).toEqual(expect.any(String))
    }
  })

  it("marks openpay privateKey/webhookUser/webhookPassword as secret, merchantId/publicKey as public", () => {
    const secrets = PROVIDER_FORMS.openpay.fields
      .filter((f) => f.secret)
      .map((f) => f.name)
      .sort()
    const publics = PROVIDER_FORMS.openpay.fields
      .filter((f) => !f.secret)
      .map((f) => f.name)
      .sort()
    expect(secrets).toEqual(["privateKey", "webhookPassword", "webhookUser"])
    expect(publics).toEqual(["merchantId", "publicKey"])
  })

  it("marks skydropx apiKey secret and originZip/baseUrl/taxInclusive public (taxInclusive boolean)", () => {
    const def = PROVIDER_FORMS.skydropx
    expect(def.fields.filter((f) => f.secret).map((f) => f.name)).toEqual([
      "apiKey",
    ])
    expect(def.fields.find((f) => f.name === "taxInclusive")?.type).toBe(
      "boolean"
    )
    expect(def.fields.find((f) => f.name === "baseUrl")?.optional).toBe(true)
  })

  it("marks mercadopago accessToken/webhookSecret secret and publicKey public", () => {
    const def = PROVIDER_FORMS.mercadopago
    expect(def.fields.filter((f) => f.secret).map((f) => f.name).sort()).toEqual(
      ["accessToken", "webhookSecret"]
    )
    expect(def.fields.filter((f) => !f.secret).map((f) => f.name)).toEqual([
      "publicKey",
    ])
  })
})

describe("initialFormState", () => {
  it("defaults an unconfigured provider to sandbox, enabled, empty values", () => {
    const state = initialFormState(PROVIDER_FORMS.openpay, null)
    expect(state.mode).toBe("sandbox")
    expect(state.isEnabled).toBe(true)
    expect(state.values.merchantId).toBe("")
    expect(state.values.privateKey).toBe("")
  })

  it("hydrates public fields and mode from a configured masked read, never plaintext secrets", () => {
    const state = initialFormState(
      PROVIDER_FORMS.openpay,
      masked({
        provider: "openpay",
        configured: true,
        mode: "production",
        is_enabled: true,
        public_config: { merchantId: "m_123", publicKey: "pk_live_9" },
        secrets: { privateKey: "••••abcd", webhookUser: "••••••••" },
      })
    )
    expect(state.mode).toBe("production")
    expect(state.isEnabled).toBe(true)
    expect(state.values.merchantId).toBe("m_123")
    expect(state.values.publicKey).toBe("pk_live_9")
    // Secrets are NEVER hydrated into editable inputs.
    expect(state.values.privateKey).toBe("")
    expect(state.values.webhookUser).toBe("")
  })

  it("hydrates skydropx taxInclusive boolean from public_config", () => {
    const state = initialFormState(
      PROVIDER_FORMS.skydropx,
      masked({
        provider: "skydropx",
        configured: true,
        mode: "sandbox",
        is_enabled: true,
        public_config: { originZip: "01000", taxInclusive: true },
      })
    )
    expect(state.values.originZip).toBe("01000")
    expect(state.booleans.taxInclusive).toBe(true)
  })
})

describe("deriveSecretState (Mode Toggle re-entry)", () => {
  const configuredSandbox = masked({
    provider: "openpay",
    configured: true,
    mode: "sandbox",
    is_enabled: true,
    public_config: { merchantId: "m_1", publicKey: "pk_1" },
    secrets: { privateKey: "••••abcd", webhookUser: "••••user", webhookPassword: "••••pass" },
  })

  it("keeps secrets optional and shows saved masks when the mode is unchanged", () => {
    const s = deriveSecretState(PROVIDER_FORMS.openpay, configuredSandbox, "sandbox")
    expect(s.modeChanged).toBe(false)
    expect(s.showReplaceWarning).toBe(false)
    const priv = s.fields.find((f) => f.name === "privateKey")!
    expect(priv.required).toBe(false)
    expect(priv.savedMask).toBe("••••abcd")
  })

  it("requires re-entry, clears saved masks and warns when the mode is switched", () => {
    const s = deriveSecretState(PROVIDER_FORMS.openpay, configuredSandbox, "production")
    expect(s.modeChanged).toBe(true)
    expect(s.showReplaceWarning).toBe(true)
    for (const f of s.fields) {
      expect(f.required).toBe(true)
      expect(f.savedMask).toBeNull()
    }
  })

  it("requires all secrets and warns nothing for an unconfigured provider", () => {
    const s = deriveSecretState(PROVIDER_FORMS.openpay, null, "sandbox")
    expect(s.modeChanged).toBe(false)
    expect(s.showReplaceWarning).toBe(false)
    expect(s.fields.every((f) => f.required && f.savedMask === null)).toBe(true)
  })
})

describe("buildUpsertBody", () => {
  const enter = (
    over: Partial<ProviderFormState> = {}
  ): ProviderFormState => ({
    mode: over.mode ?? "sandbox",
    isEnabled: over.isEnabled ?? true,
    values: {
      merchantId: "m_1",
      publicKey: "pk_1",
      privateKey: "",
      webhookUser: "",
      webhookPassword: "",
      ...over.values,
    },
    booleans: over.booleans ?? {},
  })

  it("includes every field when configuring a fresh provider", () => {
    const form = enter({
      values: {
        merchantId: "m_1",
        publicKey: "pk_1",
        privateKey: "sk_test_abcd",
        webhookUser: "wu",
        webhookPassword: "wp",
      },
    })
    const { body, missingSecrets } = buildUpsertBody(
      PROVIDER_FORMS.openpay,
      null,
      form
    )
    expect(missingSecrets).toEqual([])
    expect(body).toMatchObject({
      mode: "sandbox",
      is_enabled: true,
      merchantId: "m_1",
      publicKey: "pk_1",
      privateKey: "sk_test_abcd",
      webhookUser: "wu",
      webhookPassword: "wp",
    })
  })

  it("omits untouched secrets on a same-mode save (keep-existing)", () => {
    const configured = masked({
      provider: "openpay",
      configured: true,
      mode: "sandbox",
      is_enabled: true,
      public_config: { merchantId: "m_1", publicKey: "pk_1" },
      secrets: { privateKey: "••••abcd", webhookUser: "••••user", webhookPassword: "••••pass" },
    })
    const form = enter()
    const { body, missingSecrets } = buildUpsertBody(
      PROVIDER_FORMS.openpay,
      configured,
      form
    )
    expect(missingSecrets).toEqual([])
    expect(body).not.toHaveProperty("privateKey")
    expect(body).not.toHaveProperty("webhookUser")
    expect(body.merchantId).toBe("m_1")
  })

  it("reports missing secrets when switching mode without re-entry", () => {
    const configured = masked({
      provider: "openpay",
      configured: true,
      mode: "sandbox",
      is_enabled: true,
      public_config: { merchantId: "m_1", publicKey: "pk_1" },
      secrets: { privateKey: "••••abcd", webhookUser: "••••user", webhookPassword: "••••pass" },
    })
    const form = enter({ mode: "production" })
    const { missingSecrets } = buildUpsertBody(
      PROVIDER_FORMS.openpay,
      configured,
      form
    )
    expect(missingSecrets.sort()).toEqual([
      "privateKey",
      "webhookPassword",
      "webhookUser",
    ])
  })

  it("includes re-entered secrets on a mode switch and clears the missing list", () => {
    const configured = masked({
      provider: "openpay",
      configured: true,
      mode: "sandbox",
      is_enabled: true,
      public_config: { merchantId: "m_1", publicKey: "pk_1" },
      secrets: { privateKey: "••••abcd", webhookUser: "••••user", webhookPassword: "••••pass" },
    })
    const form = enter({
      mode: "production",
      values: {
        merchantId: "m_1",
        publicKey: "pk_1",
        privateKey: "sk_live_z",
        webhookUser: "wu2",
        webhookPassword: "wp2",
      },
    })
    const { body, missingSecrets } = buildUpsertBody(
      PROVIDER_FORMS.openpay,
      configured,
      form
    )
    expect(missingSecrets).toEqual([])
    expect(body).toMatchObject({
      mode: "production",
      privateKey: "sk_live_z",
      webhookUser: "wu2",
      webhookPassword: "wp2",
    })
  })

  it("serializes skydropx boolean taxInclusive and omits empty optional baseUrl", () => {
    const form: ProviderFormState = {
      mode: "sandbox",
      isEnabled: true,
      values: { originZip: "01000", baseUrl: "", apiKey: "key_abc" },
      booleans: { taxInclusive: true },
    }
    const { body } = buildUpsertBody(PROVIDER_FORMS.skydropx, null, form)
    expect(body.taxInclusive).toBe(true)
    expect(body).not.toHaveProperty("baseUrl")
    expect(body.originZip).toBe("01000")
    expect(body.apiKey).toBe("key_abc")
  })
})

describe("buildTestCandidate", () => {
  it("returns entered values plus mode, omitting empty fields", () => {
    const form: ProviderFormState = {
      mode: "production",
      isEnabled: true,
      values: { merchantId: "m_9", publicKey: "pk_9", privateKey: "sk_9", webhookUser: "", webhookPassword: "" },
      booleans: {},
    }
    const candidate = buildTestCandidate(PROVIDER_FORMS.openpay, form)
    expect(candidate).toEqual({
      mode: "production",
      merchantId: "m_9",
      publicKey: "pk_9",
      privateKey: "sk_9",
    })
  })

  it("returns just the mode when nothing was entered (tests stored credentials)", () => {
    const form: ProviderFormState = {
      mode: "sandbox",
      isEnabled: true,
      values: { merchantId: "", publicKey: "", privateKey: "", webhookUser: "", webhookPassword: "" },
      booleans: {},
    }
    const candidate = buildTestCandidate(PROVIDER_FORMS.openpay, form)
    expect(candidate).toEqual({ mode: "sandbox" })
  })
})

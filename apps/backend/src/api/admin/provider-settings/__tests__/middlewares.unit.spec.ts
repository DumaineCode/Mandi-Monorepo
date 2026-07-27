/**
 * S1 (RED) — provider-settings middleware body schemas vs the admin form.
 *
 * The save schema (`UpsertProviderSettingsBody`) is run by Medusa through
 * `zodValidator`, which FORCES `.strict()` (`if ("strict" in schema) schema =
 * schema.strict()`), overriding `.passthrough()` / `.strip()`. The test-connection
 * schema uses `.strip()`, so any unlisted field is silently dropped before it can
 * reach a probe. Either way, a field rendered by the admin form but missing from
 * the middleware schema breaks the feature (spec Capability 1, R-B).
 *
 * REGRESSION GUARD: the bodies below are DERIVED from the producer
 * (`PROVIDER_FORMS` + `buildUpsertBody` / `buildTestCandidate`), never
 * hand-written. A hand-written literal drifts silently the moment a field is
 * added to the form — which is exactly how `originEmail`/`originCompany`/
 * `originPhone` shipped missing from the save schema. With the derivation, adding
 * a form field without adding it to the middleware fails THIS test automatically.
 */
import {
  buildTestCandidate,
  buildUpsertBody,
  PROVIDER_FORMS,
  PROVIDER_ORDER,
  type ProviderFormDef,
  type ProviderFormState,
} from "../../../../admin/routes/provider-settings/form-model"
import {
  TestProviderConnectionBody,
  UpsertProviderSettingsBody,
} from "../../../middlewares"

/**
 * Realistic values for format-constrained fields so a fully-populated form is
 * actually parseable. Any other field gets a generic non-empty string.
 */
const SAMPLE_VALUES: Record<string, string> = {
  baseUrl: "https://api-pro.skydropx.com/api/v1",
  originEmail: "ops@mandi.mx",
}

/** Every rendered field of a provider form, populated — nothing left empty. */
const fullyPopulatedForm = (def: ProviderFormDef): ProviderFormState => {
  const values: Record<string, string> = {}
  const booleans: Record<string, boolean> = {}

  for (const field of def.fields) {
    if (field.type === "boolean") {
      booleans[field.name] = true
      continue
    }
    values[field.name] = SAMPLE_VALUES[field.name] ?? `${field.name}-value`
  }

  return { mode: "sandbox", isEnabled: true, values, booleans }
}

const ALL_PROVIDERS = [...PROVIDER_ORDER]

describe("UpsertProviderSettingsBody (forced-strict save)", () => {
  const forcedStrict = UpsertProviderSettingsBody.strict()

  it.each(ALL_PROVIDERS)(
    "accepts the FULL rendered %s form body produced by buildUpsertBody",
    (provider) => {
      const def = PROVIDER_FORMS[provider]
      const { body } = buildUpsertBody(def, null, fullyPopulatedForm(def))

      // The derivation must be non-vacuous: every rendered field has to be in
      // the body, otherwise this test could pass while guarding nothing.
      for (const field of def.fields) {
        expect(body).toHaveProperty(field.name)
      }

      expect(() => forcedStrict.parse(body)).not.toThrow()
    }
  )

  it("keeps the skydropx origin contact fallbacks through the save schema", () => {
    const def = PROVIDER_FORMS.skydropx
    const { body } = buildUpsertBody(def, null, fullyPopulatedForm(def))
    const parsed = forcedStrict.parse(body)

    expect(parsed.originEmail).toBe("ops@mandi.mx")
    expect(parsed.originCompany).toBe("originCompany-value")
    expect(parsed.originPhone).toBe("originPhone-value")
    expect(parsed.clientId).toBe("clientId-value")
  })

  it("still rejects a genuinely unknown field and a bad baseUrl", () => {
    expect(() => forcedStrict.parse({ mode: "sandbox", evil: "x" })).toThrow()
    expect(() =>
      forcedStrict.parse({ mode: "sandbox", baseUrl: "not-a-url" })
    ).toThrow()
  })

  it("rejects a malformed originEmail at the HTTP layer, like the workflow step", () => {
    expect(() =>
      forcedStrict.parse({ mode: "sandbox", originEmail: "not-an-email" })
    ).toThrow()
  })
})

describe("TestProviderConnectionBody (strip schema)", () => {
  it.each(ALL_PROVIDERS)(
    "keeps every rendered %s field through the strip schema",
    (provider) => {
      const def = PROVIDER_FORMS[provider]
      const candidate = buildTestCandidate(def, fullyPopulatedForm(def))
      const parsed = TestProviderConnectionBody.parse(candidate) as Record<
        string,
        unknown
      >

      for (const field of def.fields) {
        expect(parsed).toHaveProperty(field.name)
      }
    }
  )

  it("drops the legacy apiKey and hostile unlisted keys", () => {
    const parsed = TestProviderConnectionBody.parse({
      mode: "production",
      clientId: "sd_client_1234",
      clientSecret: "sd_secret_12345678",
      apiKey: "sd_key_12345678",
      evil: "http://attacker.example",
    })

    expect(parsed.clientId).toBe("sd_client_1234")
    expect(parsed.clientSecret).toBe("sd_secret_12345678")
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

  it("rejects a malformed originEmail, symmetrically with the save schema", () => {
    expect(() =>
      TestProviderConnectionBody.parse({ originEmail: "not-an-email" })
    ).toThrow()
  })
})

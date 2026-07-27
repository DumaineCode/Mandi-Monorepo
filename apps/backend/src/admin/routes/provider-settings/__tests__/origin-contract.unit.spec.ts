/**
 * WARNING 4 — cross-layer contract between the admin form and the label guard.
 *
 * `originEmail` was optional at EVERY admin layer (`PROVIDER_FORMS.skydropx`,
 * both HTTP schemas, `validate-provider-payload`) and mandatory at the label
 * layer (`missingOriginFields`): `stock_location_address` has no email column,
 * so nothing but the setting can supply the `address_from.email` PRO requires.
 *
 * With zero fulfillments in the database, the first operator to buy a label on a
 * freshly configured provider hit a hard `INVALID_DATA` on a configuration that
 * the admin UI, the save endpoint, the test-connection probe and the test suite
 * all reported as complete.
 *
 * These tests pin the two layers against each other in BOTH directions so they
 * cannot drift again:
 *   forward — a field the guard hard-requires is marked required in the form;
 *   reverse — a field the guard tolerates stays optional in the form.
 *
 * The requirement is deliberately surfaced at PRESENTATION time only. The stored
 * schema and both HTTP schemas keep `originEmail` `.optional()`, so rows saved
 * before this change stay valid and loadable (backwards compatibility).
 */
import { missingOriginFields } from "../../../../modules/skydropx-fulfillment/service"
import { skydropxUpsertSchema } from "../../../../workflows/steps/validate-provider-payload"
import { PROVIDER_FORMS } from "../form-model"

/** A stock location with every component the label guard needs from the ADDRESS. */
const completeOriginAddress = {
  address_1: "Valle del Carmen 184",
  address_2: "Valle de Aragon",
  city: "Ciudad Nezahualcoyotl",
  province: "México",
  postal_code: "57100",
  country_code: "mx",
  company: "Bodega Mandi",
  phone: "5555550100",
}

const field = (name: string) =>
  PROVIDER_FORMS.skydropx.fields.find((f) => f.name === name)

describe("skydropx origin contact: admin form ↔ label guard (WARNING 4)", () => {
  describe("forward — what the guard hard-requires is required in the form", () => {
    it("hard-fails the label without an origin contact email", () => {
      const missing = missingOriginFields(completeOriginAddress, {
        name: "CDMX Warehouse",
        company: undefined,
        phone: undefined,
        email: undefined,
      })

      expect(missing).toContain("email")
    })

    it("marks originEmail as required in the admin form", () => {
      expect(field("originEmail")).toBeDefined()
      expect(field("originEmail")?.optional).toBeFalsy()
    })
  })

  describe("reverse — what the guard tolerates stays optional in the form", () => {
    it("accepts an origin whose company/phone come from the stock location alone", () => {
      const missing = missingOriginFields(completeOriginAddress, {
        name: "CDMX Warehouse",
        company: undefined,
        phone: undefined,
        email: "ops@mandi.mx",
      })

      expect(missing).toEqual([])
    })

    it("keeps originCompany and originPhone optional, because they are fallbacks", () => {
      expect(field("originCompany")?.optional).toBe(true)
      expect(field("originPhone")?.optional).toBe(true)
    })
  })

  /**
   * Backwards compatibility: making the field required in the FORM must not make
   * it required in the stored/HTTP schema, or every provider row saved before
   * this change would stop validating.
   */
  it("keeps originEmail optional in the stored schema so existing rows stay valid", () => {
    const parsed = skydropxUpsertSchema.safeParse({
      mode: "sandbox",
      originZip: "01000",
      clientId: "sky_client_id",
      clientSecret: "sky_client_secret_value",
    })

    expect(parsed.success).toBe(true)
  })
})

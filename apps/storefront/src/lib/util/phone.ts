/**
 * Mexican phone input contract for the checkout shipping form.
 *
 * Skydropx PRO marks `phone` as Required on `address_to` for POST /shipments, so
 * an order placed without one can never be labelled. But the first attempt at
 * enforcing that used `(?:[\s()-]*\d){10}[\s()-]*`, which is EXACTLY 10 digits
 * with no `+` in the separator class — it rejected every country-prefixed form:
 *
 *   +52 55 1234 5678   +525512345678   5215555555555
 *   52 55 1234 5678    01 55 1234 5678  045 55 1234 5678
 *
 * The field carries `autoComplete="tel"`, and browser/OS tel autofill in MX
 * stores E.164 (`+52…`), so the most likely autofilled value was the one we
 * rejected — and `5215555555555` is the form Skydropx's OWN docs use. The result
 * was a native "Ingresa un teléfono de 10 dígitos" bubble on a number the
 * customer knows is correct, and a checkout they cannot complete. There is no
 * documented Skydropx phone-format constraint (pro-api-reference.md:71-72 lists
 * `phone` with no format), so exactly-10 was an unverified assumption that
 * traded a post-sale label failure for a lost sale.
 *
 * This accepts what people actually type: 10 national digits, optionally behind
 * a `+52` / `52` / `+521` / `521` country prefix or a legacy `01` / `044` /
 * `045` trunk prefix, with spaces, dashes and parentheses anywhere.
 *
 * The backend is the one that puts a phone on the wire, and it normalizes there
 * (`skydropx-fulfillment/service.ts` → `normalizePhone`) for BOTH `address_from`
 * and `address_to`, so non-storefront paths (saved addresses, the store API,
 * admin edits) are covered too. This pattern is the friendly front door, not the
 * guarantee.
 */

/**
 * Separators tolerated anywhere in the number.
 *
 * The parentheses are ESCAPED on purpose: an unescaped `(` / `)` inside a
 * character class does not compile under the `v` flag ("Invalid character in
 * character class"). Browsers currently fall back to `u` for the `pattern`
 * attribute, but relying on an unverified fallback is how a required field
 * silently stops validating.
 */
const SEPARATORS = String.raw`[\s\(\)\-]*`

/**
 * Optional country (`52`, `521`) or legacy national trunk (`01`, `044`, `045`)
 * prefix. `52[\s\(\)\-]*1?` covers both `+52 55…` and the `+52 1 55…` / `521…`
 * mobile form.
 */
const PREFIX = String.raw`(?:52${SEPARATORS}1?|0(?:1|4[45]))?`

/**
 * Value for the `pattern` attribute of the checkout phone input.
 *
 * NOT anchored here: HTML anchors `pattern` implicitly (`^(?:…)$`). Anchoring it
 * again would be harmless but misleading about where the boundary comes from.
 */
export const MX_PHONE_PATTERN =
  String.raw`\+?${SEPARATORS}${PREFIX}${SEPARATORS}(?:${SEPARATORS}\d){10}${SEPARATORS}`

/** Spanish `title`, i.e. the native validation bubble. Must describe what is actually accepted. */
export const MX_PHONE_TITLE =
  "Ingresa un teléfono de 10 dígitos, con o sin lada de país " +
  "(ej. 55 1234 5678, (55) 1234-5678 o +52 55 1234 5678)."

/**
 * Programmatic mirror of {@link MX_PHONE_PATTERN}, applying the same implicit
 * anchoring the browser applies. Exported so the rule can be exercised outside a
 * browser; the input itself uses the pattern attribute.
 */
export const isValidMxPhone = (value?: string | null): boolean =>
  new RegExp(`^(?:${MX_PHONE_PATTERN})$`, "u").test(value ?? "")

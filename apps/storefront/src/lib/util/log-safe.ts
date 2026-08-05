/**
 * Helpers for logging about a cart without logging the cart.
 *
 * ## Why a cart id may not appear in a log line
 *
 * A Medusa cart id is a bearer credential in everything but name. The store
 * cart routes carry NO customer authentication:
 *
 * - `GET /store/carts/:id` — `@medusajs/medusa/dist/api/store/carts/middlewares.js:44-51`
 * - `POST /store/carts/:id` — same file, `:63-70`
 *
 * Both are gated only by the publishable API key, which is a build-time public
 * value shipped to every browser (`lib/config.ts:14`). The default response
 * fields for that GET include `email`, `customer.email` and the whole
 * `shipping_address` block — `first_name`, `last_name`, `phone`, `address_1`,
 * `address_2`, `city`, `postal_code`
 * (`@medusajs/medusa/dist/api/store/carts/query-config.js:103+`).
 *
 * So a cart id sitting in a log stream lets anyone with log access read *and
 * modify* that customer's personal data for the full 7-day lifetime of the
 * `_medusa_cart_id` cookie (`lib/data/cookies.ts:74`). Log access is a much
 * wider circle than checkout access.
 *
 * The observability goal that motivated these log lines — making
 * `MissingDimensionsError` and a replaced `cart_address` row visible — is fully
 * served by an option id, an HTTP status, an error message and a correlation
 * handle. None of those require the credential itself.
 */

/** Characters of the id kept for correlation. */
const REFERENCE_TAIL_LENGTH = 6

/**
 * Reduces an id to a short, stable correlation handle.
 *
 * ## What this is, precisely
 *
 * REDACTION, not pseudonymization. An earlier version of this comment called the
 * output "non-reversible", which overstates it. The transform is unsalted and
 * deterministic, so it is not reversible but it IS confirmable: anyone who
 * already holds a cart id can compute this reference themselves and pick out
 * every log line belonging to that cart. What the property actually buys is that
 * the log line does not HAND OUT a credential to a reader who did not already
 * have one — which is the threat here, since log access is a much wider circle
 * than checkout access.
 *
 * Salting would close the confirmation gap and would also destroy the only
 * reason this function exists: two log lines about one cart must join, and a
 * salted or random handle makes that impossible across processes. Confirmation
 * by someone already holding the id is an acceptable price; disclosure to
 * someone who is not is not.
 *
 * Truncation rather than hashing on purpose: this runs on a request path, and a
 * hash would need `crypto.subtle` (async) or a hand-rolled digest to buy a
 * property truncation already has. With 24 characters withheld, the tail cannot
 * be walked back to the id.
 *
 * The disclosure budget is asserted as an UPPER BOUND in `log-safe.spec.ts`, not
 * merely as "the tail is present". An earlier version of that suite pinned only
 * the lower bound and stayed green while this constant emitted 29 of a 30
 * character id.
 */
export const toLogReference = (id: string | null | undefined): string => {
  if (!id) {
    return "unknown"
  }

  // Showing the last 6 characters of a 6-character id is showing the id. When
  // there is nothing to withhold, withhold everything: an unusable reference is
  // a far cheaper failure than a leaked one.
  if (id.length <= REFERENCE_TAIL_LENGTH) {
    return "***"
  }

  return `…${id.slice(-REFERENCE_TAIL_LENGTH)}`
}

export type ErrorDescription = {
  message: string
  status: number | undefined
}

/**
 * Matches a Medusa entity id anywhere inside free text.
 *
 * Medusa mints every id as a lowercase prefix, an underscore, and a 26-character
 * ULID in Crockford base32 (`generateEntityId`), so the shape is matched rather
 * than an allow-list of prefixes: `cart_`, `caaddr_`, `so_`, and every entity
 * type nobody has thought about yet are all covered without a code change here.
 *
 * - `[a-z][a-z0-9_]*_` — the prefix, greedy up to the LAST underscore, so
 *   multi-segment prefixes match too;
 * - `[0-9A-HJKMNP-TV-Z]{26}` — Crockford base32 excludes `I`, `L`, `O` and `U`,
 *   which is what keeps this from matching an ordinary 26-letter word;
 * - the boundaries stop it eating the quote in `'cart_…'` or the comma in a
 *   joined list.
 *
 * KNOWN LIMIT: an id in some other format would pass through. This is a
 * defence-in-depth layer over messages whose shapes are quoted in the spec, not
 * a general PII scrubber, and it does not attempt to find emails or addresses.
 */
const MEDUSA_ID_PATTERN = /\b[a-z][a-z0-9_]*_[0-9A-HJKMNP-TV-Z]{26}\b/g

/**
 * Replaces every Medusa id in a string with its log reference.
 *
 * Exported for the spec; the production caller is `describeError`.
 */
export const redactIds = (text: string): string =>
  text.replace(MEDUSA_ID_PATTERN, (id) => toLogReference(id))

/**
 * Pulls the two diagnostic fields worth logging out of a thrown value, with any
 * entity id in the message redacted.
 *
 * Logging the error OBJECT is the first leak: the SDK's `FetchError`
 * (`@medusajs/js-sdk/dist/esm/client.d.ts:13-17`) is an `Error` subclass, and
 * whatever the transport attached — `cause`, request context, a response body —
 * rides along into the log stream. On this API a validation error body can echo
 * address content straight back. `message` and `status` are the whole
 * diagnostic value; the rest is payload.
 *
 * ## Why the MESSAGE itself has to be redacted
 *
 * `FetchError.message` is the backend's response body VERBATIM —
 * `new FetchError(jsonError.message ?? resp.statusText, ...)`
 * (`@medusajs/js-sdk/dist/esm/client.js:90`). And Medusa puts the raw cart id
 * inside exactly the not-found errors these log lines exist to capture:
 *
 * - `@medusajs/orchestration/dist/joiner/remote-joiner.js:475` —
 *   `` `${entityName} ${pkField} not found: ` + ids.join(", ") ``, reached from
 *   `GET /store/shipping-options` via `useRemoteQueryStep({ throwIfKeyNotFound:
 *   true })` (`list-shipping-options-for-cart.js:128`);
 * - `@medusajs/medusa/dist/api/store/carts/helpers.js:14` —
 *   `` `Cart with id '${id}' not found` ``.
 *
 * A completed, expired or deleted cart is the MOST likely reason these calls
 * fail. Without this step the log line masks the id in its `cart:` field and
 * prints it in full in the `message:` field immediately beside it, which is
 * worse than not masking at all — it looks safe.
 *
 * Redaction preserves the surrounding text, so "not found" survives and the
 * diagnostic value is intact.
 */
export const describeError = (error: unknown): ErrorDescription => {
  const message =
    error instanceof Error ? redactIds(error.message) : "Unknown error"

  // `FetchError` declares `status: number | undefined`, but this function is
  // also handed plain `Error`s and non-`Error` throws, so the shape is probed
  // rather than asserted.
  const status = (error as { status?: unknown })?.status

  return {
    message,
    status: typeof status === "number" ? status : undefined,
  }
}

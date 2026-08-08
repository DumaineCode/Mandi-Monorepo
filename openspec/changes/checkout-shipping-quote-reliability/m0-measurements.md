# M0 Measurement Gate — `checkout-shipping-quote-reliability`

**Date**: 2026-08-07
**Environment measured**: local development (`medusa develop` on :9000, `next dev --turbopack` on :8000), Skydropx **SANDBOX** (`sb-pro.skydropx.com`), Postgres + Redis in Docker.
**Repo state**: clean. Two constants and one probe function were temporarily edited and reverted via `git checkout --`; `git diff` is empty and verified below.

## Verdict table

| # | Question | Verdict | Evidence class |
|---|----------|---------|----------------|
| M0(a) | Real cold-quotation completion time distribution | **n=40, min 8163ms, median 9903ms, p90 11528ms, p95 11574ms, max 12252ms. 40/40 samples exceeded the current 8000ms budget.** Recommended budget: **18000ms**. | **MEASURED** |
| M0(b) | Will the stack hold a long response on `calculate`? | **Yes.** Held **51909ms** end-to-end, HTTP 200, real price. At 8s the *app* is the only thing cutting (8051ms → HTTP 500). No transport ceiling found below ~52s. | **MEASURED** (backend leg + config); **INFERRED** (browser→Next leg, production proxy) |
| M0(c) | Does `Modules.CACHE` resolve inside a fulfillment provider? | **Yes.** Resolves from the *global* container to `RedisCacheService`; full `set`/`get` roundtrip executed from inside `calculatePrice`, key verified in Redis. The provider has **no** `__container__` scope. | **MEASURED** |

---

## M0(a) — Cold-quotation completion time distribution

### Methodology

- **Standalone harness**, not `medusa exec` (which hangs with `KnexTimeoutError` in this environment). Credentials read from `provider_setting.encrypted_secrets` and decrypted with AES-256-GCM (AAD `skydropx:v1`) per `apps/backend/src/modules/provider-settings/crypto.ts`.
- **Every destination unique** — postal code AND city AND colonia all vary, across **40 different Mexican localities in 28 states**. Skydropx caches quotations server-side and returns a repeated identical payload in ~1s; no sample reuses a payload. The smoke-test destination (44100 Guadalajara) was excluded from the dataset after burning it.
- **Two cohorts**, deliberately: 28 state-capital / major-city CPs (best case for carrier coverage) and 12 secondary or remote localities (Mulegé, Doctor Arroyo, Xul-Há, Pinotepa Nacional…) to expose the real tail and the zero-coverage outcome.
- **Rate limiting respected**: poll interval **1000ms** (identical to production `QUOTE_POLL_INTERVAL_MS`, so poll-round counts map 1:1 onto the real client) and a **3000ms gap between samples**. Sustained rate ≈ 1 req/s, comfortably under the ~2 req/s carrier cap referenced in the codebase. No sample was throttled — zero 429s, zero errors across 40 samples.
- **Parcel matches production exactly**: `{length:20, width:20, height:15, weight:1}` — `weight_kg = 1000g / 1000` per `parcel.ts:45`, for variant `variant_01KVC17KDGJ7GVPNEDNMHWMN9R`.
- **State names carry accents** (`Michoacán`, `Nuevo León`, `Querétaro`) because `service.ts normalizeState()` emits accented `MX_STATE_NAMES` on the real path.

### Results (n = 40, all completed, all with usable rates)

**Total time to `is_completed` (ms)**

| stat | value |
|------|-------|
| min | **8163** |
| median | **9903** |
| p75 | 10162 |
| p90 | **11528** |
| p95 | **11574** |
| p99 / max | **12252** |
| mean | 9704 |
| stddev | 1134 |

**Split: `POST /quotations` vs. polling**

| stat | POST latency (ms) | poll rounds |
|------|-------------------|-------------|
| min | 506 | 4 |
| median | 612 | 6 |
| p95 | 1133 | 7 |
| max | 1190 | 7 |

The POST is fast and stable (~0.6s). **Essentially all the latency is carrier fan-out during polling** — 4 to 7 rounds at 1s each. No quotation ever completed on the POST itself.

**Zero-usable-rate outcomes**: **0 of 40**. Every destination — including Mulegé, Doctor Arroyo and Xul-Há — returned at least 5 rates with `success: true` and a non-null `total`. Usable rates ranged 5–8 out of 38 returned rate rows. So the timing distribution is **not** polluted by unserviceable destinations, and "nobody serves this CP" did not occur even at the rural edge of the sample.

**Separate outcome discovered**: an *invalid* postal code (45000 "Zapopan", not a real CP) fails **fast — 556ms** — not slow. Bad addresses are a fast-fail class, not a timeout class. They do not consume the budget.

**Raw sorted totals (ms)**

```
8163, 8197, 8207, 8240, 8262, 8313, 8365, 8368, 8521, 8566,
8593, 8691, 8795, 9084, 9148, 9205, 9447, 9720, 9800, 9848,
9958, 9972, 10037, 10085, 10105, 10106, 10107, 10110, 10132, 10162,
10270, 10307, 10413, 10607, 11502, 11528, 11548, 11574, 11845, 12252
```

### The headline finding

**40 of 40 samples exceeded 8000ms. The current budget is below the FLOOR of the distribution (8163ms), not below its tail.**

`SKYDROPX_QUOTATION_TIMEOUT_MS = 8_000` cannot succeed on a cold quotation in this environment. It is not a tail-risk problem — it is a 100% failure rate. The three prior samples (12811, 11353, 12043) were not unlucky outliers; they were normal.

### Converting harness time to app-level time

The harness measures `POST + Σ(sleep + GET)`. The app budget additionally covers DB credential resolution and the OAuth token fetch. Measured directly from the two long-hold runs in M0(b):

- 23644ms observed − 22000ms sleep − ~900ms (POST+GET) ≈ **744ms** overhead
- 51909ms observed − 50000ms sleep − ~900ms ≈ **1009ms** overhead

So **app-level total ≈ harness total + ~0.8–1.0s** on a cold client (the token is cached afterwards, so a warm process pays only credential resolution). This model cross-checks against the prior app-level samples: 12811ms − 1000ms = 11811ms, which lands at ~p96 of the harness distribution. Consistent.

**App-level cold distribution (derived)**: median ≈ 10.9s, p95 ≈ 12.6s, max observed ≈ 13.3s.

### Recommended budget: `SKYDROPX_QUOTATION_TIMEOUT_MS = 18_000`

**Margin applied: ~1.43× over the app-level p95 (12.6s); ~1.35× over the maximum observed app-level value (13.3s).**

Why this value:

1. **Floor constraint.** Anything below ~9.2s app-level is guaranteed to fail on a cold quote. The measured minimum is a hard lower bound, not a target.
2. **Poll quantization.** The loop can only observe completion at 1000ms boundaries, so a quote finishing at 12.3s is *reported* at 13.0s. The budget must clear max + one poll interval.
3. **Tail uncertainty is the dominant risk.** n=40 has exactly **one** sample above 12s. That is not enough to resolve a p99, and the margin has to absorb what I could not measure: peak-season carrier load, production host behaviour, and a cold OAuth token coinciding with a slow round.
4. **Not larger, because a shopper is waiting.** 20000ms is defensible if the design pairs it with a visible progress state; 18000ms already gives 1.35× over everything observed.
5. **15000ms is the aggressive floor** — only 1.13× over max observed. One extra poll round plus a cold token eats it. I do not recommend it.

This recommendation assumes the S5 quotation cache lands: with a cache, only the first shopper per destination pays the full budget.

---

## M0(b) — Will the stack hold a long response open on `calculate`?

### MEASURED — the app is the binding constraint at 8s

Real cart built through the Store API (region `reg_01KVBXJSCHRN339J0SZNS2FFW5`, variant `variant_01KVC17KDGJ7GVPNEDNMHWMN9R`), real MX shipping address, real `POST /store/shipping-options/so_01KY8NTFC3JP3XDEXA1SZ8BCA7/calculate`:

| Run | Constants | Elapsed | HTTP | Result |
|-----|-----------|---------|------|--------|
| baseline | 8000 / poll 1000 | **8051ms** | 500 | `unexpected_state`, "Skydropx could not quote this shipment." |
| long hold | 30000 / poll 22000 | **23644ms** | **200** | real price `35.47` |
| longer hold | 70000 / poll 50000 | **51909ms** | **200** | real price `35.47` |
| post-revert | 8000 / poll 1000 | **8035ms** | 500 | back to the original failure |

The baseline reproduces the prior 8.102s measurement. **At 8s the app-level budget is the only thing cutting — the transport is nowhere near its limit.**

The long-hold runs were produced by temporarily raising `SKYDROPX_QUOTATION_TIMEOUT_MS` **and** `QUOTE_POLL_INTERVAL_MS`, so the poll loop genuinely sleeps through a single long round and the endpoint holds a real synchronous response for the full duration. Both were reverted.

**Conclusion: no transport ceiling exists below ~52 seconds on the client→backend leg.** A raise to 18000ms is transported without any change to server or client configuration.

The probing client is Node's global `fetch` (undici) with **no** `AbortSignal` — byte-for-byte the same transport Next.js server-side code uses to reach the backend. So this measures the storefront→backend leg for real.

### MEASURED (config artifacts) — nothing in the repo caps it

| Layer | Finding | Source |
|-------|---------|--------|
| Medusa backend HTTP | No `requestTimeout` in `ConfigModule` types; no timeout assignment anywhere in `@medusajs/framework@2.15.5` `dist/http` or `dist/bundles`; none in `@medusajs/medusa@2.15.5`. Node defaults apply (`server.timeout = 0`, no response-duration cap). | grep of installed packages |
| `medusa-config.ts` | `projectConfig.http` sets CORS and secrets only — no timeout knob. | `apps/backend/medusa-config.ts:109-115` |
| Medusa JS SDK | `AbortSignal` appears **only** on the SSE (`text/event-stream`) path. The normal `fetch` path sets none. | `@medusajs/js-sdk@2.15.5/dist/esm/client.js:207` |
| SDK construction | `new Medusa({ baseUrl, debug, publishableKey })` — no timeout option. | `apps/storefront/src/lib/config.ts` |
| Calculate call | No `AbortSignal`, no timeout; only `next` cache options. | `apps/storefront/src/lib/data/fulfillment.ts:175-230` |
| `next.config.js` | No `proxyTimeout`, no `maxDuration`, no `serverActions` timeout. `output: "standalone"`. | `apps/storefront/next.config.js` |
| Next.js defaults | `config-shared.js:171` → `proxyTimeout: undefined`. `start-server.js` assigns only `keepAliveTimeout` (idle *between* requests) — never `requestTimeout` or `server.timeout`. | `next@15.5.18` dist |
| Build artifact | `.next/server/functions-config-manifest.json` → `{"functions": {}}` — **no route in the storefront declares any per-function config or `maxDuration`.** | build output |
| Deploy target | `apps/storefront/Dockerfile` → `CMD ["node", "apps/storefront/server.js"]`; `apps/backend/Dockerfile` present; **no `vercel.json`, no `.vercel`**. Both ship as long-lived containers, **not** serverless functions — so no platform function-duration cap applies. | Dockerfiles, repo scan |

### INFERRED — what I did NOT measure

Marked explicitly because the design phase must not treat these as observations:

1. **The browser → Next.js server-action leg is UNMEASURED.** `apps/storefront/src/lib/data/fulfillment.ts` is `"use server"`, and `calculatePriceForShippingOption` is called from `checkout-context.tsx` (`"use client"`, line 429). So a third hop exists: browser → Next.js server action → backend. I could not drive it safely: the action IDs in `server-reference-manifest.json` are 45 opaque hashes from a stale production build (the running server is `next dev --turbopack` and mints different IDs), and brute-forcing them would fire real cart/payment-mutating actions. **Inference** (not observation): this leg is plain Node HTTP with no configured cap, per the config table above, so it should behave like the backend leg. It has not been proven.
2. **Production reverse proxy / load balancer idle timeout is UNMEASURED and lives outside this repo.** This is the single biggest residual risk, and the codebase already anticipates it — `service.ts:233-244` documents `ASSUMED_GATEWAY_TIMEOUT_MS` (default 60000ms, overridable via `SKYDROPX_GATEWAY_TIMEOUT_MS`) precisely because "Medusa 2.15 exposes no `projectConfig.http.requestTimeout`". I verified that claim against the installed package and it is **correct**. An 18000ms budget sits well under a 60000ms assumption, but the deploy target's real LB idle timeout must be confirmed before shipping.
3. **I measured DEV servers, not the production containers.** `medusa develop` and `next dev --turbopack`. Dev behaviour can differ from `node server.js` in the standalone image. Nothing observed here proves production safety.
4. **I measured Skydropx SANDBOX** (`sb-pro.skydropx.com`; `provider_setting.mode = 'sandbox'`). Production uses `api-pro.skydropx.com`, whose latency profile may differ in either direction.

### Latent risk surfaced (not part of M0)

`checkout-context.tsx:428-430` fans out with `Promise.allSettled(calculated.map(...))` over every calculated shipping option. Today there is exactly **one** calculated option (`so_01KY8NTFC3JP3XDEXA1SZ8BCA7` "Expres", `skydropx_skydropx`) and one flat option (`so_01KYBF4E55TFK49S2S8TMNDDMR` "Gratis", `manual_manual`), so the fan-out is N=1 and this is harmless *now*. If a second calculated option is ever added, whether Next.js serializes concurrent server actions from one client becomes load-bearing — worst case the shopper waits N × budget. **Flagged as INFERRED risk; not measured.**

---

## M0(c) — Does `Modules.CACHE` resolve from inside a fulfillment provider?

**MEASURED — yes, via the global container.**

`REDIS_URL` **is** set in `apps/backend/.env` (value length 22), so `medusa-config.ts:35-41` registers `@medusajs/medusa/cache-redis`, `event-bus-redis` and `workflow-engine-redis`.

Because `npx medusa exec` hangs in this environment, I instrumented `calculatePrice` with a temporary probe, drove a real `calculate` request through the Store API, and had the probe write its result to a scratch file. Probe reverted afterwards.

```json
{
  "globalContainer_resolve": "RESOLVED",
  "globalContainer_ctor": "RedisCacheService",
  "globalContainer_methods": ["get", "set", "invalidate"],
  "globalContainer_roundtrip": "{\"ok\":true,\"stamp\":424242}",
  "scopedContainer_present": false,
  "ModulesCACHE": "cache"
}
```

Independently verified in Redis:

```
$ docker exec mandi-redis redis-cli --scan --pattern '*m0c*'
medusa:m0c-probe-global
$ docker exec mandi-redis redis-cli GET medusa:m0c-probe-global
{"ok":true,"stamp":424242}
$ docker exec mandi-redis redis-cli TTL medusa:m0c-probe-global
105
```

A full `set` (ttl 120) + `get` roundtrip executed **from inside `SkydropxFulfillmentProviderService.calculatePrice`**, and the value landed in real Redis with a live TTL. This is observation, not inference.

### The important detail for S5

- **`Modules.CACHE === "cache"`** — confirmed at runtime.
- **The provider instance has NO `__container__`** (`scopedContainer_present: false`). A fulfillment provider is **not** given a scoped container. The *only* viable path is the **global** container imported from `@medusajs/framework` — which is exactly what `apps/backend/src/lib/provider-credentials.ts:57-62` already does.
- So the existing precedent generalises from a custom module key (`providerSettings`) to a Medusa **infra** module key (`cache`) **without modification**. The concern that provider container scope might differ is resolved: there is no provider scope to differ.
- The same lazy-resolve discipline still applies: resolve **per operation**, never in the constructor, with `{ allowUnregistered: true }`, and treat `undefined` as "no cache" so an environment without `REDIS_URL` degrades to uncached instead of crashing. Without `REDIS_URL`, Medusa registers the in-memory cache, which is per-process — correct for dev, near-useless across replicas.

---

## Security compliance

No secret material appears in this artifact or in any log. The decrypted `clientId` / `clientSecret` were handled only in memory; only their lengths were ever printed (43 chars each). The KEK was never printed. Bearer tokens were never printed (only length, 488). No credentials were written to any file.

## Repo hygiene

Temporary edits made and reverted:

1. `apps/backend/src/modules/skydropx-fulfillment/client.ts` — `SKYDROPX_QUOTATION_TIMEOUT_MS` and `QUOTE_POLL_INTERVAL_MS` (M0(b)). Reverted with `git checkout --`.
2. `apps/backend/src/modules/skydropx-fulfillment/service.ts` — `__m0cProbe` instrumentation (M0(c)). Reverted with `git checkout --`.

Verified after revert:

```
$ git diff --stat
(empty)
$ git status --porcelain
?? openspec/changes/checkout-shipping-quote-reliability/
?? openspec/changes/skydropx-webhook-and-carrier-selection/
$ grep -c "__m0cProbe" apps/backend/src/modules/skydropx-fulfillment/service.ts
0
```

Constants confirmed back at `8_000` and `1_000`; a post-revert probe reproduced the original 8035ms / HTTP 500 failure. All harness scripts live outside the repo, under the system temp directory.

## What the design phase should carry forward

1. **`8_000` is not a tuning problem, it is a broken value** — it sits below the measured minimum. Any design that keeps synchronous cold quoting must raise it.
2. **Use 18000ms** (1.43× app-level p95, 1.35× max observed). The transport is proven to hold ~52s, so the constant is the only thing to change on the happy path.
3. **The cache (S5) is unblocked** — `container.resolve("cache", { allowUnregistered: true })` from the global container works from inside the provider, backed by Redis, proven end to end.
4. **Two things still need confirming before production**: the deploy target's LB/proxy idle timeout, and whether the production Skydropx host (`api-pro`) matches the sandbox latency profile. Neither can be measured from this environment.
5. **Consider the shopper's wait explicitly.** Median cold quote is ~10.9s app-level. Even a correct budget means a double-digit-second wait on a cache miss; the UX design should account for that rather than assume the fix is invisible.

import { afterEach, describe, expect, it, vi } from "vitest"

import { getBaseURL } from "./env"
import { redirectTargetFrom, toPublicURL } from "./public-redirect"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getBaseURL", () => {
  it("falls back to the production domain when NEXT_PUBLIC_BASE_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "")

    expect(getBaseURL()).toBe("https://www.mandioficial.com")
  })

  it("keeps using NEXT_PUBLIC_BASE_URL when it is set", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://staging.example.com")

    expect(getBaseURL()).toBe("https://staging.example.com")
  })
})

describe("toPublicURL", () => {
  it("resolves a path against the public origin, never the bind address", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://www.mandioficial.com")

    expect(toPublicURL("/mx/checkout?error=payment_failed").toString()).toBe(
      "https://www.mandioficial.com/mx/checkout?error=payment_failed"
    )
  })
})

describe("redirectTargetFrom", () => {
  it("extracts the destination and status of a next/navigation redirect", () => {
    const err = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/mx/order/order_123/confirmed;307;",
    })

    expect(redirectTargetFrom(err)).toEqual({
      destination: "/mx/order/order_123/confirmed",
      status: 307,
    })
  })

  it("returns null for any other error", () => {
    expect(redirectTargetFrom(new Error("card declined"))).toBeNull()
    expect(redirectTargetFrom({ digest: "NEXT_NOT_FOUND" })).toBeNull()
    expect(redirectTargetFrom(undefined)).toBeNull()
  })
})

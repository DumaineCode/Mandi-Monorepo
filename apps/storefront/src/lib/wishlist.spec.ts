import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let storage: Map<string, string>
let browser: EventTarget & {
  localStorage: {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    },
  })
  vi.stubGlobal("window", browser)
})

afterEach(() => vi.unstubAllGlobals())

describe("local wishlist", () => {
  it("persists product IDs across reloads and toggles them off independently", async () => {
    const store = await import("./wishlist")
    store.toggleFavorite("prod_a")
    store.toggleFavorite("prod_b")
    expect(JSON.parse(storage.get(store.WISHLIST_STORAGE_KEY)!)).toEqual([
      "prod_a",
      "prod_b",
    ])
    vi.resetModules()
    const reloaded = await import("./wishlist")
    expect(reloaded.isFavorite("prod_a")).toBe(true)
    reloaded.toggleFavorite("prod_a")
    expect(reloaded.isFavorite("prod_a")).toBe(false)
    expect(reloaded.isFavorite("prod_b")).toBe(true)
    expect(JSON.parse(storage.get(store.WISHLIST_STORAGE_KEY)!)).toEqual([
      "prod_b",
    ])
  })

  it("notifies every same-page consumer and cleans up subscriptions", async () => {
    const store = await import("./wishlist")
    const card = vi.fn(() => store.isFavorite("prod_a"))
    const detail = vi.fn(() => store.isFavorite("prod_a"))
    const unsubscribeCard = store.subscribeToWishlist(card)
    const unsubscribeDetail = store.subscribeToWishlist(detail)
    store.toggleFavorite("prod_a")
    expect(card).toHaveLastReturnedWith(true)
    expect(detail).toHaveLastReturnedWith(true)
    unsubscribeCard()
    store.toggleFavorite("prod_a")
    expect(card).toHaveBeenCalledTimes(1)
    expect(detail).toHaveLastReturnedWith(false)
    unsubscribeDetail()
  })

  it.each(["{broken", "null", "{}", "42", '"prod_a"'])(
    "recovers from invalid storage: %s",
    async (value) => {
      const store = await import("./wishlist")
      storage.set(store.WISHLIST_STORAGE_KEY, value)
      expect(store.isFavorite("prod_a")).toBe(false)
      store.toggleFavorite("prod_a")
      expect(store.isFavorite("prod_a")).toBe(true)
    }
  )

  it("filters invalid IDs and deduplicates persisted IDs", async () => {
    const store = await import("./wishlist")
    storage.set(
      store.WISHLIST_STORAGE_KEY,
      '["prod_a","prod_a",null,12,""," "]'
    )
    expect(store.isFavorite("prod_a")).toBe(true)
    store.toggleFavorite("prod_b")
    expect(JSON.parse(storage.get(store.WISHLIST_STORAGE_KEY)!)).toEqual([
      "prod_a",
      "prod_b",
    ])
  })

  it.each(["read", "write", "access"])(
    "keeps a working in-memory demo when storage fails on %s",
    async (failure) => {
      const store = await import("./wishlist")
      const fail = () => {
        throw new Error("Storage unavailable")
      }
      if (failure === "read")
        browser.localStorage.getItem.mockImplementation(fail)
      if (failure === "write")
        browser.localStorage.setItem.mockImplementation(fail)
      if (failure === "access")
        Object.defineProperty(browser, "localStorage", { get: fail })
      const listener = vi.fn()
      const unsubscribe = store.subscribeToWishlist(listener)
      store.toggleFavorite("prod_a")
      expect(store.isFavorite("prod_a")).toBe(true)
      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
      const cleanup = store.subscribeToWishlist(listener)
      expect(store.isFavorite("prod_a")).toBe(true)
      store.toggleFavorite("prod_a")
      expect(store.isFavorite("prod_a")).toBe(false)
      cleanup()
    }
  )

  it("synchronizes other-tab changes and storage clearing, ignoring unrelated events", async () => {
    const store = await import("./wishlist")
    const listener = vi.fn()
    const unsubscribe = store.subscribeToWishlist(listener)
    const dispatch = (
      key: string | null,
      storageArea = browser.localStorage
    ) => {
      browser.dispatchEvent(
        Object.assign(new Event("storage"), { key, storageArea })
      )
    }
    storage.set(store.WISHLIST_STORAGE_KEY, '["prod_a"]')
    dispatch("other-key")
    expect(listener).not.toHaveBeenCalled()
    dispatch(store.WISHLIST_STORAGE_KEY)
    expect(store.isFavorite("prod_a")).toBe(true)
    storage.clear()
    dispatch(null)
    expect(store.isFavorite("prod_a")).toBe(false)
    unsubscribe()
    dispatch(store.WISHLIST_STORAGE_KEY)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("does not access browser storage during server rendering", async () => {
    vi.stubGlobal("window", undefined)
    const store = await import("./wishlist")
    expect(store.isFavorite("prod_a")).toBe(false)
    expect(() => store.toggleFavorite("prod_a")).not.toThrow()
  })
})

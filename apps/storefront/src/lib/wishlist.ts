export const WISHLIST_STORAGE_KEY = "mandi:wishlist:v1"

let productIds: Set<string> | undefined
let memoryOnly = false
const listeners = new Set<() => void>()

function readStorage(): Set<string> | undefined {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(WISHLIST_STORAGE_KEY)
  } catch {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(raw ?? "[]")
    return new Set(
      Array.isArray(value)
        ? value.filter(
            (id): id is string => typeof id === "string" && !!id.trim()
          )
        : []
    )
  } catch {
    return new Set()
  }
}

export function isFavorite(productId: string): boolean {
  if (typeof window === "undefined") return false
  productIds ??= readStorage() ?? new Set()
  return productIds.has(productId)
}

function notify() {
  listeners.forEach((listener) => listener())
}

function onStorage(event: StorageEvent) {
  try {
    if (event.storageArea !== window.localStorage) return
  } catch {
    return
  }
  if (event.key !== null && event.key !== WISHLIST_STORAGE_KEY) return
  productIds = readStorage() ?? productIds
  memoryOnly = false
  notify()
}

export function subscribeToWishlist(listener: () => void) {
  if (listeners.size === 0) {
    // Refresh after navigating through pages without hearts, unless a failed
    // write left newer demo state in memory than the stored value.
    if (!memoryOnly) productIds = readStorage() ?? productIds
    window.addEventListener("storage", onStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener("storage", onStorage)
  }
}

export function toggleFavorite(productId: string) {
  if (typeof window === "undefined" || !productId.trim()) return
  const saved = isFavorite(productId)
  if (saved) productIds!.delete(productId)
  else productIds!.add(productId)

  try {
    window.localStorage.setItem(
      WISHLIST_STORAGE_KEY,
      JSON.stringify(Array.from(productIds!))
    )
    memoryOnly = false
  } catch {
    // Blocked storage or a full quota must not break the visual demo.
    memoryOnly = true
  }
  notify()
}

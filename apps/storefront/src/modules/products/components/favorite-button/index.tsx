"use client"

import { useSyncExternalStore } from "react"
import { isFavorite, subscribeToWishlist, toggleFavorite } from "@lib/wishlist"

export default function FavoriteButton({
  productId,
  title,
  showLabel = false,
}: {
  productId: string
  title: string
  showLabel?: boolean
}) {
  const saved = useSyncExternalStore(
    subscribeToWishlist,
    () => isFavorite(productId),
    () => false
  )
  const label = saved ? "Quitar de favoritos" : "Agregar a favoritos"

  return (
    <button
      type="button"
      aria-label={`${label}: ${title}`}
      aria-pressed={saved}
      title={label}
      onClick={() => toggleFavorite(productId)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-paper p-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
      {showLabel && <span>{label}</span>}
    </button>
  )
}

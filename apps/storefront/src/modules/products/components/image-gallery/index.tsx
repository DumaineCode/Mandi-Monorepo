"use client"

import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"
import Image from "next/image"
import React, { useState } from "react"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
}

const ImageGallery = ({ images }: ImageGalleryProps) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const validImages = images.filter((image) => !!image.url)

  if (validImages.length === 0) {
    return (
      <div
        aria-hidden
        className="aspect-square w-full max-w-[480px] rounded-[20px]"
        style={{
          background:
            "repeating-linear-gradient(135deg,#ECE4D5 0,#ECE4D5 13px,#F5F0E5 13px,#F5F0E5 26px)",
        }}
      />
    )
  }

  const safeIndex = Math.min(activeIndex, validImages.length - 1)
  const displayIndex =
    hoverIndex !== null && hoverIndex < validImages.length
      ? hoverIndex
      : safeIndex

  return (
    <div
      className={clx(
        "grid w-full max-w-[580px] items-start gap-2 small:gap-3",
        validImages.length > 1
          ? "grid-cols-1 small:grid-cols-[88px_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
    >
      {/* Keep the full image visible in a compact square stage. */}
      <div
        className={clx(
          "relative row-start-1 aspect-square w-full max-w-[480px] overflow-hidden rounded-[20px] bg-cream",
          validImages.length > 1 && "small:col-start-2"
        )}
      >
        {/* All images stay mounted so switching is instant (no re-download). */}
        {validImages.map((image, index) => (
          <Image
            key={image.id}
            src={image.url as string}
            priority={index === 0}
            loading={index === 0 ? undefined : "eager"}
            className={clx(
              "absolute inset-0",
              index === displayIndex ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            aria-hidden={index !== displayIndex}
            alt={`Imagen del producto ${index + 1}`}
            fill
            sizes="(min-width: 512px) 480px, 100vw"
            style={{ objectFit: "contain" }}
          />
        ))}
      </div>

      {/* Thumbnails (only when more than one image) */}
      {validImages.length > 1 && (
        <div className="relative col-start-1 row-start-2 min-h-0 min-w-0 max-w-[480px] self-stretch small:row-start-1">
          <div
            className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory p-1 small:absolute small:inset-0 small:flex-col small:gap-3 small:overflow-x-hidden small:overflow-y-auto small:overscroll-contain small:snap-none"
            role="group"
            aria-label="Miniaturas"
            onMouseLeave={() => setHoverIndex(null)}
          >
            {validImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                onMouseEnter={() => setHoverIndex(index)}
                aria-label={`Ver imagen ${index + 1}`}
                aria-current={index === safeIndex}
                className={clx(
                  "relative h-12 w-12 shrink-0 snap-start overflow-hidden rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none small:h-16 small:w-16",
                  index === safeIndex ? "border-ink" : "border-line hover:border-ink-muted"
                )}
              >
                <Image
                  src={image.url as string}
                  loading="eager"
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 64px, 48px"
                  style={{ objectFit: "contain" }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ImageGallery

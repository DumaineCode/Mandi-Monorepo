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
  const activeImage = validImages[safeIndex]

  return (
    <div
      className={clx(
        "grid w-full max-w-[580px] items-start gap-2 small:gap-3",
        validImages.length > 1
          ? "grid-cols-[72px_minmax(0,1fr)] small:grid-cols-[88px_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
    >
      {/* Keep the full image visible in a compact square stage. */}
      <div
        className={clx(
          "relative row-start-1 aspect-square w-full max-w-[480px] overflow-hidden rounded-[20px] bg-cream",
          validImages.length > 1 && "col-start-2"
        )}
      >
        <Image
          key={activeImage.id}
          src={activeImage.url as string}
          priority
          className="absolute inset-0"
          alt={`Imagen del producto ${safeIndex + 1}`}
          fill
          sizes="(min-width: 512px) 480px, 100vw"
          style={{ objectFit: "contain" }}
        />
      </div>

      {/* Thumbnails (only when more than one image) */}
      {validImages.length > 1 && (
        <div className="relative col-start-1 row-start-1 min-h-0 self-stretch">
          <div
            className="absolute inset-0 flex flex-col gap-2 overflow-y-auto overscroll-contain p-1 small:gap-3"
            role="group"
            aria-label="Miniaturas"
          >
            {validImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Ver imagen ${index + 1}`}
                aria-current={index === safeIndex}
                className={clx(
                  "relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none small:h-16 small:w-16",
                  index === safeIndex ? "border-ink" : "border-line hover:border-ink-muted"
                )}
              >
                <Image
                  src={image.url as string}
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

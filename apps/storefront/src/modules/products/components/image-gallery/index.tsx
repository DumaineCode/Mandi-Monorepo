"use client"

import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"
import Image from "next/image"
import { useState } from "react"

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
        className="h-[420px] w-full rounded-[20px]"
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
    <div className="flex flex-col gap-y-3">
      {/* Main image */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px] bg-cream small:aspect-auto small:h-[420px]">
        <Image
          key={activeImage.id}
          src={activeImage.url as string}
          priority
          className="absolute inset-0"
          alt={`Imagen del producto ${safeIndex + 1}`}
          fill
          sizes="(max-width: 1024px) 100vw, 560px"
          style={{ objectFit: "cover" }}
        />
      </div>

      {/* Thumbnails (only when more than one image) */}
      {validImages.length > 1 && (
        <div className="flex flex-wrap gap-3" role="group" aria-label="Miniaturas">
          {validImages.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Ver imagen ${index + 1}`}
              aria-current={index === safeIndex}
              className={clx(
                "relative h-[84px] w-[84px] overflow-hidden rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none",
                index === safeIndex ? "border-ink" : "border-line hover:border-ink-muted"
              )}
            >
              <Image
                src={image.url as string}
                alt=""
                fill
                sizes="84px"
                style={{ objectFit: "cover" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageGallery

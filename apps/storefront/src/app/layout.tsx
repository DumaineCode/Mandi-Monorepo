import { getBaseURL } from "@lib/util/env"
import { STORE_LOCALE } from "@lib/util/store-locale"
import { Metadata } from "next"
import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  Space_Mono,
} from "next/font/google"
import localFont from "next/font/local"
import "styles/globals.css"

// Brand display face. Self-hosted because it is not on Google Fonts, and
// vendored as woff2: `next/font/local` serves whatever it is given without
// converting, and woff2 is ~57% smaller than the original TTFs (42KB -> 18KB
// for Black, the only weight anything downloads today).
//
// Only Black (900) has a caller right now — the hero headline. Medium and Bold
// are registered deliberately for future use and cost nothing until then: a
// browser downloads a @font-face source only once a rule actually asks for that
// weight, so they are declarations, not payload.
const blusans = localFont({
  src: [
    {
      path: "../fonts/blusans/BluSans-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/blusans/BluSans-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../fonts/blusans/BluSans-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-blusans",
  display: "swap",
})

const bricolage = Bricolage_Grotesque({
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
})

const hanken = Hanken_Grotesk({
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
})

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  variable: "--font-space-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html
      lang={STORE_LOCALE}
      data-mode="light"
      className={`${bricolage.variable} ${hanken.variable} ${spaceMono.variable} ${blusans.variable}`}
    >
      {/*
          The cream surface and its brand watermark live on <body> so every route
          inherits them. The watermark is a fixed `z-index: -1` pseudo-element, so
          any route that repaints an opaque background hides it — a route that
          wants a clean surface opts out that way, on purpose.
        */}
      <body className="brand-watermark bg-cream font-hanken text-ink">
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}

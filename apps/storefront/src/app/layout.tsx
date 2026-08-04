import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  Space_Mono,
} from "next/font/google"
import "styles/globals.css"

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
      lang="en"
      data-mode="light"
      className={`${bricolage.variable} ${hanken.variable} ${spaceMono.variable}`}
    >
      {/*
          The cream surface and its brand watermark live on <body> so every route
          inherits them; surfaces that must stay clean (checkout) just paint their
          own background on top.
        */}
        <body className="brand-watermark bg-cream font-hanken text-ink">
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}

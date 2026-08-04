import { Metadata } from "next"

import AnnouncementTicker from "@modules/home/components/announcement-ticker"
import BestSellers from "@modules/home/components/best-sellers"
import Categories from "@modules/home/components/categories"
import FeaturedFlavor from "@modules/home/components/featured-flavor"
import FlavorMarquee from "@modules/home/components/flavor-marquee"
import Hero from "@modules/home/components/hero"
import Newsletter from "@modules/home/components/newsletter"
import ReviewsCarousel from "@modules/home/components/reviews-carousel"
import StatsTestimonial from "@modules/home/components/stats-testimonial"
import TrustBadges from "@modules/home/components/trust-badges"
import WholesaleBand from "@modules/home/components/wholesale-band"

export const metadata: Metadata = {
  title: "Mando Oficial — Polvos, jarabes y más para tu cafetería",
  description:
    "Tienda de insumos para frappés y bebidas: polvos, jarabes, botes y popotes. Envío nacional en 24 h.",
}

// Home — editorial redesign (`home-redesign-editorial`).
// This batch ships the STATIC sections. Data-driven and layout-chrome sections
// are stubbed below and land in later parts; CTAs without a real destination
// point at `/store` for now (see each component).
export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    // Surface colour comes from <body>; repainting bg-cream here would cover the
    // brand watermark rendered behind the page content.
    <div className="min-h-screen font-hanken text-ink">
      <AnnouncementTicker />
      <Hero />
      <FlavorMarquee />

      <Categories />
      <FeaturedFlavor countryCode={countryCode} />
      <BestSellers countryCode={countryCode} />

      <TrustBadges />
      <WholesaleBand />
      <StatsTestimonial />
      <ReviewsCarousel />
      <Newsletter />

      {/* TODO: Footer (pending header/footer decision) */}
    </div>
  )
}

import type { ReactNode } from "react"

import { LEGAL_COMPANY } from "@modules/legal/company"

type LegalPageProps = {
  eyebrow: string
  title: string
  intro?: ReactNode
  children: ReactNode
}

/**
 * Shared shell for long-form legal documents. Typography is tuned for reading
 * (narrow measure, generous line height) rather than for marketing.
 */
export const LegalPage = ({ eyebrow, title, intro, children }: LegalPageProps) => (
  <div className="bg-paper font-hanken text-ink">
    <div className="content-container max-w-3xl py-14 small:py-20">
      <p className="mb-4 font-mono text-xs uppercase tracking-widest text-ink-muted">
        {eyebrow}
      </p>
      <h1 className="font-blusans text-4xl leading-[1.1] small:text-5xl">
        {title}
      </h1>
      <p className="mt-4 text-sm text-ink-muted">
        Última actualización: {LEGAL_COMPANY.LAST_UPDATED}
      </p>
      {intro && (
        <div className="mt-8 space-y-4 text-base leading-relaxed">{intro}</div>
      )}
      <div className="mt-10 space-y-10">{children}</div>
    </div>
  </div>
)

type LegalSectionProps = {
  number: number
  title: string
  children: ReactNode
}

export const LegalSection = ({ number, title, children }: LegalSectionProps) => (
  <section aria-labelledby={`legal-section-${number}`}>
    <h2
      id={`legal-section-${number}`}
      className="mb-4 font-blusans text-2xl leading-tight"
    >
      {number}. {title}
    </h2>
    <div className="space-y-4 text-base leading-relaxed [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
      {children}
    </div>
  </section>
)

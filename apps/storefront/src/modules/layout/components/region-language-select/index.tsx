"use client"

import useToggleState from "@lib/hooks/use-toggle-state"
import { ArrowRightMini } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"

import { Locale } from "@lib/data/locales"
import CountrySelect from "../country-select"
import LanguageSelect from "../language-select"

type RegionLanguageSelectProps = {
  regions: HttpTypes.StoreRegion[] | null
  locales: Locale[] | null
  currentLocale: string | null
}

const RegionLanguageSelect = ({
  regions,
  locales,
  currentLocale,
}: RegionLanguageSelectProps) => {
  const countryToggleState = useToggleState()
  const languageToggleState = useToggleState()

  return (
    <div className="flex flex-col gap-y-3 xsmall:flex-row xsmall:gap-x-8 xsmall:items-center text-ui-fg-subtle">
      {!!locales?.length && (
        <div
          className="flex items-center gap-x-2"
          onMouseEnter={languageToggleState.open}
          onMouseLeave={languageToggleState.close}
        >
          <LanguageSelect
            toggleState={languageToggleState}
            locales={locales}
            currentLocale={currentLocale}
          />
          <ArrowRightMini
            className={clx(
              "transition-transform duration-150",
              languageToggleState.state ? "-rotate-90" : ""
            )}
          />
        </div>
      )}
      {regions && (
        <div
          className="flex items-center gap-x-2"
          onMouseEnter={countryToggleState.open}
          onMouseLeave={countryToggleState.close}
        >
          <CountrySelect toggleState={countryToggleState} regions={regions} />
          <ArrowRightMini
            className={clx(
              "transition-transform duration-150",
              countryToggleState.state ? "-rotate-90" : ""
            )}
          />
        </div>
      )}
    </div>
  )
}

export default RegionLanguageSelect

export const STORE_LOCALE = "es-MX"
export const STORE_TIME_ZONE = "America/Mexico_City"

const dateFormatter = new Intl.DateTimeFormat(STORE_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: STORE_TIME_ZONE,
})

const dateTimeFormatter = new Intl.DateTimeFormat(STORE_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: STORE_TIME_ZONE,
})

const countryNames = new Intl.DisplayNames([STORE_LOCALE], { type: "region" })

export const formatStoreDate = (value: string | number | Date) =>
  dateFormatter.format(new Date(value))

export const formatStoreDateTime = (value: string | number | Date) =>
  dateTimeFormatter.format(new Date(value))

export const formatCountryName = (
  countryCode?: string | null,
  fallback = ""
) => {
  const code = countryCode?.trim().toUpperCase()

  if (!code || !/^[A-Z]{2}$/.test(code)) {
    return fallback
  }

  return countryNames.of(code) || fallback || code
}

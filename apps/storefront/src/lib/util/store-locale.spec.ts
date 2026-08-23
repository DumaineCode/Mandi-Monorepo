import { describe, expect, it } from "vitest"

import {
  STORE_LOCALE,
  STORE_TIME_ZONE,
  formatCountryName,
  formatStoreDate,
  formatStoreDateTime,
} from "./store-locale"

describe("store locale formatting", () => {
  it("uses the Mexican Spanish locale and Mexico City time zone", () => {
    expect(STORE_LOCALE).toBe("es-MX")
    expect(STORE_TIME_ZONE).toBe("America/Mexico_City")
  })

  it("keeps order dates stable at the UTC day boundary", () => {
    expect(formatStoreDate("2026-08-22T00:30:00.000Z")).toBe("21 ago 2026")
  })

  it("includes the local time when formatting payment timestamps", () => {
    expect(formatStoreDateTime("2026-08-22T00:30:00.000Z")).toMatch(
      /^21 ago 2026, 6:30 p\.m\.$/
    )
  })

  it("localizes valid country codes and safely falls back for invalid values", () => {
    expect(formatCountryName("mx")).toBe("México")
    expect(formatCountryName(undefined, "País desconocido")).toBe(
      "País desconocido"
    )
    expect(formatCountryName("invalid", "País desconocido")).toBe(
      "País desconocido"
    )
  })
})

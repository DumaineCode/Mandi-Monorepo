/**
 * makeStockLocationSource — lazy origin-address resolution seam.
 *
 * Mirrors `makeDbCredentialSource` (design F1/F2): the STOCK_LOCATION module is
 * resolved from the GLOBAL framework container lazily, PER CALL — never in a
 * constructor, because module load order at boot is not guaranteed. Every
 * failure resolves to `null` (fail-safe); the seam NEVER throws.
 */
import { container } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import {
  makeStockLocationSource,
  STOCK_LOCATION_NOT_FOUND,
} from "../stock-location-address"

jest.mock("@medusajs/framework", () => ({
  container: { resolve: jest.fn() },
}))

const resolveMock = container.resolve as jest.Mock

const address = {
  address_1: "Valle del Carmen 184",
  address_2: "Valle de Aragón",
  city: "Ciudad Nezahualcoyotl",
  province: "México",
  postal_code: "57100",
  country_code: "mx",
  company: "",
  phone: "",
}

describe("makeStockLocationSource", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns the stock location name + address with the address relation requested", async () => {
    const retrieveStockLocation = jest
      .fn()
      .mockResolvedValue({ id: "sloc_1", name: "CDMX Warehouse", address })
    resolveMock.mockReturnValue({ retrieveStockLocation })

    const source = makeStockLocationSource()

    await expect(source("sloc_1")).resolves.toEqual({
      name: "CDMX Warehouse",
      address,
    })
    expect(retrieveStockLocation).toHaveBeenCalledWith("sloc_1", {
      relations: ["address"],
    })
    expect(resolveMock).toHaveBeenCalledWith(
      "stock_location",
      expect.objectContaining({ allowUnregistered: true })
    )
  })

  it("returns null when the stock location module is unresolved (undefined key, F2)", async () => {
    resolveMock.mockReturnValue(undefined)

    await expect(makeStockLocationSource()("sloc_1")).resolves.toBeNull()
  })

  it("returns null when container resolution throws (fail-safe, never throws)", async () => {
    resolveMock.mockImplementation(() => {
      throw new Error("AwilixResolutionError")
    })

    await expect(makeStockLocationSource()("sloc_1")).resolves.toBeNull()
  })

  it("returns null when the retrieve rejects for a non-NOT_FOUND reason (DB down)", async () => {
    resolveMock.mockReturnValue({
      retrieveStockLocation: jest
        .fn()
        .mockRejectedValue(new Error("connection terminated")),
    })

    await expect(makeStockLocationSource()("sloc_1")).resolves.toBeNull()
  })

  /**
   * NEW-2: a deleted or stale `location_id` is a DATA condition, not an
   * infrastructure incident. The seam must keep it distinct from `null` so the
   * caller can raise a 400 that says "gone" instead of a 500 that says "retry".
   */
  describe("unknown location id vs failed read (NEW-2)", () => {
    it("returns the NOT_FOUND sentinel when the module rejects with MedusaError NOT_FOUND", async () => {
      resolveMock.mockReturnValue({
        retrieveStockLocation: jest
          .fn()
          .mockRejectedValue(
            new MedusaError(
              MedusaError.Types.NOT_FOUND,
              "StockLocation with id: sloc_gone was not found"
            )
          ),
      })

      await expect(makeStockLocationSource()("sloc_gone")).resolves.toBe(
        STOCK_LOCATION_NOT_FOUND
      )
    })

    it("classifies a NOT_FOUND rejection structurally (cross-realm / plain object)", async () => {
      resolveMock.mockReturnValue({
        retrieveStockLocation: jest
          .fn()
          .mockRejectedValue({ type: "not_found", message: "gone" }),
      })

      await expect(makeStockLocationSource()("sloc_gone")).resolves.toBe(
        STOCK_LOCATION_NOT_FOUND
      )
    })

    it("keeps 'module unavailable' as a failed read, NOT as not-found", async () => {
      resolveMock.mockReturnValue(undefined)

      await expect(makeStockLocationSource()("sloc_1")).resolves.toBeNull()
    })

    it("keeps a timeout as a failed read, NOT as not-found", async () => {
      resolveMock.mockReturnValue({
        retrieveStockLocation: jest.fn(() => new Promise(() => {})),
      })

      await expect(
        makeStockLocationSource({ timeoutMs: 10 })("sloc_1")
      ).resolves.toBeNull()
    })
  })

  it("returns a null address when the location has no address relation", async () => {
    resolveMock.mockReturnValue({
      retrieveStockLocation: jest
        .fn()
        .mockResolvedValue({ id: "sloc_1", name: "No address" }),
    })

    await expect(makeStockLocationSource()("sloc_1")).resolves.toEqual({
      name: "No address",
      address: null,
    })
  })

  it("returns null without a location id", async () => {
    await expect(makeStockLocationSource()("")).resolves.toBeNull()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it("resolves the container on EVERY call, never caching the service", async () => {
    resolveMock.mockReturnValue(undefined)
    const source = makeStockLocationSource()

    await source("sloc_1")
    await source("sloc_1")

    expect(resolveMock).toHaveBeenCalledTimes(2)
  })

  describe("resolution timeout (bounded, fail-safe)", () => {
    it("fails safe to null when the read exceeds the timeout", async () => {
      resolveMock.mockReturnValue({
        // Never resolves — simulates a slow-but-up DB.
        retrieveStockLocation: jest.fn(() => new Promise(() => {})),
      })

      await expect(
        makeStockLocationSource({ timeoutMs: 10 })("sloc_1")
      ).resolves.toBeNull()
    })

    it("logs a sustained timeout at most once per window (rate-limited)", async () => {
      const error = jest.fn()
      let clock = 0
      resolveMock.mockReturnValue({
        retrieveStockLocation: jest.fn(() => new Promise(() => {})),
      })
      const source = makeStockLocationSource({
        timeoutMs: 5,
        logger: { error },
        now: () => (clock += 1),
      })

      await source("sloc_1")
      await source("sloc_1")

      expect(error).toHaveBeenCalledTimes(1)
    })
  })
})

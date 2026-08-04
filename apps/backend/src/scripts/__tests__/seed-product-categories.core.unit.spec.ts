import { existsSync } from "fs"
import { join } from "path"

import {
  CATEGORY_SEEDS,
  SEED_KEY,
  type ExistingCategory,
  planCategorySeed,
} from "../seed-product-categories.core"

/**
 * These tests exist because of a real incident. An earlier revision matched
 * categories by `handle`. Between reading DB state and running, an admin renamed
 * a category in Admin; the lookup missed and the seed created a DUPLICATE root
 * category. Every "identity" case below encodes a way that can happen again.
 */

const existing = (
  overrides: Partial<ExistingCategory> & Pick<ExistingCategory, "id">
): ExistingCategory => ({
  name: "Cappuccinis",
  handle: "cappuccinis",
  parent_category_id: null,
  is_active: true,
  metadata: null,
  ...overrides,
})

const seedFor = (handle: string) => {
  const seed = CATEGORY_SEEDS.find((s) => s.handle === handle)
  if (!seed) {
    throw new Error(`No seed fixture for ${handle}`)
  }
  return seed
}

describe("planCategorySeed — identity", () => {
  it("matches on the immutable seed key, ignoring a renamed handle", () => {
    const seed = seedFor("cappuccinis")
    const plan = planCategorySeed(
      [
        existing({
          id: "pcat_1",
          handle: "cappuccinis-renombrada",
          name: "Otro nombre",
          metadata: { [SEED_KEY]: seed.key, image_url: seed.image_url },
        }),
      ],
      [seed]
    )

    expect(plan.toCreate).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(0)
  })

  it("adopts a pre-existing category by handle and stamps the seed key on it", () => {
    const seed = seedFor("cappuccinis")
    const plan = planCategorySeed([existing({ id: "pcat_1" })], [seed])

    expect(plan.toCreate).toHaveLength(0)
    expect(plan.toUpdate).toEqual([
      {
        id: "pcat_1",
        handle: "cappuccinis",
        metadataPatch: { [SEED_KEY]: seed.key, image_url: seed.image_url },
      },
    ])
  })

  /**
   * The exact incident: same category, handle edited in Admin, seed key not yet
   * stamped. Creating would duplicate it. The seed must refuse and say so rather
   * than guess, because "renamed" and "genuinely absent" are indistinguishable
   * from data alone.
   */
  it("refuses to create when a same-named root exists under a different handle", () => {
    const seed = seedFor("frappuccinis")
    const plan = planCategorySeed(
      [existing({ id: "pcat_1", name: "Frappuccinis", handle: "frappuccins" })],
      [seed]
    )

    expect(plan.toCreate).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toContain("frappuccins")
    expect(plan.conflicts[0]).toContain("frappuccinis")
  })

  it("compares names case- and accent-insensitively", () => {
    const seed = seedFor("presentacion-1-5-kg")
    const plan = planCategorySeed(
      [existing({ id: "pcat_1", name: "PRESENTACION 1.5 KG", handle: "otro" })],
      [seed]
    )

    expect(plan.conflicts).toHaveLength(1)
  })

  it("creates when nothing matches by key, handle or name", () => {
    const seed = seedFor("cappuccinis")
    const plan = planCategorySeed(
      [existing({ id: "pcat_1", name: "Envases", handle: "envases" })],
      [seed]
    )

    expect(plan.toCreate).toEqual([seed])
    expect(plan.conflicts).toHaveLength(0)
  })

  /**
   * Handles are globally unique in Medusa, so a subcategory can legally take the
   * handle a root seed expects. Writing the cover onto it would apply it to a
   * node the root-only home grid never renders.
   */
  it("ignores non-root categories entirely", () => {
    const seed = seedFor("cappuccinis")
    const plan = planCategorySeed(
      [existing({ id: "pcat_child", parent_category_id: "pcat_parent" })],
      [seed]
    )

    expect(plan.toCreate).toEqual([seed])
    expect(plan.toUpdate).toHaveLength(0)
  })
})

describe("planCategorySeed — covers", () => {
  const seed = seedFor("cappuccinis")
  const keyed = (metadata: Record<string, unknown>) =>
    existing({ id: "pcat_1", metadata: { [SEED_KEY]: seed.key, ...metadata } })

  it.each([
    ["missing", {}],
    ["empty string", { image_url: "" }],
    ["whitespace", { image_url: "   " }],
    ["non-string", { image_url: 42 }],
  ])("backfills a cover that is %s", (_label, metadata) => {
    const plan = planCategorySeed([keyed(metadata)], [seed])

    expect(plan.toUpdate[0]?.metadataPatch).toEqual({ image_url: seed.image_url })
  })

  /**
   * A cover reassigned from Admin is a deliberate human decision and must
   * survive a re-run, otherwise the seed silently reverts it.
   */
  it("never overwrites a cover that is already set", () => {
    const plan = planCategorySeed([keyed({ image_url: "/custom.webp" })], [seed])

    expect(plan.toUpdate).toHaveLength(0)
  })

  it("emits no rank — ordering belongs to whoever arranged it in Admin", () => {
    const plan = planCategorySeed([], [seed])

    expect(plan.toCreate[0]).not.toHaveProperty("rank")
  })
})

describe("planCategorySeed — reporting", () => {
  it("warns about a deactivated category instead of silently reporting success", () => {
    const seed = seedFor("cappuccinis")
    const plan = planCategorySeed(
      [
        existing({
          id: "pcat_1",
          is_active: false,
          metadata: { [SEED_KEY]: seed.key, image_url: seed.image_url },
        }),
      ],
      [seed]
    )

    expect(plan.warnings.join(" ")).toContain("cappuccinis")
  })

  it("is a no-op on a fully seeded store", () => {
    const all = CATEGORY_SEEDS.map((seed, i) =>
      existing({
        id: `pcat_${i}`,
        name: seed.name,
        handle: seed.handle,
        metadata: { [SEED_KEY]: seed.key, image_url: seed.image_url },
      })
    )
    const plan = planCategorySeed(all, CATEGORY_SEEDS)

    expect(plan).toMatchObject({ toCreate: [], toUpdate: [], conflicts: [] })
  })
})

/**
 * A typo in a cover path writes a dead URL into the database, logs success, and
 * only surfaces as a broken image in production. Checking it here costs nothing
 * and needs no database.
 */
describe("CATEGORY_SEEDS", () => {
  const publicDir = join(
    __dirname,
    "../../../../storefront/public"
  )

  it.each(CATEGORY_SEEDS.map((s) => [s.handle, s.image_url]))(
    "%s points at a cover that exists on disk",
    (_handle, imageUrl) => {
      expect(existsSync(join(publicDir, imageUrl))).toBe(true)
    }
  )

  it("has unique keys and handles", () => {
    expect(new Set(CATEGORY_SEEDS.map((s) => s.key)).size).toBe(
      CATEGORY_SEEDS.length
    )
    expect(new Set(CATEGORY_SEEDS.map((s) => s.handle)).size).toBe(
      CATEGORY_SEEDS.length
    )
  })
})

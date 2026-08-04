/**
 * Pure planning core for the product-category seed.
 *
 * Zero framework/container imports so it runs under `pnpm test:unit`. The thin
 * `medusa exec` wrapper (`seed-product-categories.ts`) resolves the container's
 * query + workflows and executes the plan this module produces.
 *
 * Why a plan instead of doing the work inline: identity here is genuinely hard.
 * Handles are user-editable in Admin, and an earlier revision that matched on
 * `handle` created a duplicate root category when an admin renamed one between
 * the read and the write. Deciding *what* to do is the risky part, so it lives
 * where it can be tested without a database.
 *
 * Identity resolution, in order:
 *   1. `metadata.__seed_key` — written by this seed, invisible to Admin's handle
 *      and name fields, survives every rename.
 *   2. `handle` — adoption path for categories that predate the seed key. The
 *      match stamps the key so step 1 owns it from then on.
 *   3. normalised `name` — NOT a match. A same-named root under a different
 *      handle is reported as a conflict, because "renamed" and "genuinely
 *      absent" are indistinguishable from data and guessing is what caused the
 *      duplicate in the first place.
 */

/** Metadata key holding the stable seed identity. Never shown to merchants. */
export const SEED_KEY = "__seed_key"

export type SeedCategory = {
  /** Immutable identity. Must never change once a store has been seeded. */
  key: string
  name: string
  handle: string
  /** Storefront-root-relative path under apps/storefront/public. */
  image_url: string
}

export type ExistingCategory = {
  id: string
  name: string
  handle: string
  parent_category_id?: string | null
  is_active?: boolean
  metadata?: Record<string, unknown> | null
}

export type PlannedUpdate = {
  id: string
  /** For logging only. */
  handle: string
  /** Keys to merge into the existing metadata. Never a whole-object replace. */
  metadataPatch: Record<string, string>
}

export type SeedPlan = {
  toCreate: SeedCategory[]
  toUpdate: PlannedUpdate[]
  /** Non-empty means: change nothing, tell a human. */
  conflicts: string[]
  warnings: string[]
}

/**
 * The nine top-level storefront categories.
 *
 * `rank` is deliberately absent. Medusa assigns it on create, and supplying a
 * lower value triggers `rerankSiblingsAfterCreation`, which rewrites the rank of
 * every existing sibling — the seed would silently reorder categories a merchant
 * arranged by hand.
 */
export const CATEGORY_SEEDS: SeedCategory[] = [
  {
    key: "frappuccinis",
    name: "Frappuccinis",
    handle: "frappuccinis",
    image_url: "/categories/frappuccinis.webp",
  },
  {
    key: "sodas-italianas",
    name: "Sodas Italianas",
    handle: "sodas-italianas",
    image_url: "/categories/sodas-italianas.webp",
  },
  {
    key: "envases",
    name: "Envases",
    handle: "envases",
    image_url: "/categories/envases.webp",
  },
  {
    key: "ice-frutal",
    name: "Ice Frutal",
    handle: "ice-frutal",
    image_url: "/categories/ice-frutal.webp",
  },
  {
    key: "bases-gourmet",
    name: "Bases Gourmet",
    handle: "bases-gourmet",
    image_url: "/categories/bases-gourmet.webp",
  },
  {
    key: "cappuccinis",
    name: "Cappuccinis",
    handle: "cappuccinis",
    image_url: "/categories/cappuccinis.webp",
  },
  {
    key: "master-latte",
    name: "Master Latte",
    handle: "master-latte",
    image_url: "/categories/master-latte.webp",
  },
  {
    key: "presentacion-1-5-kg",
    name: "Presentación 1.5 KG",
    handle: "presentacion-1-5-kg",
    image_url: "/categories/presentacion-1-5-kg.webp",
  },
  {
    key: "tisanas-frutales",
    name: "Tisanas Frutales",
    handle: "tisanas-frutales",
    image_url: "/categories/tisanas-frutales.webp",
  },
]

/** Case- and accent-insensitive, so "PRESENTACION" matches "Presentación". */
const normaliseName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()

const readCover = (category: ExistingCategory): string | undefined => {
  const value = category.metadata?.image_url
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Decide what the seed should do, without doing it.
 *
 * @param existing  Every category currently in the store, roots and children.
 * @param seeds     Desired top-level categories.
 */
export const planCategorySeed = (
  existing: ExistingCategory[],
  seeds: SeedCategory[] = CATEGORY_SEEDS
): SeedPlan => {
  // Only roots participate: handles are globally unique, so a subcategory can
  // hold the handle a root seed expects, and writing a cover onto it would
  // target a node the root-only home grid never renders.
  const roots = existing.filter((category) => !category.parent_category_id)

  const byKey = new Map<string, ExistingCategory>()
  roots.forEach((category) => {
    const key = category.metadata?.[SEED_KEY]
    if (typeof key === "string") {
      byKey.set(key, category)
    }
  })

  const byHandle = new Map(roots.map((category) => [category.handle, category]))
  const claimed = new Set<string>()

  const plan: SeedPlan = {
    toCreate: [],
    toUpdate: [],
    conflicts: [],
    warnings: [],
  }

  seeds.forEach((seed) => {
    const matched = byKey.get(seed.key) ?? byHandle.get(seed.handle)

    if (!matched) {
      const renamed = roots.find(
        (category) =>
          !claimed.has(category.id) &&
          !category.metadata?.[SEED_KEY] &&
          normaliseName(category.name) === normaliseName(seed.name)
      )

      if (renamed) {
        plan.conflicts.push(
          `"${seed.name}" already exists as handle "${renamed.handle}" (${renamed.id}) ` +
            `but the seed expects "${seed.handle}". Creating would duplicate it. ` +
            `Either restore the handle, or set metadata.${SEED_KEY}="${seed.key}" on it to adopt it.`
        )
        return
      }

      plan.toCreate.push(seed)
      return
    }

    claimed.add(matched.id)

    const metadataPatch: Record<string, string> = {}

    if (matched.metadata?.[SEED_KEY] !== seed.key) {
      metadataPatch[SEED_KEY] = seed.key
    }

    // A cover reassigned from Admin is a deliberate decision; only fill a gap.
    if (!readCover(matched)) {
      metadataPatch.image_url = seed.image_url
    }

    if (Object.keys(metadataPatch).length > 0) {
      plan.toUpdate.push({
        id: matched.id,
        handle: matched.handle,
        metadataPatch,
      })
    }

    // Reporting "nothing to do" while a seeded category is hidden from the
    // storefront would be a lie the operator cannot see.
    if (matched.is_active === false) {
      plan.warnings.push(
        `Category "${matched.handle}" is inactive and will not render in the storefront.`
      )
    }
  })

  return plan
}

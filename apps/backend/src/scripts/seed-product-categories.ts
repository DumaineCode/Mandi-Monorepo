/**
 * Idempotent seed for the storefront's top-level product categories.
 *
 * Run with:
 *
 *   NODE_ENV=development npx medusa exec ./src/scripts/seed-product-categories.ts
 *
 * NOTE the NODE_ENV prefix. `medusa exec` does not set NODE_ENV, and
 * `medusa-config.ts` enables Postgres SSL for every value other than
 * 'development'/'test'. Without the prefix this script fails against the local
 * Docker Postgres with a misleading `KnexTimeoutError: pool is probably full`,
 * which is really an SSL handshake timeout.
 *
 * Two idempotent phases:
 *   1. create categories whose `handle` is absent
 *   2. backfill `metadata.image_url` on categories that have none
 *
 * Phase 2 merges into existing metadata and never overwrites a non-empty
 * `image_url`, so covers reassigned from the Admin UI survive a re-run.
 *
 * Creation goes through `createProductCategoriesWorkflow` rather than raw SQL
 * because Medusa derives the `mpath` materialised-path column from the parent
 * chain; writing rows directly corrupts category tree traversal.
 *
 * `metadata.image_url` points at the static covers in
 * `apps/storefront/public/categories/`. Those are storefront-root relative paths,
 * so they resolve as `<storefront>/categories/<slug>.webp`. A `-sombra` variant
 * exists for every cover and can be swapped from the Admin UI (Category →
 * Metadata → image_url) without a deploy.
 */
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  updateProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"

type SeedCategory = {
  name: string
  handle: string
  image_url: string
}

/**
 * Top-level categories, in the order they should appear in the storefront.
 * `rank` is not hardcoded — it continues from the highest existing root rank so
 * re-running after a manual reorder in Admin does not fight the user's ordering.
 */
const CATEGORIES: SeedCategory[] = [
  {
    name: "Frappuccinis",
    handle: "frappuccinis",
    image_url: "/categories/frappuccinis.webp",
  },
  {
    name: "Sodas Italianas",
    handle: "sodas-italianas",
    image_url: "/categories/sodas-italianas.webp",
  },
  {
    name: "Envases",
    handle: "envases",
    image_url: "/categories/envases.webp",
  },
  {
    name: "Ice Frutal",
    handle: "ice-frutal",
    image_url: "/categories/ice-frutal.webp",
  },
  {
    name: "Bases Gourmet",
    handle: "bases-gourmet",
    image_url: "/categories/bases-gourmet.webp",
  },
  {
    name: "Cappuccinis",
    handle: "cappuccinis",
    image_url: "/categories/cappuccinis.webp",
  },
  {
    name: "Master Latte",
    handle: "master-latte",
    image_url: "/categories/master-latte.webp",
  },
  {
    name: "Presentación 1.5 KG",
    handle: "presentacion-1-5-kg",
    image_url: "/categories/presentacion-1-5-kg.webp",
  },
  {
    name: "Tisanas Frutales",
    handle: "tisanas-frutales",
    image_url: "/categories/tisanas-frutales.webp",
  },
]

export default async function seedProductCategories({
  container,
}: {
  container: MedusaContainer
}): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existing } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "rank", "parent_category_id", "metadata"],
  })

  // --- Phase 1: create missing categories -----------------------------------
  const existingHandles = new Set(existing.map((c) => c.handle))
  const missing = CATEGORIES.filter((c) => !existingHandles.has(c.handle))

  if (missing.length) {
    // Continue ranking after the current last root category.
    const maxRootRank = existing
      .filter((c) => !c.parent_category_id)
      .reduce((max, c) => Math.max(max, c.rank ?? 0), -1)

    logger.info(
      `[seed-product-categories] Creating ${missing.length}: ${missing
        .map((c) => c.handle)
        .join(", ")}`
    )

    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missing.map((category, index) => ({
          name: category.name,
          handle: category.handle,
          is_active: true,
          is_internal: false,
          rank: maxRootRank + 1 + index,
          metadata: { image_url: category.image_url },
        })),
      },
    })
  }

  // --- Phase 2: backfill covers on pre-existing categories -------------------
  const seedByHandle = new Map(CATEGORIES.map((c) => [c.handle, c]))
  const needsCover = existing.filter((category) => {
    const seed = seedByHandle.get(category.handle)
    if (!seed) {
      return false
    }
    const current = (category.metadata as Record<string, unknown> | null)?.
      image_url
    // Treat null/undefined/"" alike: Admin's metadata editor writes empty strings.
    return typeof current !== "string" || current.trim() === ""
  })

  for (const category of needsCover) {
    const seed = seedByHandle.get(category.handle)!
    await updateProductCategoriesWorkflow(container).run({
      input: {
        selector: { id: category.id },
        // Spread the existing metadata: the update replaces the whole jsonb
        // column, so omitting this would silently drop unrelated keys.
        update: {
          metadata: {
            ...((category.metadata as Record<string, unknown> | null) ?? {}),
            image_url: seed.image_url,
          },
        },
      },
    })
    logger.info(
      `[seed-product-categories] Cover set on ${category.handle} -> ${seed.image_url}`
    )
  }

  if (!missing.length && !needsCover.length) {
    logger.info("[seed-product-categories] Nothing to do.")
    return
  }

  logger.info("[seed-product-categories] Done.")
}

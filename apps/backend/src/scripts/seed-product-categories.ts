/**
 * Idempotent seed for the storefront's top-level product categories.
 *
 *   NODE_ENV=development npx medusa exec ./src/scripts/seed-product-categories.ts
 *
 * NOTE the NODE_ENV prefix. `medusa exec` does not set NODE_ENV, and
 * `medusa-config.ts` enables Postgres SSL for every value other than
 * 'development'/'test'. Without it this fails against the local Docker Postgres
 * with a misleading `KnexTimeoutError: pool is probably full`, which is really
 * an SSL handshake timeout.
 *
 * This file is a thin shell on purpose: all identity and idempotency decisions
 * live in `seed-product-categories.core.ts`, which is unit-tested without a
 * database. Everything here is container wiring plus the two things that can
 * only be done against live data — re-reading metadata immediately before a
 * write, and reporting partial failure honestly.
 *
 * Creation goes through `createProductCategoriesWorkflow` rather than raw SQL:
 * Medusa derives the `mpath` materialised-path column from the parent chain, and
 * writing rows directly corrupts category tree traversal.
 */
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  updateProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  CATEGORY_SEEDS,
  SEED_KEY,
  type ExistingCategory,
  planCategorySeed,
} from "./seed-product-categories.core"

const CATEGORY_FIELDS = [
  "id",
  "name",
  "handle",
  "parent_category_id",
  "is_active",
  "metadata",
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
    fields: CATEGORY_FIELDS,
  })

  const plan = planCategorySeed(existing as ExistingCategory[], CATEGORY_SEEDS)

  // A conflict means identity is ambiguous. Writing anything at that point is
  // how the duplicate category happened, so nothing is written at all.
  if (plan.conflicts.length > 0) {
    plan.conflicts.forEach((conflict) => logger.error(`[seed] ${conflict}`))
    throw new Error(
      `[seed] ${plan.conflicts.length} unresolved category conflict(s); no changes were made.`
    )
  }

  plan.warnings.forEach((warning) => logger.warn(`[seed] ${warning}`))

  if (plan.toCreate.length > 0) {
    logger.info(
      `[seed] Creating ${plan.toCreate.length}: ${plan.toCreate
        .map((seed) => seed.handle)
        .join(", ")}`
    )

    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: plan.toCreate.map((seed) => ({
          name: seed.name,
          handle: seed.handle,
          is_active: true,
          is_internal: false,
          // No `rank`: Medusa assigns one, and a lower value would rerank every
          // existing sibling, silently reordering a merchant's arrangement.
          metadata: { [SEED_KEY]: seed.key, image_url: seed.image_url },
        })),
      },
    })
  }

  const failures: string[] = []

  for (const update of plan.toUpdate) {
    try {
      /**
       * Re-read immediately before writing. `updateProductCategoriesWorkflow`
       * REPLACES the metadata jsonb column rather than merging it — unlike most
       * entities, `ProductCategoryRepository` overrides the base `update` and
       * calls `manager.assign` without `mergeObjectProperties`. Spreading a
       * snapshot taken at the top of this script would therefore delete any key
       * an admin saved while it was running.
       */
      const { data: fresh } = await query.graph({
        entity: "product_category",
        fields: ["id", "metadata"],
        filters: { id: update.id },
      })

      const current = (fresh[0]?.metadata ?? {}) as Record<string, unknown>

      await updateProductCategoriesWorkflow(container).run({
        input: {
          selector: { id: update.id },
          update: { metadata: { ...current, ...update.metadataPatch } },
        },
      })

      logger.info(
        `[seed] Updated ${update.handle}: ${Object.keys(update.metadataPatch).join(", ")}`
      )
    } catch (error) {
      // Each workflow is its own transaction, so an early throw would leave the
      // remaining categories untouched with no summary. Collect and continue;
      // a re-run resumes cleanly because the plan is derived from live state.
      failures.push(
        `${update.handle}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  if (failures.length > 0) {
    failures.forEach((failure) => logger.error(`[seed] FAILED ${failure}`))
    throw new Error(
      `[seed] ${plan.toUpdate.length - failures.length}/${plan.toUpdate.length} updates applied, ${failures.length} failed.`
    )
  }

  if (plan.toCreate.length === 0 && plan.toUpdate.length === 0) {
    logger.info("[seed] Nothing to do.")
    return
  }

  logger.info(
    `[seed] Done — created ${plan.toCreate.length}, updated ${plan.toUpdate.length}.`
  )
}

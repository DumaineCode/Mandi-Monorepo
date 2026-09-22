import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { HttpTypes } from "@medusajs/types"
import RecipesPage, {
  metadata,
} from "../../app/[countryCode]/(main)/recetas/page"
import NavShell from "../layout/templates/nav/nav-shell"
import { sampleRecipes } from "./data"

vi.mock("next/navigation", () => ({
  useParams: () => ({ countryCode: "mx" }),
  usePathname: () => "/mx/recetas",
}))

describe("sample recipe book", () => {
  it("provides four complete recipes with unique, anchor-safe identifiers", () => {
    expect(sampleRecipes).toHaveLength(4)
    expect(new Set(sampleRecipes.map(({ id }) => id)).size).toBe(4)
    for (const recipe of sampleRecipes) {
      expect(recipe.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(recipe.servings).toMatch(/^\d/)
      expect(recipe.prepMinutes).toBeGreaterThan(0)
      expect(recipe.waitMinutes).toBeGreaterThanOrEqual(0)
      expect(recipe.waitLabel).not.toBe("")
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(4)
      expect(
        recipe.ingredients.every((ingredient) => /^\d/.test(ingredient))
      ).toBe(true)
      expect(recipe.steps.length).toBeGreaterThanOrEqual(3)
    }
  })

  it("renders all recipes, working index targets, sample disclosure and localized shop link", () => {
    const html = renderToStaticMarkup(<RecipesPage />)
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html.match(/<article\b/g)).toHaveLength(4)
    for (const recipe of sampleRecipes) {
      expect(html).toContain(`href="#${recipe.id}"`)
      expect(html).toContain(`id="${recipe.id}"`)
      expect(html).toContain(recipe.name)
    }
    expect(html).toContain("aún no probados ni aprobados por Mandi")
    expect(html).toContain('href="/mx/store"')
    expect(metadata.title).toContain("Recetas")
    expect(metadata.description).toBeTruthy()
  })

  it("adds an active localized desktop link without replacing dynamic categories or children", () => {
    const categories = [
      {
        id: "leaf",
        handle: "seasonal",
        name: "Seasonal",
        category_children: [],
      },
      {
        id: "parent",
        handle: "drinks",
        name: "Drinks",
        category_children: [{ id: "child", handle: "tea", name: "Tea" }],
      },
    ] as HttpTypes.StoreProductCategory[]
    const html = renderToStaticMarkup(
      <NavShell categories={categories} cart={null} sideMenu={null} />
    )
    expect(html).toContain('href="/mx/recetas"')
    expect(html).toContain('aria-current="page"')
    for (const handle of ["seasonal", "drinks", "tea"]) {
      expect(html).toContain(`href="/mx/categories/${handle}"`)
    }
  })
})

import React from "react"
import { Metadata } from "next"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { sampleRecipes } from "@modules/recipes/data"

const title = "Recetas para darle otro giro al antojo | Mandi"
const description =
  "Un pequeño recetario de inspiración: cuatro recetas de ejemplo con taro, galleta, blueberry y mango. Ingredientes, tiempos y pasos para explorar en tu cocina."

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
}

const focusStyle =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"

function RecipeIllustration() {
  return (
    <svg
      viewBox="0 0 400 320"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="mx-auto w-full max-w-sm text-ink"
    >
      <ellipse cx="196" cy="274" rx="146" ry="18" className="fill-ink/10" />
      <path
        d="M300 175 342 51Q350 35 357 44Q360 48 354 61L309 183"
        className="fill-gold"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M66 168Q77 275 196 277Q309 275 326 168Z"
        className="fill-coral-light"
        stroke="currentColor"
        strokeWidth="3"
      />
      <ellipse
        cx="196"
        cy="165"
        rx="130"
        ry="42"
        className="fill-paper"
        stroke="currentColor"
        strokeWidth="3"
      />
      <ellipse cx="196" cy="168" rx="111" ry="28" className="fill-coral" />
      <g className="fill-gold" stroke="currentColor" strokeWidth="2">
        <ellipse
          cx="141"
          cy="157"
          rx="22"
          ry="12"
          transform="rotate(-18 141 157)"
        />
        <ellipse
          cx="179"
          cy="169"
          rx="22"
          ry="12"
          transform="rotate(-18 179 169)"
        />
        <ellipse
          cx="218"
          cy="177"
          rx="22"
          ry="12"
          transform="rotate(-18 218 177)"
        />
      </g>
      <g className="fill-ink">
        <circle cx="248" cy="153" r="8" />
        <circle cx="270" cy="162" r="7" />
        <circle cx="240" cy="172" r="6" />
      </g>
      <path
        d="m112 175 9 3m80-28 9 3m75 29 8-2M111 224q82 54 164 0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m77 73 6-17 6 17 17 6-17 6-6 17-6-17-17-6ZM249 68l4-12 4 12 12 4-12 4-4 12-4-12-12-4Z"
        className="fill-teal"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M163 99q-15-15 0-29t0-29m40 63q-15-15 0-29"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function RecipesPage() {
  return (
    <div className="bg-cream font-hanken text-ink">
      <section
        className="overflow-hidden border-b border-line"
        aria-labelledby="recipes-title"
      >
        <div className="content-container grid gap-6 py-12 small:grid-cols-[1.3fr_1fr] small:items-center small:py-20">
          <div>
            <p className="mb-5 font-mono text-xs uppercase tracking-widest">
              De la alacena a la mesa · Recetario Mandi
            </p>
            <h1
              id="recipes-title"
              className="max-w-3xl font-blusans text-5xl leading-[1.05] small:text-7xl"
            >
              Dale otro giro
              <br />
              al{" "}
              <span className="inline-block -rotate-2 bg-gold px-3 pb-2">
                antojo.
              </span>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed">
              Una cuchara, tus sabores favoritos y ganas de probar algo
              distinto. Ideas para desayunos sin prisa, pausas dulces y postres
              de última cucharada.
            </p>
            <a
              href="#recetario"
              className={`mt-7 inline-flex min-h-12 items-center rounded-full bg-ink px-6 py-3 font-blusans text-cream hover:bg-ink-soft ${focusStyle}`}
            >
              Abrir el recetario{" "}
              <span aria-hidden="true" className="ml-4">
                ↓
              </span>
            </a>
          </div>
          <div className="relative">
            <RecipeIllustration />
            <p className="mx-auto w-fit rotate-2 border border-ink bg-paper px-5 py-3 font-blusans text-lg">
              La cocina también es para jugar.
            </p>
          </div>
        </div>
      </section>

      <div className="content-container py-12 small:py-16">
        <aside
          className="mb-12 max-w-3xl border-l-4 border-coral pl-5 text-sm leading-relaxed"
          aria-label="Sobre estas recetas"
        >
          <p className="font-semibold">Una probadita de lo que viene</p>
          <p>
            Estas recetas son ejemplos de inspiración, aún no probados ni
            aprobados por Mandi. Las cantidades son orientativas; revisa las
            indicaciones y los alérgenos de cada producto antes de preparar.
          </p>
        </aside>

        <nav
          id="recetario"
          aria-label="Índice de recetas"
          className="scroll-mt-48"
        >
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-blusans text-3xl">¿Qué se te antoja hoy?</h2>
            <span className="font-mono text-xs uppercase tracking-widest">
              4 ideas · a tu ritmo
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 small:grid-cols-4">
            {sampleRecipes.map((recipe) => (
              <a
                key={recipe.id}
                href={`#${recipe.id}`}
                className={`group flex flex-col border border-ink/20 bg-paper p-5 hover:border-ink hover:bg-gold/20 ${focusStyle}`}
              >
                <span className="text-xs uppercase tracking-widest text-ink-muted">
                  {recipe.occasion}
                </span>
                <span className="my-3 font-blusans text-2xl">
                  {recipe.name}
                </span>
                <span className="mt-auto flex justify-between gap-2 text-sm">
                  {recipe.prepMinutes} min de preparación{" "}
                  <span aria-hidden="true">↗</span>
                </span>
                <span className="mt-1 text-xs text-ink-muted">
                  {recipe.waitLabel}
                </span>
              </a>
            ))}
          </div>
        </nav>

        <div className="mt-16 space-y-12 small:space-y-16">
          {sampleRecipes.map((recipe) => (
            <article
              key={recipe.id}
              id={recipe.id}
              aria-labelledby={`${recipe.id}-title`}
              className="scroll-mt-48 border-t-2 border-ink bg-paper"
            >
              <header className="grid gap-6 border-b border-line p-6 small:grid-cols-[1.4fr_1fr] small:p-10">
                <div>
                  <p className="mb-3 text-xs uppercase tracking-widest text-ink-muted">
                    {recipe.occasion} · Con {recipe.product}
                  </p>
                  <h2
                    id={`${recipe.id}-title`}
                    className="font-blusans text-4xl small:text-5xl"
                  >
                    {recipe.name}
                  </h2>
                  <p className="mt-4 max-w-xl leading-relaxed">
                    {recipe.description}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-4 self-end border-l-2 border-coral pl-5 text-sm">
                  <div>
                    <dt className="text-ink-muted">Rinde</dt>
                    <dd className="mt-1 font-semibold">{recipe.servings}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Preparación</dt>
                    <dd className="mt-1 font-semibold">
                      {recipe.prepMinutes} min
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-ink-muted">Tiempo de espera</dt>
                    <dd className="mt-1 font-semibold">{recipe.waitLabel}</dd>
                  </div>
                </dl>
              </header>
              <div className="grid gap-8 p-6 small:grid-cols-[1fr_1.6fr] small:gap-12 small:p-10">
                <div>
                  <h3 className="mb-4 font-blusans text-2xl">Sobre la mesa</h3>
                  <ul className="space-y-3">
                    {recipe.ingredients.map((ingredient) => (
                      <li
                        key={ingredient}
                        className="flex gap-3 border-b border-line pb-3"
                      >
                        <span aria-hidden="true" className="text-coral">
                          ✦
                        </span>
                        {ingredient}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-4 font-blusans text-2xl">
                    Manos a la mezcla
                  </h3>
                  <ol className="list-decimal space-y-5 pl-6 marker:font-bold marker:text-ink-muted">
                    {recipe.steps.map((step) => (
                      <li key={step} className="pl-2 leading-relaxed">
                        {step}
                      </li>
                    ))}
                  </ol>
                  <aside className="mt-7 bg-cream p-5 leading-relaxed">
                    <p className="mb-1 font-blusans text-lg">
                      El pequeño toque
                    </p>
                    <p>{recipe.tip}</p>
                  </aside>
                </div>
              </div>
              <div className="border-t border-line px-6 py-3 small:px-10">
                <a
                  href="#recetario"
                  className={`inline-flex min-h-11 items-center text-sm underline underline-offset-4 ${focusStyle}`}
                >
                  Volver al recetario{" "}
                  <span aria-hidden="true" className="ml-2">
                    ↑
                  </span>
                </a>
              </div>
            </article>
          ))}
        </div>

        <section
          className="mt-16 border-y border-ink/20 py-10 text-center"
          aria-labelledby="pantry-title"
        >
          <p className="mb-3 font-mono text-xs uppercase tracking-widest">
            El siguiente antojo empieza aquí
          </p>
          <h2
            id="pantry-title"
            className="font-blusans text-3xl small:text-4xl"
          >
            Hazle espacio a un nuevo sabor.
          </h2>
          <LocalizedClientLink
            href="/store"
            className={`mt-6 inline-flex min-h-12 items-center rounded-full bg-ink px-7 py-3 font-blusans text-cream hover:bg-ink-soft ${focusStyle}`}
          >
            Explorar la tienda{" "}
            <span aria-hidden="true" className="ml-4">
              →
            </span>
          </LocalizedClientLink>
        </section>
      </div>
    </div>
  )
}

import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const fromSrc = (segment: string) =>
  fileURLToPath(new URL(`./src/${segment}`, import.meta.url))

export default defineConfig({
  test: {
    /**
     * Both modules covered so far (`lib/util/phone.ts`, `lib/util/checkout-step.ts`)
     * are pure — a regex source string and two plain predicates. Nothing touches
     * `document`, so `node` keeps the runner free of a jsdom/happy-dom dependency
     * and keeps the CI step fast. Add an `environment: "jsdom"` override on the
     * specific suite that needs it rather than flipping this global default.
     */
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
  resolve: {
    /**
     * Mirrors the `paths` entries in tsconfig.json so a test can import a module
     * exactly the way application code does. Without this, `@lib/...` inside a
     * spec fails to resolve with an error that does not mention tsconfig at all.
     */
    alias: {
      "@lib": fromSrc("lib"),
      "@modules": fromSrc("modules"),
      "@pages": fromSrc("pages"),
    },
  },
})

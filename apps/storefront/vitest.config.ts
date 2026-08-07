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
    /**
     * `.tsx` is included even though every suite here is currently `.ts`.
     *
     * Not aspiration — a trap. With `*.spec.ts` alone, a spec named `foo.spec.tsx`
     * is collected by NOTHING: vitest reports the files it did run and says nothing
     * about the one it never looked at, so the suite stays green and the author
     * believes their rule is covered. The same glob is duplicated in
     * `.github/workflows/ci.yml`'s focused-test guard (`--include`), and the two
     * must agree or a `.only` in a `.tsx` spec silently skips the rest of the file.
     *
     * Widening the pattern costs nothing and removes the failure mode where the
     * absence of coverage is indistinguishable from passing coverage.
     */
    include: ["src/**/*.spec.{ts,tsx}"],
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

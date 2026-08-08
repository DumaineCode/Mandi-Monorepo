const path = require("path")
const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Container builds ship the standalone server instead of the whole workspace.
   *
   * `next build` traces the modules the server actually imports and emits a
   * self-contained tree under .next/standalone, so the runtime image carries a
   * pruned node_modules (tens of MB) instead of the installed workspace
   * (hundreds of MB, most of it build-only tooling). Without this the runner
   * stage has no choice but to copy node_modules wholesale.
   *
   * outputFileTracingRoot must point at the monorepo root: pnpm hoists shared
   * dependencies into <root>/node_modules/.pnpm, which sits ABOVE this package.
   * Left at its default (the package directory) the tracer walks out of its own
   * root, silently drops those hoisted packages, and the container dies at
   * startup with MODULE_NOT_FOUND. Naming the root also makes the emitted paths
   * workspace-relative, which is why the runner runs apps/storefront/server.js
   * rather than server.js.
   */
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  /**
   * The tracer over-includes. It follows build-time requires into the emitted
   * server tree, so .next/standalone ships esbuild, typescript, webpack and
   * terser even though the running server never loads a line of any of them.
   * Measured on the runner image: 88MB of traced node_modules, 45MB of it
   * build-only. Excluding them here is the ONLY lever — the Dockerfile sits
   * downstream of this build and can only copy what the tracer emits.
   *
   * sharp is excluded ONLY because `images.unoptimized` is true below, which
   * removes the /_next/image optimizer route entirely (it 404s), so nothing
   * ever reaches the code that would load sharp. THESE TWO SETTINGS ARE
   * COUPLED. Turning `unoptimized` off without first deleting the @img and
   * sharp entries from this list makes every optimized image fail at runtime
   * with MODULE_NOT_FOUND — and it fails in production only, because the dev
   * server never reads the traced tree.
   *
   * Verified by stripping each package from a built image: the server still
   * reaches "Ready", nothing reports MODULE_NOT_FOUND, and five routes return
   * status codes identical to an untouched control build.
   */
  outputFileTracingExcludes: {
    "**": [
      "**/node_modules/@img/**",
      "**/node_modules/sharp/**",
      "**/node_modules/@esbuild/**",
      "**/node_modules/esbuild/**",
      "**/node_modules/typescript/**",
      "**/node_modules/webpack/**",
      "**/node_modules/terser/**",
    ],
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // Coupled to outputFileTracingExcludes above: this being true is what
    // makes dropping sharp from the traced output safe. Flipping it to false
    // requires putting the @img and sharp entries back first.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig

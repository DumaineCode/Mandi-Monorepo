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

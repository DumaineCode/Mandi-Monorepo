const c = require("ansi-colors");

const requiredEnvs = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    // TODO: we need a good doc to point this to
    description:
      "Learn how to create a publishable key: https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys",
  },
  {
    key: "NEXT_PUBLIC_BASE_URL",
    // `getBaseURL()` (src/lib/util/env.ts) falls back to https://localhost:8000
    // when this is unset, and Next INLINES NEXT_PUBLIC_* values at BUILD time.
    // So an image built without it ships a bundle whose Openpay `return_url`
    // and Mercado Pago `back_urls_base` both point at localhost: the customer
    // completes 3DS or pays at Mercado Pago and lands nowhere, with the charge
    // already taken. Failing the build is the only place this is still cheap.
    description:
      "The public origin of this storefront, e.g. https://mandi.mx. Used to build the Openpay return_url and the Mercado Pago back_urls_base.",
  },
];

function checkEnvVariables() {
  const missingEnvs = requiredEnvs.filter(function (env) {
    c;
    return !process.env[env.key];
  });

  if (missingEnvs.length > 0) {
    console.error(
      c.red.bold("\n🚫 Error: Missing required environment variables\n")
    );

    missingEnvs.forEach(function (env) {
      console.error(c.yellow(`  ${c.bold(env.key)}`));
      if (env.description) {
        console.error(c.dim(`    ${env.description}\n`));
      }
    });

    console.error(
      c.yellow(
        "\nPlease set these variables in your .env file or environment before starting the application.\n"
      )
    );

    process.exit(1);
  }
}

module.exports = checkEnvVariables;

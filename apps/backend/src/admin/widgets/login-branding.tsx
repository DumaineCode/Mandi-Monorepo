import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Heading, Text } from "@medusajs/ui"
import logoLight from "../assets/logo-light.png"
import logoDark from "../assets/logo-dark.png"
import "./login-branding.css"

// Branding shown on the admin login screen. A scoped CSS rule (see
// login-branding.css) hides Medusa's default logo + "Welcome to Medusa"
// heading so only this branding is visible above the login form.
const LoginBranding = () => {
  return (
    <div className="mb-6 flex flex-col items-center gap-y-3">
      {/* Black logo for light theme */}
      <img
        src={logoLight}
        alt="Mandi Oficial"
        className="h-14 w-auto object-contain dark:hidden"
      />
      {/* Cream logo for dark theme */}
      <img
        src={logoDark}
        alt="Mandi Oficial"
        className="hidden h-14 w-auto object-contain dark:block"
      />

      <div className="flex flex-col items-center">
        <Heading level="h1">Mandi Oficial</Heading>
        <Text size="small" className="text-ui-fg-subtle text-center">
          Panel de gestión de la tienda en línea
        </Text>
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LoginBranding

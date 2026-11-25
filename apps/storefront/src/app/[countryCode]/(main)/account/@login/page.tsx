import { Metadata } from "next"

import LoginTemplate from "@modules/account/templates/login-template"

export const metadata: Metadata = {
  title: "Iniciar sesión | MANDI",
  description: "Inicia sesión o crea tu cuenta MANDI.",
}

export default function Login() {
  return <LoginTemplate />
}

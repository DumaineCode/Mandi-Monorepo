import { Metadata } from "next"

import LoginTemplate from "@modules/account/templates/login-template"

export const metadata: Metadata = {
  title: "Iniciar sesión | MANDO",
  description: "Inicia sesión o crea tu cuenta MANDO.",
}

export default function Login() {
  return <LoginTemplate />
}

"use client"

import { useActionState } from "react"
import Input from "@modules/common/components/input"
import { LOGIN_VIEW } from "@modules/account/templates/login-template"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { signup } from "@lib/data/customer"

type Props = {
  setCurrentView: (view: LOGIN_VIEW) => void
}

const Register = ({ setCurrentView }: Props) => {
  const [message, formAction] = useActionState(signup, null)

  return (
    <div className="flex w-full max-w-lg flex-col" data-testid="register-page">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
        Únete a MANDO
      </p>
      <h2 className="font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
        Crea tu cuenta
      </h2>
      <p className="mb-6 mt-3 text-sm leading-6 text-ink-muted">
        Regístrate para comprar más rápido y tener tus pedidos siempre a la
        mano.
      </p>
      <form className="w-full flex flex-col" action={formAction}>
        <div className="grid w-full grid-cols-1 gap-3 xsmall:grid-cols-2">
          <div className="xsmall:col-span-1">
            <Input
              label="Nombre"
              name="first_name"
              required
              autoComplete="given-name"
              data-testid="first-name-input"
            />
          </div>
          <div className="xsmall:col-span-1">
            <Input
              label="Apellidos"
              name="last_name"
              required
              autoComplete="family-name"
              data-testid="last-name-input"
            />
          </div>
          <div className="xsmall:col-span-2">
            <Input
              label="Correo electrónico"
              name="email"
              required
              type="email"
              autoComplete="email"
              data-testid="email-input"
            />
          </div>
          <div className="xsmall:col-span-2">
            <Input
              label="Teléfono"
              name="phone"
              type="tel"
              autoComplete="tel"
              data-testid="phone-input"
            />
          </div>
          <div className="xsmall:col-span-2">
            <Input
              label="Contraseña"
              name="password"
              required
              type="password"
              autoComplete="new-password"
              data-testid="password-input"
            />
          </div>
        </div>
        <ErrorMessage error={message} data-testid="register-error" />
        <p className="mt-5 text-center text-xs leading-5 text-ink-muted">
          Al crear una cuenta, aceptas el{" "}
          <LocalizedClientLink
            href="/content/privacy-policy"
            className="font-semibold text-ink underline underline-offset-2"
          >
            Aviso de privacidad
          </LocalizedClientLink>{" "}
          y los{" "}
          <LocalizedClientLink
            href="/content/terms-of-use"
            className="font-semibold text-ink underline underline-offset-2"
          >
            Términos y condiciones
          </LocalizedClientLink>
          .
        </p>
        <SubmitButton
          className="mt-5 h-12 w-full"
          data-testid="register-button"
        >
          Crear cuenta
        </SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        ¿Ya tienes cuenta?{" "}
        <button
          type="button"
          onClick={() => setCurrentView(LOGIN_VIEW.SIGN_IN)}
          className="min-h-11 font-semibold text-ink underline decoration-coral decoration-2 underline-offset-4 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          Inicia sesión
        </button>
      </p>
    </div>
  )
}

export default Register

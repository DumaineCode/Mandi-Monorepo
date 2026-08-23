import { login } from "@lib/data/customer"
import { LOGIN_VIEW } from "@modules/account/templates/login-template"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { useActionState } from "react"

type Props = {
  setCurrentView: (view: LOGIN_VIEW) => void
}

const Login = ({ setCurrentView }: Props) => {
  const [message, formAction] = useActionState(login, null)

  return (
    <div className="flex w-full max-w-md flex-col" data-testid="login-page">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
        Mi cuenta
      </p>
      <h2 className="font-bricolage text-3xl font-extrabold tracking-[-0.03em] text-ink">
        Qué gusto verte de nuevo
      </h2>
      <p className="mb-8 mt-3 text-sm leading-6 text-ink-muted">
        Inicia sesión para consultar tus pedidos y administrar tus datos.
      </p>
      <form className="w-full" action={formAction}>
        <div className="flex w-full flex-col gap-y-3">
          <Input
            label="Correo electrónico"
            name="email"
            type="email"
            title="Ingresa un correo electrónico válido."
            autoComplete="email"
            required
            data-testid="email-input"
          />
          <Input
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />
        </div>
        <ErrorMessage error={message} data-testid="login-error-message" />
        <SubmitButton data-testid="sign-in-button" className="mt-6 h-12 w-full">
          Iniciar sesión
        </SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        ¿Aún no tienes cuenta?{" "}
        <button
          type="button"
          onClick={() => setCurrentView(LOGIN_VIEW.REGISTER)}
          className="min-h-11 font-semibold text-ink underline decoration-coral decoration-2 underline-offset-4 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          data-testid="register-button"
        >
          Crea la tuya
        </button>
      </p>
    </div>
  )
}

export default Login

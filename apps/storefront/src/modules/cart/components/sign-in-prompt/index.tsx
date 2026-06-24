import LocalizedClientLink from "@modules/common/components/localized-client-link"

const SignInPrompt = () => {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-cream p-4">
      <div>
        <h2 className="font-bricolage text-lg font-bold text-ink">
          ¿Ya tienes una cuenta?
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Inicia sesión para una mejor experiencia.
        </p>
      </div>
      <LocalizedClientLink
        href="/account"
        data-testid="sign-in-button"
        className="shrink-0 rounded-xl border border-ink px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream motion-reduce:transition-none"
      >
        Iniciar sesión
      </LocalizedClientLink>
    </div>
  )
}

export default SignInPrompt

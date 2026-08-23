"use client"

import { useState } from "react"

import Register from "@modules/account/components/register"
import Login from "@modules/account/components/login"

export enum LOGIN_VIEW {
  SIGN_IN = "sign-in",
  REGISTER = "register",
}

const LoginTemplate = () => {
  const [currentView, setCurrentView] = useState<LOGIN_VIEW>(LOGIN_VIEW.SIGN_IN)

  return (
    <div className="w-full overflow-hidden rounded-[22px] border border-line bg-paper shadow-sm">
      <div className="grid min-h-[620px] grid-cols-1 small:grid-cols-[0.85fr_1.15fr]">
        <section className="flex flex-col justify-between bg-ink p-7 text-cream small:p-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-cream-muted">
              Tu cuenta MANDO
            </p>
            <h1 className="mt-4 max-w-md font-bricolage text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] small:text-5xl">
              Todo lo que compras, en un solo lugar.
            </h1>
          </div>

          <ul className="mt-10 flex flex-col gap-4 text-sm text-cream-muted">
            {[
              "Consulta el estado de tus pedidos",
              "Guarda tus direcciones de envío",
              "Actualiza tus datos cuando quieras",
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-coral"
                  aria-hidden="true"
                />
                {benefit}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex items-center justify-center p-6 xsmall:p-8 small:p-10">
          {currentView === LOGIN_VIEW.SIGN_IN ? (
            <Login setCurrentView={setCurrentView} />
          ) : (
            <Register setCurrentView={setCurrentView} />
          )}
        </section>
      </div>
    </div>
  )
}

export default LoginTemplate

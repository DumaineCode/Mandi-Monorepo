import { Label, clx } from "@modules/common/components/ui"
import React, { useEffect, useImperativeHandle, useState } from "react"

import Eye from "@modules/common/icons/eye"
import EyeOff from "@modules/common/icons/eye-off"

type InputProps = Omit<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
  "placeholder"
> & {
  label: string
  errors?: Record<string, unknown>
  touched?: Record<string, unknown>
  name: string
  topLabel?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      type,
      name,
      label,
      touched: _touched,
      required,
      topLabel,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    const generatedId = React.useId()
    const inputId = id || `${name}-${generatedId}`
    const [showPassword, setShowPassword] = useState(false)
    const [inputType, setInputType] = useState(type)

    useEffect(() => {
      if (type === "password" && showPassword) {
        setInputType("text")
      }

      if (type === "password" && !showPassword) {
        setInputType("password")
      }
    }, [type, showPassword])

    useImperativeHandle(ref, () => inputRef.current!)

    return (
      <div className="flex flex-col w-full">
        {topLabel && (
          <Label className="mb-2 txt-compact-medium-plus">{topLabel}</Label>
        )}
        <div className="flex relative z-0 w-full txt-compact-medium">
          <input
            id={inputId}
            type={inputType}
            name={name}
            placeholder=" "
            required={required}
            className={clx(
              "mt-0 block h-12 w-full appearance-none rounded-xl border border-line bg-paper px-4 pb-1 pt-4 text-base text-ink transition-colors hover:border-coral focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/20 disabled:cursor-not-allowed disabled:opacity-60",
              className
            )}
            {...props}
            ref={inputRef}
          />
          <label
            htmlFor={inputId}
            onClick={() => inputRef.current?.focus()}
            className="absolute top-3 -z-1 mx-3 flex origin-0 items-center justify-center bg-paper px-1 text-ink-muted transition-all duration-300"
          >
            {label}
            {required && <span className="text-ink-muted">*</span>}
          </label>
          {type === "password" && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center rounded-xl text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
              aria-pressed={showPassword}
            >
              {showPassword ? <Eye /> : <EyeOff />}
            </button>
          )}
        </div>
      </div>
    )
  }
)

Input.displayName = "Input"

export default Input

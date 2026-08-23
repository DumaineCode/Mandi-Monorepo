import { Disclosure } from "@headlessui/react"
import { Badge, Button, clx } from "@modules/common/components/ui"
import { useEffect } from "react"

import useToggleState from "@lib/hooks/use-toggle-state"
import { useFormStatus } from "react-dom"

type AccountInfoProps = {
  label: string
  currentInfo: string | React.ReactNode
  isSuccess?: boolean
  isError?: boolean
  errorMessage?: string
  clearState: () => void
  children?: React.ReactNode
  "data-testid"?: string
}

const AccountInfo = ({
  label,
  currentInfo,
  isSuccess,
  isError,
  clearState,
  errorMessage = "Ocurrió un error. Inténtalo de nuevo.",
  children,
  "data-testid": dataTestid,
}: AccountInfoProps) => {
  const { state, close, toggle } = useToggleState()

  const { pending } = useFormStatus()

  const handleToggle = () => {
    clearState()
    setTimeout(() => toggle(), 100)
  }

  useEffect(() => {
    if (isSuccess) {
      close()
    }
  }, [isSuccess, close])

  return (
    <div
      className="rounded-2xl border border-line bg-cream/50 p-4 text-sm small:p-5"
      data-testid={dataTestid}
    >
      <div className="flex flex-col justify-between gap-4 xsmall:flex-row xsmall:items-end">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
            {label}
          </span>
          <div className="mt-2 flex min-w-0 items-center text-ink">
            {typeof currentInfo === "string" ? (
              <span
                className="break-words font-semibold"
                data-testid="current-info"
              >
                {currentInfo}
              </span>
            ) : (
              currentInfo
            )}
          </div>
        </div>
        <div>
          <Button
            variant="secondary"
            className="min-h-11 w-full !border-line !bg-paper !text-ink hover:!border-coral hover:!bg-cream xsmall:w-[112px]"
            onClick={handleToggle}
            type={state ? "reset" : "button"}
            aria-expanded={state}
            data-testid="edit-button"
            data-active={state}
          >
            {state ? "Cancelar" : "Editar"}
          </Button>
        </div>
      </div>

      {/* Success state */}
      <Disclosure>
        <Disclosure.Panel
          static
          className={clx(
            "transition-[max-height,opacity] duration-300 ease-in-out overflow-hidden",
            {
              "max-h-[1000px] opacity-100": isSuccess,
              "max-h-0 opacity-0": !isSuccess,
            }
          )}
          data-testid="success-message"
        >
          <Badge className="my-4 !bg-teal/30 p-2 !text-ink" color="green">
            <span>{label} se actualizó correctamente.</span>
          </Badge>
        </Disclosure.Panel>
      </Disclosure>

      {/* Error state  */}
      <Disclosure>
        <Disclosure.Panel
          static
          className={clx(
            "transition-[max-height,opacity] duration-300 ease-in-out overflow-hidden",
            {
              "max-h-[1000px] opacity-100": isError,
              "max-h-0 opacity-0": !isError,
            }
          )}
          data-testid="error-message"
        >
          <Badge className="my-4 p-2" color="red">
            <span>{errorMessage}</span>
          </Badge>
        </Disclosure.Panel>
      </Disclosure>

      <Disclosure>
        <Disclosure.Panel
          static
          className={clx(
            "transition-[max-height,opacity] duration-300 ease-in-out overflow-visible",
            {
              "max-h-[1000px] opacity-100": state,
              "max-h-0 opacity-0": !state,
            }
          )}
        >
          <div className="flex flex-col gap-y-2 pt-5">
            <div>{children}</div>
            <div className="mt-2 flex items-center justify-end">
              <Button
                isLoading={pending}
                className="min-h-11 w-full !bg-coral-light !text-ink hover:!bg-coral-hover xsmall:max-w-[180px]"
                type="submit"
                data-testid="save-button"
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        </Disclosure.Panel>
      </Disclosure>
    </div>
  )
}

export default AccountInfo

import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { CheckCircleSolid, XCircle } from "@medusajs/icons"

import {
  buildTestCandidate,
  buildUpsertBody,
  deriveSecretState,
  initialFormState,
  type MaskedProviderSetting,
  type ProviderFormDef,
  type ProviderFormState,
  type ProviderMode,
} from "../form-model"
import {
  clearProviderSettings,
  PROVIDER_SETTINGS_QUERY_KEY,
  testProviderConnection,
  upsertProviderSettings,
  type TestConnectionResult,
} from "../api"

const errorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }
  return fallback
}

const formatTimestamp = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—"

export const ProviderPanel = ({
  def,
  data,
}: {
  def: ProviderFormDef
  data: MaskedProviderSetting
}) => {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState<MaskedProviderSetting>(data)
  const [form, setForm] = useState<ProviderFormState>(() =>
    initialFormState(def, data)
  )
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  const secretState = useMemo(
    () => deriveSecretState(def, saved, form.mode),
    [def, saved, form.mode]
  )

  const resetFrom = (next: MaskedProviderSetting) => {
    setSaved(next)
    setForm(initialFormState(def, next))
    setTestResult(null)
  }

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: PROVIDER_SETTINGS_QUERY_KEY })

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertProviderSettings(def.provider, buildUpsertBody(def, saved, form).body),
    onSuccess: (result) => {
      resetFrom(result)
      invalidateList()
      toast.success(`${def.label} settings saved`)
    },
    onError: (error) =>
      toast.error(errorMessage(error, `Failed to save ${def.label} settings`)),
  })

  const clearMutation = useMutation({
    mutationFn: () => clearProviderSettings(def.provider),
    onSuccess: (result) => {
      resetFrom(result)
      invalidateList()
      toast.success(`${def.label} settings cleared`)
    },
    onError: (error) =>
      toast.error(errorMessage(error, `Failed to clear ${def.label} settings`)),
  })

  const testMutation = useMutation({
    mutationFn: () =>
      testProviderConnection(def.provider, buildTestCandidate(def, form)),
    onSuccess: (result) => setTestResult(result),
    onError: (error) =>
      setTestResult({
        ok: false,
        detail: errorMessage(error, "Test connection failed"),
        checked_at: new Date().toISOString(),
      }),
  })

  const pending =
    saveMutation.isPending || clearMutation.isPending || testMutation.isPending

  const setValue = (name: string, value: string) =>
    setForm((prev) => ({ ...prev, values: { ...prev.values, [name]: value } }))

  const setBoolean = (name: string, value: boolean) =>
    setForm((prev) => ({
      ...prev,
      booleans: { ...prev.booleans, [name]: value },
    }))

  const onModeChange = (value: string) =>
    setForm((prev) => ({ ...prev, mode: value as ProviderMode }))

  const secretMeta = (name: string) =>
    secretState.fields.find((f) => f.name === name)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading level="h2">{def.label}</Heading>
          {saved.configured ? (
            <Badge size="2xsmall" color={saved.is_enabled ? "green" : "orange"}>
              {saved.is_enabled ? "Configured" : "Disabled"}
            </Badge>
          ) : (
            <Badge size="2xsmall" color="grey">
              Not configured
            </Badge>
          )}
          {saved.configured && saved.mode ? (
            <Badge size="2xsmall">{saved.mode}</Badge>
          ) : null}
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          Updated {formatTimestamp(saved.updated_at)}
        </Text>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-4">
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            Mode
          </Label>
          <Select value={form.mode} onValueChange={onModeChange} disabled={pending}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="sandbox">Sandbox</Select.Item>
              <Select.Item value="production">Production</Select.Item>
            </Select.Content>
          </Select>
          {secretState.showReplaceWarning ? (
            <Text size="small" className="text-ui-fg-error">
              Switching mode replaces the saved {def.label} credentials — re-enter
              every secret to save.
            </Text>
          ) : null}
        </div>

        {def.fields.map((field) => {
          if (field.type === "boolean") {
            return (
              <div
                key={field.name}
                className="flex items-center justify-between gap-x-3"
              >
                <Label size="small" weight="plus" htmlFor={`${def.provider}-${field.name}`}>
                  {field.label}
                </Label>
                <Switch
                  id={`${def.provider}-${field.name}`}
                  checked={Boolean(form.booleans[field.name])}
                  onCheckedChange={(v) => setBoolean(field.name, v)}
                  disabled={pending}
                />
              </div>
            )
          }

          const meta = field.secret ? secretMeta(field.name) : undefined
          const required = field.secret ? Boolean(meta?.required) : !field.optional
          const savedMask = meta?.savedMask ?? null

          return (
            <div key={field.name} className="flex flex-col gap-y-2">
              <Label size="small" weight="plus" htmlFor={`${def.provider}-${field.name}`}>
                {field.label}
                {required ? " *" : ""}
              </Label>
              <Input
                id={`${def.provider}-${field.name}`}
                type={field.type === "password" ? "password" : "text"}
                autoComplete="off"
                value={form.values[field.name] ?? ""}
                placeholder={savedMask ?? field.placeholder ?? ""}
                onChange={(e) => setValue(field.name, e.target.value)}
                disabled={pending}
              />
              {field.secret && savedMask ? (
                <Text size="small" className="text-ui-fg-subtle">
                  Saved as {savedMask} — leave blank to keep it.
                </Text>
              ) : null}
            </div>
          )
        })}

        {testResult ? (
          <div className="flex flex-col gap-y-1 rounded-md bg-ui-bg-subtle px-4 py-3">
            <div className="flex items-center gap-x-2">
              {testResult.ok ? (
                <CheckCircleSolid className="text-ui-fg-interactive" />
              ) : (
                <XCircle className="text-ui-fg-error" />
              )}
              <Text size="small" weight="plus">
                {testResult.ok ? "Connection OK" : "Connection failed"}
              </Text>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {testResult.detail}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {def.probeLabel}
            </Text>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-x-2 px-6 py-4">
        <Button
          size="small"
          variant="secondary"
          onClick={() => testMutation.mutate()}
          isLoading={testMutation.isPending}
          disabled={pending}
        >
          Test connection
        </Button>
        <div className="flex items-center gap-x-2">
          {saved.configured ? (
            <Button
              size="small"
              variant="danger"
              onClick={() => clearMutation.mutate()}
              isLoading={clearMutation.isPending}
              disabled={pending}
            >
              Clear
            </Button>
          ) : null}
          <Button
            size="small"
            onClick={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending}
            disabled={pending}
          >
            Save
          </Button>
        </div>
      </div>
    </Container>
  )
}

export default ProviderPanel

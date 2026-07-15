/**
 * Shared probe contract (design §6). Probes are read-only (or
 * side-effect-minimal), bounded, best-effort authenticated calls. They NEVER
 * throw — every failure (HTTP error, network error, timeout) resolves to
 * `{ ok: false, detail }` so the workflow and UI can surface the reason.
 */

export interface ProbeResult {
  ok: boolean
  /** Human-readable reason, labeled best-effort where fidelity is limited. */
  detail: string
}

export interface ProbeOptions {
  /** Injectable fetch for unit tests (design §10 pattern). */
  fetchImpl?: typeof fetch
  /** Bounded probe interval; timeout reports as failure (spec Test Connection). */
  timeoutMs?: number
}

/** Probes must complete or time out within 8s (design §6). */
export const PROBE_TIMEOUT_MS = 8_000

export class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Probe timed out after ${timeoutMs}ms`)
    this.name = "ProbeTimeoutError"
  }
}

/**
 * fetch bounded by an AbortController. Rethrows abort as ProbeTimeoutError so
 * callers can produce a "timed out" detail.
 */
export async function probeFetch(
  url: string,
  init: RequestInit,
  options: ProbeOptions
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ProbeTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Maps thrown probe errors to a fail-safe ProbeResult.
 *
 * FIX 1 (info leak): the raw `error.message` (which may carry the probed host,
 * resolved IP, or other network detail) is logged SERVER-SIDE only and never
 * echoed into the admin-facing `detail`. The caller gets a generic reason.
 */
export function probeFailure(provider: string, error: unknown): ProbeResult {
  if (error instanceof ProbeTimeoutError) {
    return { ok: false, detail: `${provider} probe timed out.` }
  }
  const message = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error(`[provider-probe] ${provider} probe error: ${message}`)
  return {
    ok: false,
    detail: `${provider} probe failed (see server logs for details).`,
  }
}

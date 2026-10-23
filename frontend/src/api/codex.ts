export interface CodexModelsManifestResult {
  content: string
  modelCount: number
  responseBytes: number
}

const DEFAULT_CODEX_CLIENT_VERSION = '0.158.0'

function normalizeCodexBaseUrl(baseUrl: string): string {
  const fallback = typeof window !== 'undefined' ? window.location.origin : ''
  const value = (baseUrl || fallback).trim().replace(/\/+$/, '')
  if (!value) return '/v1'
  return /\/v1$/i.test(value) ? value : `${value}/v1`
}

export function buildCodexModelsManifestUrl(
  baseUrl: string,
  clientVersion = DEFAULT_CODEX_CLIENT_VERSION
): string {
  const params = new URLSearchParams({ client_version: clientVersion })
  return `${buildCodexModelCatalogUrl(baseUrl)}?${params.toString()}`
}

export function buildCodexModelCatalogUrl(baseUrl: string): string {
  return `${normalizeCodexBaseUrl(baseUrl)}/models`
}

function isCodexModelsManifest(value: unknown): value is { models: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { models?: unknown }).models)
}

export async function fetchCodexModelsManifest(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<CodexModelsManifestResult> {
  const response = await fetch(buildCodexModelsManifestUrl(baseUrl), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    cache: 'no-store',
    signal
  })

  if (!response.ok) {
    throw new Error(`Codex models request failed with status ${response.status}`)
  }

  const text = await response.text()
  const payload: unknown = JSON.parse(text)
  if (!isCodexModelsManifest(payload)) {
    throw new Error('Codex models response is not a valid manifest')
  }

  return {
    content: JSON.stringify(payload, null, 2),
    modelCount: payload.models.length,
    responseBytes: new TextEncoder().encode(text).byteLength
  }
}

/**
 * 拉取某个 API Key 所属分组的可用模型 ID（OpenAI 风格列表，不带
 * client_version，比 Codex manifest 轻量）。导入 CC Switch 时用它挑选
 * 分组真实可用的默认模型。
 */
export async function fetchApiKeyModelIds(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const response = await fetch(buildCodexModelCatalogUrl(baseUrl), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    cache: 'no-store',
    signal
  })

  if (!response.ok) {
    throw new Error(`Models request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new Error('Models response is not a valid list')
  }
  return data.flatMap(item => {
    const id = (item as { id?: unknown } | null)?.id
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  })
}

import type { GroupPlatform } from '@/types'
import { CODEX_PREFERRED_MODELS } from '@/constants/codexModelPreferences'
import { getPlatformSpec } from '@/constants/platformCatalog'

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'
export const GROK_CC_SWITCH_MODEL = 'grok-4.5'

export type CcSwitchClientType = 'claude' | 'codex' | 'gemini' | 'grokbuild'

export interface CcSwitchImportConfig {
  app: string
  endpoint: string
  model?: string
  /** Claude 导入时把 haiku/sonnet/opus 三档别名一并指向 model，避免 Claude Code
   * 用原生模型名请求不提供这些模型的分组时 404。 */
  modelAliases?: boolean
}

export interface CcSwitchImportDeeplinkInput {
  baseUrl: string
  platform?: GroupPlatform | null
  clientType: CcSwitchClientType
  providerName: string
  apiKey: string
  usageScript: string
  /** 用量查询开关，默认关闭。关闭时脚本仍随 deeplink 下发，CC Switch
   * 保存但不激活，之后可在 CC Switch 里一键打开。 */
  usageEnabled?: boolean
  /** 分组真实可用的模型名。国产模型与复合分组不提供原生 Claude/GPT 模型，
   * 不带模型导入后客户端首个请求即 404，导入时应尽量提供。 */
  model?: string
}

export interface CcSwitchClientOption {
  clientType: CcSwitchClientType
  /** CC Switch 侧的应用类型（deeplink 的 app 参数），用于界面标注。 */
  app: string
}

/**
 * Balance query CC Switch runs against the imported provider. CC Switch fills
 * `{{baseUrl}}` with the provider's base URL as stored — Codex and Grok imports
 * carry a trailing `/v1` (see `withV1Endpoint`), Claude ones do not, and users
 * may edit it either way afterwards — then evaluates the script, so the URL
 * strips an existing `/v1` instead of blindly appending one (`/v1/v1/usage`
 * is a 404 and CC Switch shows "query failed").
 */
export const CC_SWITCH_USAGE_SCRIPT = `({
    request: {
      url: "{{baseUrl}}".replace(/\\/+$/, "").replace(/\\/v1$/, "") + "/v1/usage",
      method: "GET",
      headers: { "Authorization": "Bearer {{apiKey}}" }
    },
    extractor: function(response) {
      const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;
      const unit = response?.unit ?? response?.quota?.unit ?? "USD";
      return {
        isValid: response?.is_active ?? response?.isValid ?? true,
        remaining,
        unit
      };
    }
  })`

function withV1Endpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`
}

function withoutTrailingSlashes(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 走 sub2api OpenAI 网关转发、且没有专属 CC Switch 应用的平台（国产厂商、
 * opencode_go、cline 等）以及复合分组：它们原生支持 `/v1/responses`，可以按
 * Codex（OpenAI Responses）方式导入，不再按 Claude 兜底。
 */
export function usesRoutedOpenAIGateway(platform: GroupPlatform | undefined | null): boolean {
  if (!platform) return false
  if (platform === 'composite') return true
  if (platform === 'openai' || platform === 'grok') return false
  return getPlatformSpec(platform)?.gateway === 'openai'
}

export interface CcSwitchClientOptionsInput {
  /** openai 分组开启 Messages 调度后才能把 Claude Code 指向它（/v1/messages 转发）。 */
  allowMessagesDispatch?: boolean
}

/** 平台可导入的 CC Switch 客户端列表；多于一个或需要挑模型时由用户选择。 */
export function listCcSwitchClientOptions(
  platform: GroupPlatform | undefined | null,
  input: CcSwitchClientOptionsInput = {}
): CcSwitchClientOption[] {
  switch (platform || 'anthropic') {
    case 'openai':
      return input.allowMessagesDispatch
        ? [
            { clientType: 'codex', app: 'codex' },
            { clientType: 'claude', app: 'claude' }
          ]
        : [{ clientType: 'codex', app: 'codex' }]
    case 'grok':
      return [{ clientType: 'grokbuild', app: 'grokbuild' }]
    case 'gemini':
      return [
        { clientType: 'gemini', app: 'gemini' },
        { clientType: 'codex', app: 'codex' }
      ]
    case 'antigravity':
      return [
        { clientType: 'claude', app: 'claude' },
        { clientType: 'gemini', app: 'gemini' }
      ]
    case 'composite':
      return [
        { clientType: 'codex', app: 'codex' },
        { clientType: 'claude', app: 'claude' },
        { clientType: 'gemini', app: 'gemini' }
      ]
    default:
      if (usesRoutedOpenAIGateway(platform)) {
        return [
          { clientType: 'codex', app: 'codex' },
          { clientType: 'claude', app: 'claude' }
        ]
      }
      return [{ clientType: 'claude', app: 'claude' }]
  }
}

/** 该平台导入时是否需要分组真实模型名（国产模型与复合分组不提供原生模型名；
 * openai / gemini 分组的 Codex 导入默认模型也随站点上游变化，需实际模型）。 */
export function ccSwitchImportNeedsModel(
  platform: GroupPlatform | undefined | null,
  clientType: CcSwitchClientType
): boolean {
  if (clientType !== 'claude' && clientType !== 'codex') return false
  if (usesRoutedOpenAIGateway(platform)) return true
  if (clientType !== 'codex') return false
  return platform === 'openai' || platform === 'gemini'
}

/** 从分组可用模型里挑导入默认模型：先按平台首选模型精确/前缀匹配，再退回首项。 */
export function pickCcSwitchModel(
  platform: GroupPlatform | undefined | null,
  models: string[]
): string {
  const normalized = models.map(model => model.trim()).filter(Boolean)
  const preferred = (platform && CODEX_PREFERRED_MODELS[platform])?.trim()
  if (preferred) {
    const exact = normalized.find(model => model === preferred)
    if (exact) return exact
    const lowered = preferred.toLowerCase()
    const partial = normalized.find(model => model.toLowerCase().includes(lowered))
    if (partial) return partial
  }
  return normalized[0] || preferred || ''
}

export function resolveCcSwitchImportConfig(
  platform: GroupPlatform | undefined | null,
  clientType: CcSwitchClientType,
  baseUrl: string,
  model?: string
): CcSwitchImportConfig {
  const resolvedModel = model?.trim() || undefined
  switch (platform || 'anthropic') {
    case 'antigravity':
      return {
        app: clientType === 'gemini' ? 'gemini' : 'claude',
        endpoint: `${baseUrl.replace(/\/+$/, '')}/antigravity`
      }
    case 'openai':
      // 开启 Messages 调度的 openai 分组也能接 Claude Code；claude-* 模型名由
      // 服务端映射，导入不带模型。Codex 则用分组真实模型（回落 gpt-5.5）。
      if (clientType === 'claude') {
        return {
          app: 'claude',
          endpoint: baseUrl
        }
      }
      return {
        app: 'codex',
        // CC Switch's Codex provider appends the OpenAI-compatible path itself.
        // Passing /v1 here can make the client request /v1/v1/....
        endpoint: withoutTrailingSlashes(baseUrl),
        model: resolvedModel || OPENAI_CC_SWITCH_CODEX_MODEL
      }
    case 'gemini':
      // Gemini 分组走网关的 Responses 桥也能接 Codex，模型用分组真实模型。
      if (clientType === 'codex') {
        return {
          app: 'codex',
          endpoint: withoutTrailingSlashes(baseUrl),
          model: resolvedModel || CODEX_PREFERRED_MODELS.gemini
        }
      }
      return {
        app: 'gemini',
        endpoint: baseUrl
      }
    case 'grok':
      return {
        app: 'grokbuild',
        endpoint: withV1Endpoint(baseUrl),
        model: GROK_CC_SWITCH_MODEL
      }
    default:
      break
  }

  if (!usesRoutedOpenAIGateway(platform)) {
    return {
      app: 'claude',
      endpoint: baseUrl
    }
  }

  // 国产厂商与复合分组：Codex 走 OpenAI Responses；Claude Code 走 sub2api 的
  // Anthropic 兼容层，两者都必须携带分组真实模型名，否则首个请求即 404。
  if (clientType === 'codex') {
    return {
      app: 'codex',
      endpoint: withoutTrailingSlashes(baseUrl),
      model: resolvedModel
    }
  }
  if (clientType === 'gemini') {
    return {
      app: 'gemini',
      endpoint: baseUrl
    }
  }
  return {
    app: 'claude',
    endpoint: baseUrl,
    model: resolvedModel,
    modelAliases: !!resolvedModel
  }
}

export function buildCcSwitchImportDeeplink(input: CcSwitchImportDeeplinkInput): string {
  const config = resolveCcSwitchImportConfig(input.platform, input.clientType, input.baseUrl, input.model)
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', config.app],
    ['name', input.providerName],
    ['homepage', input.baseUrl],
    ['endpoint', config.endpoint],
    ['apiKey', input.apiKey],
    ['configFormat', 'json'],
    ['usageEnabled', input.usageEnabled ? 'true' : 'false'],
    ['usageScript', btoa(input.usageScript)],
    ['usageAutoInterval', '30']
  ]

  if (config.model) {
    entries.splice(2, 0, ['model', config.model])
    if (config.modelAliases) {
      entries.splice(3, 0,
        ['haikuModel', config.model],
        ['sonnetModel', config.model],
        ['opusModel', config.model])
    }
  }

  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`
}

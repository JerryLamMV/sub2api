import { describe, expect, it } from 'vitest'
import {
  CC_SWITCH_USAGE_SCRIPT,
  GROK_CC_SWITCH_MODEL,
  OPENAI_CC_SWITCH_CODEX_MODEL,
  buildCcSwitchImportDeeplink,
  ccSwitchImportNeedsModel,
  listCcSwitchClientOptions,
  pickCcSwitchModel,
  resolveCcSwitchImportConfig
} from '@/utils/ccswitchImport'
import type { GroupPlatform } from '@/types'

function paramsFromDeeplink(deeplink: string): URLSearchParams {
  const query = deeplink.split('?')[1] || ''
  return new URLSearchParams(query)
}

describe('ccswitchImport utils', () => {
  it('defaults OpenAI CC Switch imports to the current Codex model', () => {
    expect(OPENAI_CC_SWITCH_CODEX_MODEL).toBe('gpt-5.5')
  })

  it('defaults Grok Build imports to the current Grok model', () => {
    expect(GROK_CC_SWITCH_MODEL).toBe('grok-4.5')
  })

  const baseInput = {
    baseUrl: 'https://api.example.com',
    providerName: 'Sub2API',
    apiKey: 'sk-test',
    usageScript: 'return true'
  }

  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1']
  ])('keeps Codex imports on the configured endpoint for base URL %s', (baseUrl, endpoint) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'openai',
        clientType: 'codex'
      })
    )

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(endpoint)
    expect(params.get('model')).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
    expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
  })

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/'
  ])('imports Grok Build with one /v1 suffix for base URL %s', (baseUrl) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'grok',
        clientType: 'claude'
      })
    )

    expect(params.get('app')).toBe('grokbuild')
    expect(params.get('endpoint')).toBe('https://api.example.com/v1')
    expect(params.get('model')).toBe(GROK_CC_SWITCH_MODEL)
  })

  it.each([
    { platform: 'anthropic' as GroupPlatform, clientType: 'claude' as const, app: 'claude' },
    { platform: 'gemini' as GroupPlatform, clientType: 'gemini' as const, app: 'gemini' }
  ])('does not add a model parameter for $platform imports', ({ platform, clientType, app }) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform,
        clientType
      })
    )

    expect(params.get('app')).toBe(app)
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.has('model')).toBe(false)
  })

  it('keeps Antigravity imports on the selected client endpoint without a model parameter', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'antigravity',
        clientType: 'gemini'
      })
    )

    expect(params.get('app')).toBe('gemini')
    expect(params.get('endpoint')).toBe(`${baseInput.baseUrl}/antigravity`)
    expect(params.has('model')).toBe(false)
  })

  it.each([
    'deepseek',
    'kimi',
    'zhipu',
    'minimax',
    'opencode_go',
    'command_code',
    'cline',
    'composite'
  ] as GroupPlatform[])('imports %s groups into the Codex app with the group model', (platform) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform,
        clientType: 'codex',
        model: 'cn:deepseek-v4.1-flash'
      })
    )

    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.get('model')).toBe('cn:deepseek-v4.1-flash')
    expect(params.has('haikuModel')).toBe(false)
  })

  it('imports CN provider groups into the Claude app with the model and its aliases', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'deepseek',
        clientType: 'claude',
        model: 'cn:deepseek-v4.1-flash'
      })
    )

    expect(params.get('app')).toBe('claude')
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.get('model')).toBe('cn:deepseek-v4.1-flash')
    expect(params.get('haikuModel')).toBe('cn:deepseek-v4.1-flash')
    expect(params.get('sonnetModel')).toBe('cn:deepseek-v4.1-flash')
    expect(params.get('opusModel')).toBe('cn:deepseek-v4.1-flash')
  })

  it('keeps composite gemini imports without a model parameter', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'composite',
        clientType: 'gemini',
        model: 'cn:deepseek-v4.1-flash'
      })
    )

    expect(params.get('app')).toBe('gemini')
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.has('model')).toBe(false)
  })

  it('omits the model parameter for CN codex imports without a known model', () => {
    expect(resolveCcSwitchImportConfig('deepseek', 'codex', 'https://api.example.com').model)
      .toBeUndefined()
  })


  describe('openai and gemini CC Switch imports', () => {
    it('imports openai groups as claude code without a model when dispatch is on', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'openai',
          clientType: 'claude',
          model: 'gpt-5.6-sol'
        })
      )

      expect(params.get('app')).toBe('claude')
      expect(params.get('endpoint')).toBe(baseInput.baseUrl)
      expect(params.has('model')).toBe(false)
      expect(params.has('haikuModel')).toBe(false)
    })

    it('imports openai groups as codex with the selected group model', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'openai',
          clientType: 'codex',
          model: 'gpt-5.6-sol'
        })
      )

      expect(params.get('app')).toBe('codex')
      expect(params.get('model')).toBe('gpt-5.6-sol')
    })

    it('imports gemini groups as codex with the group model', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'gemini',
          clientType: 'codex',
          model: 'gemini-2.5-pro'
        })
      )

      expect(params.get('app')).toBe('codex')
      expect(params.get('endpoint')).toBe(baseInput.baseUrl)
      expect(params.get('model')).toBe('gemini-2.5-pro')
    })

    it('falls back to the platform default model for gemini codex imports', () => {
      expect(resolveCcSwitchImportConfig('gemini', 'codex', 'https://api.example.com').model)
        .toBe('gemini-2.5-pro')
    })
  })

  describe('usage query toggle', () => {
    it('activates the usage query when the toggle is on', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'anthropic',
          clientType: 'claude',
          usageEnabled: true
        })
      )

      expect(params.get('usageEnabled')).toBe('true')
      expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
      expect(params.get('usageAutoInterval')).toBe('30')
    })

    // 关闭时脚本仍随 deeplink 下发：CC Switch 会保存但保持未启用，
    // 之后在 CC Switch 里一键打开即可，无需重新配置脚本。
    it('imports the usage script inactive when the toggle is off', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'anthropic',
          clientType: 'claude',
          usageEnabled: false
        })
      )

      expect(params.get('usageEnabled')).toBe('false')
      expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
      expect(params.get('usageAutoInterval')).toBe('30')
    })

    it('defaults the usage query to off when unspecified', () => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          platform: 'anthropic',
          clientType: 'claude'
        })
      )

      expect(params.get('usageEnabled')).toBe('false')
    })
  })
})

describe('CC Switch client options', () => {
  it('offers codex and claude for CN provider platforms', () => {
    expect(listCcSwitchClientOptions('deepseek').map(option => option.clientType))
      .toEqual(['codex', 'claude'])
    expect(listCcSwitchClientOptions('kimi').map(option => option.clientType))
      .toEqual(['codex', 'claude'])
  })

  it('offers codex, claude and gemini for composite groups', () => {
    expect(listCcSwitchClientOptions('composite').map(option => option.clientType))
      .toEqual(['codex', 'claude', 'gemini'])
  })

  it('keeps single-client platforms direct', () => {
    expect(listCcSwitchClientOptions('anthropic').map(option => option.clientType)).toEqual(['claude'])
    expect(listCcSwitchClientOptions('openai').map(option => option.clientType)).toEqual(['codex'])
    expect(listCcSwitchClientOptions('grok').map(option => option.clientType)).toEqual(['grokbuild'])
    expect(listCcSwitchClientOptions('antigravity').map(option => option.clientType))
      .toEqual(['claude', 'gemini'])
  })

  it('offers gemini and codex for gemini groups', () => {
    expect(listCcSwitchClientOptions('gemini').map(option => option.clientType))
      .toEqual(['gemini', 'codex'])
  })

  it('adds claude code for openai groups with messages dispatch enabled', () => {
    expect(listCcSwitchClientOptions('openai', { allowMessagesDispatch: true }).map(option => option.clientType))
      .toEqual(['codex', 'claude'])
  })

  it('only clients that need a real group model report it', () => {
    expect(ccSwitchImportNeedsModel('deepseek', 'codex')).toBe(true)
    expect(ccSwitchImportNeedsModel('composite', 'claude')).toBe(true)
    expect(ccSwitchImportNeedsModel('openai', 'codex')).toBe(true)
    expect(ccSwitchImportNeedsModel('openai', 'claude')).toBe(false)
    expect(ccSwitchImportNeedsModel('gemini', 'codex')).toBe(true)
    expect(ccSwitchImportNeedsModel('anthropic', 'claude')).toBe(false)
    expect(ccSwitchImportNeedsModel('gemini', 'gemini')).toBe(false)
  })
})

describe('pickCcSwitchModel', () => {
  it('prefers the platform model when the group exposes it exactly', () => {
    expect(pickCcSwitchModel('deepseek', ['cn:auto', 'deepseek-v4-pro', 'deepseek-v4.1-flash']))
      .toBe('deepseek-v4-pro')
  })

  it('falls back to a partial match for prefixed model names', () => {
    expect(pickCcSwitchModel('zhipu', ['cn:auto', 'cn:glm-4.7'])).toBe('cn:glm-4.7')
  })

  it('uses the first available model when nothing matches', () => {
    expect(pickCcSwitchModel('kimi', ['cn:auto', 'cn:kimi-k3-1'])).toBe('cn:auto')
  })

  it('falls back to the platform default when the model list is empty', () => {
    expect(pickCcSwitchModel('minimax', [])).toBe('MiniMax-M3')
    expect(pickCcSwitchModel('unknown-platform', [])).toBe('')
  })
})

describe('CC Switch usage script', () => {
  // Mirrors CC Switch: substitute the template vars as text, evaluate, read request.url.
  function usageUrlFor(baseUrl: string): string {
    const script = CC_SWITCH_USAGE_SCRIPT.split('{{baseUrl}}').join(baseUrl).split('{{apiKey}}').join('sk-test')
    // eslint-disable-next-line no-new-func
    const config = new Function(`return ${script}`)() as { request: { url: string } }
    return config.request.url
  }

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/'
  ])('queries exactly one /v1/usage for base URL %s', (baseUrl) => {
    expect(usageUrlFor(baseUrl)).toBe('https://api.example.com/v1/usage')
  })

  it('works against the endpoint every platform import stores', () => {
    for (const platform of ['anthropic', 'openai', 'grok', 'gemini'] as GroupPlatform[]) {
      const endpoint = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          baseUrl: 'https://api.example.com',
          platform,
          clientType: platform === 'gemini' ? 'gemini' : 'claude',
          providerName: 'Sub2API',
          apiKey: 'sk-test',
          usageScript: CC_SWITCH_USAGE_SCRIPT
        })
      ).get('endpoint') as string
      expect(usageUrlFor(endpoint)).toBe('https://api.example.com/v1/usage')
    }
  })
})

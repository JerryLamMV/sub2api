import type { GroupPlatform } from '@/types'

/**
 * 各平台作为 Codex 客户端接入时的首选模型名。
 *
 * 仅作默认值：分组的实际可用模型以站点为准（如国产模型分组常用带前缀的
 * 模型名），导入配置时应优先使用分组真实可用的模型，这里的值只在取不到
 * 模型列表时兜底。
 */
export const CODEX_PREFERRED_MODELS: Partial<Record<GroupPlatform, string>> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-pro',
  antigravity: 'claude-sonnet-4-6',
  grok: 'grok-4.5',
  kimi: 'kimi-k2.5',
  zhipu: 'glm-4.7',
  deepseek: 'deepseek-v4-pro',
  minimax: 'MiniMax-M3',
  opencode_go: 'glm-5.3',
  composite: 'gpt-5.5'
}

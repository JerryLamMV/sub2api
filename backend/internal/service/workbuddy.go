package service

import (
	"fmt"
	"net/url"
	"strings"
	"sync/atomic"
)

// WorkBuddy API：OpenAI 兼容端点，只提供 Chat Completions（{base}/chat/completions）
// 与模型列表（{base}/models）。Responses 与 Anthropic 入站由网关转换为 Chat Completions。
//
// WorkBuddy 是自建部署的服务，没有公开的官方域名，因此默认端点不编译进代码：
// 管理端通过 SettingKeyWorkbuddyBaseURL 下发（存库、运行时生效），未配置时该平台的
// 账号必须自己填写 credentials.base_url，且不会回落到任何官方端点。

// IsWorkbuddy 报告账号是否为 WorkBuddy 平台账号。
func (a *Account) IsWorkbuddy() bool {
	return a != nil && a.Platform == PlatformWorkbuddy
}

// workbuddyBaseURLResolver 是管理端设置提供的默认端点解析器。网关热路径拿不到 ctx，
// 因此注入无参解析器；解析器内部自带 60s TTL 缓存，热路径不触库（见 wire.go）。
var workbuddyBaseURLResolver atomic.Value // func() string

// SetWorkbuddyBaseURLResolver 注入 WorkBuddy 默认端点解析器。
func SetWorkbuddyBaseURLResolver(resolver func() string) {
	if resolver == nil {
		resolver = func() string { return "" }
	}
	workbuddyBaseURLResolver.Store(resolver)
}

// workbuddyBaseURLDefault 返回当前生效的 WorkBuddy 默认端点；未配置时为空串。
func workbuddyBaseURLDefault(protocol string) string {
	if protocol != APIProtocolChatCompletions {
		return ""
	}
	resolver, ok := workbuddyBaseURLResolver.Load().(func() string)
	if !ok || resolver == nil {
		return ""
	}
	return NormalizeWorkbuddyBaseURL(resolver())
}

// NormalizeWorkbuddyBaseURL 归一化 WorkBuddy 默认端点：去除首尾空白与尾部斜杠；
// 空串表示"未配置"，非法值同样归一化为空串。
func NormalizeWorkbuddyBaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	if parsed.Host == "" {
		return ""
	}
	return strings.TrimRight(trimmed, "/")
}

// ValidateWorkbuddyBaseURL 校验管理端提交的 WorkBuddy 默认端点：留空表示未配置，
// 非空时必须是 http/https 绝对地址。
func ValidateWorkbuddyBaseURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	if NormalizeWorkbuddyBaseURL(raw) == "" {
		return fmt.Errorf("%s must be an absolute http/https URL (e.g. http://127.0.0.1:7863)", SettingKeyWorkbuddyBaseURL)
	}
	return nil
}

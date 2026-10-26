//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/domain"
	"github.com/stretchr/testify/require"
)

// workbuddyTestAccount 只带 api_key：端点与协议全部来自 provider profile。
func workbuddyTestAccount(id int64) *Account {
	return &Account{
		ID:          id,
		Name:        "workbuddy",
		Platform:    PlatformWorkbuddy,
		Type:        AccountTypeAPIKey,
		Status:      StatusActive,
		Schedulable: true,
		Concurrency: 1,
		Credentials: map[string]any{"api_key": "workbuddy_test_key", "api_protocol": APIProtocolAdaptive},
	}
}

// setWorkbuddyBaseURLForTest 注入 WorkBuddy 默认端点解析器，用例结束后复位全局状态。
func setWorkbuddyBaseURLForTest(t *testing.T, baseURL string) {
	t.Helper()
	SetWorkbuddyBaseURLResolver(func() string { return baseURL })
	t.Cleanup(func() { SetWorkbuddyBaseURLResolver(nil) })
}

func TestWorkbuddyProfileSingleModeChatCompletionsOnly(t *testing.T) {
	setWorkbuddyBaseURLForTest(t, "")

	profile := LookupProviderProfile(PlatformWorkbuddy)
	require.NotNil(t, profile)
	require.Len(t, profile.Modes, 1)
	require.Equal(t, AccountModePayG, profile.DefaultMode)
	require.Equal(t, ProviderRoutingByInbound, profile.Routing)

	account := workbuddyTestAccount(1)
	require.True(t, account.IsWorkbuddy())
	require.True(t, account.IsMultiProtocolAPIKey())
	require.True(t, account.RoutesProtocolByInbound())
	require.False(t, account.routesByModel())
	// 未配置默认端点、账号也没有 base_url：空串，绝不回落到 OpenAI 官方域名。
	require.Empty(t, account.GetOpenAIBaseURL())
	require.Empty(t, account.GetOpenAIFormatBaseURL())
	// 只登记了 Chat Completions：Responses 与 Anthropic 入站都由网关转换。
	require.True(t, account.providerSupportsProtocol(APIProtocolChatCompletions))
	require.False(t, account.SupportsNativeCNResponses())
	require.False(t, account.providerSupportsProtocol(APIProtocolResponses))
	require.False(t, account.providerSupportsProtocol(APIProtocolAnthropic))
	for _, inbound := range []string{APIProtocolChatCompletions, APIProtocolResponses, APIProtocolAnthropic} {
		require.Equal(t, APIProtocolChatCompletions, resolveUpstreamProtocol(account, inbound, "workbuddy-model", nil), inbound)
	}
}

// 默认端点由管理端设置下发（自建部署没有公开官方域名）：配置后即生效，
// 且账号自带的 base_url 优先级更高。
func TestWorkbuddyBaseURLFromAdminSetting(t *testing.T) {
	setWorkbuddyBaseURLForTest(t, " http://192.168.50.95:7863/ ")

	account := workbuddyTestAccount(1)
	require.Equal(t, "http://192.168.50.95:7863", account.GetOpenAIBaseURL())
	require.Equal(t, "http://192.168.50.95:7863", account.GetOpenAIFormatBaseURL())
	require.Equal(t, "http://192.168.50.95:7863", account.GetCNProtocolBaseURL(APIProtocolChatCompletions))

	withCustom := workbuddyTestAccount(2)
	withCustom.Credentials["base_url"] = "http://relay.internal:9000/v1"
	require.Equal(t, "http://relay.internal:9000/v1", withCustom.GetOpenAIBaseURL())
	require.Equal(t, "http://relay.internal:9000/v1", withCustom.GetCNProtocolBaseURL(APIProtocolChatCompletions))
}

// 回归：收窄 OpenAI 官方回落只影响多协议供应商。openai 平台仍回落到官方域名，
// 其它供应商仍用自己的内置端点，WorkBuddy 的设置不会外溢。
func TestOpenAIBaseURLFallbackUnaffectedByWorkbuddy(t *testing.T) {
	setWorkbuddyBaseURLForTest(t, "http://192.168.50.95:7863")

	openAI := &Account{Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"api_key": "sk-test"}}
	require.Equal(t, "https://api.openai.com", openAI.GetOpenAIBaseURL())

	cline := &Account{Platform: PlatformCline, Type: AccountTypeAPIKey, Credentials: map[string]any{"api_key": "cline-test"}}
	require.Equal(t, DefaultClineBaseURL, cline.GetOpenAIBaseURL())
}

// 管理端设置读取走进程内缓存：第二次读取不再触库。
func TestWorkbuddyBaseURLSettingCachedRead(t *testing.T) {
	repo := &settingRepoStub{values: map[string]string{SettingKeyWorkbuddyBaseURL: "http://127.0.0.1:7863/"}}
	svc := NewSettingService(repo, &config.Config{})

	require.Equal(t, "http://127.0.0.1:7863", svc.GetWorkbuddyBaseURL(context.Background()))
	calls := repo.getMultipleCalls
	require.Positive(t, calls)
	require.Equal(t, "http://127.0.0.1:7863", svc.GetWorkbuddyBaseURL(context.Background()))
	require.Equal(t, calls, repo.getMultipleCalls, "缓存命中后不应再触库")

	// 未配置时为空串（设置项行不存在 → GetMultiple 返回空 map，不报错）。
	empty := NewSettingService(&settingRepoStub{values: map[string]string{}}, &config.Config{})
	require.Empty(t, empty.GetWorkbuddyBaseURL(context.Background()))

	// 读取失败也退化为空串，不阻塞网关热路径。
	failing := NewSettingService(&settingRepoStub{err: ErrSettingNotFound}, &config.Config{})
	require.Empty(t, failing.GetWorkbuddyBaseURL(context.Background()))
}

// 设置项写库前校验并归一化；留空表示"未配置"。
func TestWorkbuddyBaseURLSettingValidation(t *testing.T) {
	svc := NewSettingService(&settingRepoStub{values: map[string]string{}}, &config.Config{})

	settings := svc.parseSettings(map[string]string{})
	require.Empty(t, settings.WorkbuddyBaseURL, "默认未配置")

	settings.WorkbuddyBaseURL = "ftp://example.com"
	_, err := svc.buildSystemSettingsUpdates(context.Background(), settings)
	require.Error(t, err, "非 http/https 地址必须在写库前被拒绝")

	settings.WorkbuddyBaseURL = " http://127.0.0.1:7863/ "
	updates, err := svc.buildSystemSettingsUpdates(context.Background(), settings)
	require.NoError(t, err)
	require.Equal(t, "http://127.0.0.1:7863", updates[SettingKeyWorkbuddyBaseURL])

	settings.WorkbuddyBaseURL = ""
	updates, err = svc.buildSystemSettingsUpdates(context.Background(), settings)
	require.NoError(t, err)
	require.Equal(t, "", updates[SettingKeyWorkbuddyBaseURL], "留空即清除配置")

	parsed := svc.parseSettings(map[string]string{SettingKeyWorkbuddyBaseURL: "http://127.0.0.1:7863"})
	require.Equal(t, "http://127.0.0.1:7863", parsed.WorkbuddyBaseURL)
}

func TestNormalizeWorkbuddyBaseURL(t *testing.T) {
	cases := map[string]string{
		"":                             "",
		"   ":                          "",
		"http://127.0.0.1:7863":        "http://127.0.0.1:7863",
		" http://127.0.0.1:7863/ ":     "http://127.0.0.1:7863",
		"https://buddy.example.com/v1": "https://buddy.example.com/v1",
		"buddy.example.com":            "",
		"ftp://buddy.example.com":      "",
		"http://":                      "",
	}
	for input, want := range cases {
		require.Equal(t, want, NormalizeWorkbuddyBaseURL(input), input)
	}
}

// WorkBuddy 不是国产供应商：不参与余额 / Coding Plan 探测与用量窗口阈值的判定。
func TestWorkbuddyIsNotCNProvider(t *testing.T) {
	account := workbuddyTestAccount(1)
	require.False(t, account.IsCNProvider())
	require.False(t, IsCNProvider(PlatformWorkbuddy))
	require.Empty(t, account.GetCodingPlanProvider())
	require.Empty(t, account.GetAccountMode())
	require.NotContains(t, AllowedSchedulingThresholdPlatforms, PlatformWorkbuddy)
}

// 平台清单登记为 OpenAI 网关 + 未声明定价目录，模型列表按上游 /v1/models 拉取。
func TestWorkbuddyPlatformSpec(t *testing.T) {
	spec, ok := domain.LookupPlatform(PlatformWorkbuddy)
	require.True(t, ok)
	require.Equal(t, "WorkBuddy", spec.DisplayName)
	require.True(t, domain.UsesOpenAIGateway(PlatformWorkbuddy))
	require.Empty(t, spec.LiteLLMProvider)
	require.True(t, IsAllowedQuotaPlatform(PlatformWorkbuddy))
}

package service

import (
	"context"
	"log/slog"
	"time"
)

// cachedWorkbuddyBaseURL 缓存 WorkBuddy 默认端点（进程内缓存，60s TTL）。
type cachedWorkbuddyBaseURL struct {
	baseURL   string
	expiresAt int64 // unix nano
}

const (
	workbuddyBaseURLCacheTTL  = 60 * time.Second
	workbuddyBaseURLErrorTTL  = 5 * time.Second
	workbuddyBaseURLDBTimeout = 5 * time.Second
	workbuddyBaseURLSFKey     = "workbuddy_base_url"
)

// GetWorkbuddyBaseURL 返回 WorkBuddy 平台的默认端点（管理端设置 SettingKeyWorkbuddyBaseURL）。
// 未配置或读取失败时返回空串：此时 WorkBuddy 账号必须自带 credentials.base_url。
//
// 网关热路径（Account.GetOpenAIBaseURL → ProviderProfile.DefaultBaseURL）拿不到 ctx，
// 经 wire.go 注入的无参解析器调用本方法，因此这里必须走进程内缓存，不能每次都触库。
func (s *SettingService) GetWorkbuddyBaseURL(ctx context.Context) string {
	if s == nil || s.settingRepo == nil {
		return ""
	}
	if cached, ok := s.workbuddyBaseURLCache.Load().(*cachedWorkbuddyBaseURL); ok && cached != nil {
		if time.Now().UnixNano() < cached.expiresAt {
			return cached.baseURL
		}
	}

	result, _, _ := s.workbuddyBaseURLSF.Do(workbuddyBaseURLSFKey, func() (any, error) {
		if cached, ok := s.workbuddyBaseURLCache.Load().(*cachedWorkbuddyBaseURL); ok && cached != nil {
			if time.Now().UnixNano() < cached.expiresAt {
				return cached.baseURL, nil
			}
		}
		if ctx == nil {
			ctx = context.Background()
		}
		dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), workbuddyBaseURLDBTimeout)
		defer cancel()
		// 用 GetMultiple 而不是 GetValue：设置项未保存过时行不存在，GetValue 会返回
		// ErrSettingNotFound 并刷出告警日志，这里只需要把它当成"未配置"。
		values, err := s.settingRepo.GetMultiple(dbCtx, []string{SettingKeyWorkbuddyBaseURL})
		if err != nil {
			slog.Warn("failed to get workbuddy base url setting", "error", err)
			s.workbuddyBaseURLCache.Store(&cachedWorkbuddyBaseURL{
				expiresAt: time.Now().Add(workbuddyBaseURLErrorTTL).UnixNano(),
			})
			return "", nil
		}
		baseURL := NormalizeWorkbuddyBaseURL(values[SettingKeyWorkbuddyBaseURL])
		s.workbuddyBaseURLCache.Store(&cachedWorkbuddyBaseURL{
			baseURL:   baseURL,
			expiresAt: time.Now().Add(workbuddyBaseURLCacheTTL).UnixNano(),
		})
		return baseURL, nil
	})
	if baseURL, ok := result.(string); ok {
		return baseURL
	}
	return ""
}

// InvalidateWorkbuddyBaseURLCache 丢弃默认端点缓存，下次读取回源。
// 面板保存设置后调用，让改动立即生效而不是等 60s TTL 过期。
func (s *SettingService) InvalidateWorkbuddyBaseURLCache() {
	if s == nil {
		return
	}
	s.workbuddyBaseURLSF.Forget(workbuddyBaseURLSFKey)
	s.workbuddyBaseURLCache.Store((*cachedWorkbuddyBaseURL)(nil))
}

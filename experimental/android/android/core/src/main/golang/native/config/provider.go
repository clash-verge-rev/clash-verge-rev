package config

import (
	"io"

	"github.com/metacubex/mihomo/config"
)

const (
	PROXIES = "proxies"
	RULES   = "rules"
)

func forEachProviders(rawCfg *config.RawConfig, fun func(index int, total int, key string, provider map[string]any, prefix string)) {
	total := len(rawCfg.ProxyProvider) + len(rawCfg.RuleProvider)
	index := 0

	for k, v := range rawCfg.ProxyProvider {
		fun(index, total, k, v, PROXIES)

		index++
	}

	for k, v := range rawCfg.RuleProvider {
		fun(index, total, k, v, RULES)

		index++
	}
}

func destroyProviders(cfg *config.Config) {
	for _, p := range cfg.Providers {
		if p, ok := p.(io.Closer); ok {
			_ = p.Close()
		}
	}

	for _, p := range cfg.RuleProviders {
		if p, ok := p.(io.Closer); ok {
			_ = p.Close()
		}
	}
}

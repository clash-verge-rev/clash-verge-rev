package app

import (
	"github.com/dlclark/regexp2"

	"github.com/metacubex/mihomo/log"
)

var uiSubtitlePattern *regexp2.Regexp

func ApplySubtitlePattern(pattern string) {
	if pattern == "" {
		uiSubtitlePattern = nil

		return
	}

	if o := uiSubtitlePattern; o != nil && o.String() == pattern {
		return
	}

	reg, err := regexp2.Compile(pattern, regexp2.IgnoreCase|regexp2.Compiled)
	if err == nil {
		uiSubtitlePattern = reg
	} else {
		uiSubtitlePattern = nil

		log.Warnln("Compile ui-subtitle-pattern: %s", err.Error())
	}
}

func SubtitlePattern() *regexp2.Regexp {
	return uiSubtitlePattern
}

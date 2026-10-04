package tunnel

import (
	"github.com/metacubex/mihomo/tunnel"
)

func QueryMode() string {
	return tunnel.Mode().String()
}

package tunnel

import (
	"net/netip"
)

var loopback = netip.MustParseAddr("127.0.0.1")

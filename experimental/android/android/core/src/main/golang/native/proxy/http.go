package proxy

import (
	"sync"

	"github.com/metacubex/mihomo/listener/http"
	"github.com/metacubex/mihomo/tunnel"
)

var listener *http.Listener
var lock sync.Mutex

func Start(listen string) (listenAt string, err error) {
	lock.Lock()
	defer lock.Unlock()

	stopLocked()

	listener, err = http.NewWithAuthenticate(listen, tunnel.Tunnel, false)
	if err == nil {
		listenAt = listener.Address()
	}

	return
}

func Stop() {
	lock.Lock()
	defer lock.Unlock()

	stopLocked()
}

func stopLocked() {
	if listener != nil {
		listener.Close()
	}

	listener = nil
}

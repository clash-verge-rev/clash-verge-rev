// +build debug

package main

import (
	"net/http"
	_ "net/http/pprof"

	"github.com/metacubex/mihomo/log"
)

func init() {
	go func() {
		log.Debugln("pprof service listen at: 0.0.0.0:8888")

		_ = http.ListenAndServe("0.0.0.0:8888", nil)
	}()
}

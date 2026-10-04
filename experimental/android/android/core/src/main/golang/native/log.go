package main

//#include "bridge.h"
import "C"

import (
	"strings"
	"time"
	"unsafe"

	"github.com/metacubex/mihomo/log"
)

type message struct {
	Level   string `json:"level"`
	Message string `json:"message"`
	Time    int64  `json:"time"`
}

func init() {
	go func() {
		sub := log.Subscribe()
		defer log.UnSubscribe(sub)

		for msg := range sub {
			cPayload := C.CString(msg.Payload)

			switch msg.LogLevel {
			case log.INFO:
				C.log_info(cPayload)
			case log.ERROR:
				C.log_error(cPayload)
			case log.WARNING:
				C.log_warn(cPayload)
			case log.DEBUG:
				C.log_debug(cPayload)
			case log.SILENT:
				C.log_verbose(cPayload)
			}
		}
	}()
}

//export subscribeLogcat
func subscribeLogcat(remote unsafe.Pointer) {
	go func(remote unsafe.Pointer) {
		sub := log.Subscribe()
		defer log.UnSubscribe(sub)

		for msg := range sub {
			if msg.LogLevel < log.Level() && !strings.HasPrefix(msg.Payload, "[APP]") {
				continue
			}

			rMsg := &message{
				Level:   msg.LogLevel.String(),
				Message: msg.Payload,
				Time:    time.Now().UnixNano() / 1000 / 1000,
			}

			if C.logcat_received(remote, marshalJson(rMsg)) != 0 {
				C.release_object(remote)

				log.Debugln("Logcat subscriber closed")

				break
			}
		}
	}(remote)

	log.Infoln("[APP] Logcat level: %s", log.Level().String())
}

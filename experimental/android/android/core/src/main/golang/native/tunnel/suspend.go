package tunnel

func Suspend(s bool) {
	// cause by ACTION_SCREEN_OFF/ACTION_SCREEN_ON,
	// but we don't know what should do so just ignored.
	//
	// WARNING: don't call core's Tunnel.OnSuspend/OnRunning at here,
	// this will cause the core to stop processing new incoming connections when the screen is locked.
}

package config

var (
	defaultNameServers = []string{
		"223.5.5.5",
		"119.29.29.29",
		"8.8.4.4",
		"1.0.0.1",
	}
	defaultFakeIPFilter = []string{
		// Stun Services
		"+.stun.*.*",
		"+.stun.*.*.*",
		"+.stun.*.*.*.*",
		"+.stun.*.*.*.*.*",

		// Google Voices
		"lens.l.google.com",

		// Nintendo Switch STUN
		"*.n.n.srv.nintendo.net",

		// PlayStation STUN
		"+.stun.playstation.net",

		// XBox
		"xbox.*.*.microsoft.com",
		"*.*.xboxlive.com",

		// Microsoft Captive Portal
		"*.msftncsi.com",
		"*.msftconnecttest.com",

		// Bilibili CDN
		"*.mcdn.bilivideo.cn",

		// Windows Default LAN WorkGroup
		"WORKGROUP",
	}
	defaultFakeIPRange = "28.0.0.0/8"
)

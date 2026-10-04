// +build linux

package platform

import "syscall"

var nullFd int
var maxFdCount int

func init() {
	fd, err := syscall.Open("/dev/null", syscall.O_WRONLY, 0644)
	if err != nil {
		panic(err.Error())
	}

	nullFd = fd

	var limit syscall.Rlimit

	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &limit); err != nil {
		maxFdCount = 1024
	} else {
		maxFdCount = int(limit.Cur)
	}

	maxFdCount = maxFdCount / 4 * 3
}

func ShouldBlockConnection() bool {
	fd, err := syscall.Dup(nullFd)
	if err != nil {
		return true
	}

	_ = syscall.Close(fd)

	if fd > maxFdCount {
		return true
	}

	return false
}

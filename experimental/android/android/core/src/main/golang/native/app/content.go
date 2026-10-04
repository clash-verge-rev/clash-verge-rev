package app

import (
	"errors"
	"os"
	"syscall"
)

var openContentImpl = func(url string) (int, error) {
	return -1, errors.New("not implement")
}

func OpenContent(url string) (*os.File, error) {
	fd, err := openContentImpl(url)

	if err != nil {
		return nil, err
	}

	_ = syscall.SetNonblock(fd, true)

	return os.NewFile(uintptr(fd), "fd"), nil
}

func ApplyContentContext(openContent func(string) (int, error)) {
	openContentImpl = openContent
}

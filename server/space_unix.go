//go:build linux || darwin

package main

import "golang.org/x/sys/unix"

func freeSpace(dir string) (uint64, error) {
	var s unix.Statfs_t
	e := unix.Statfs(dir, &s)
	return uint64(s.Bavail) * uint64(s.Bsize), e
}

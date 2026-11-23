package main

import "golang.org/x/sys/windows"

func freeSpace(dir string) (uint64, error) {
	name, e := windows.UTF16PtrFromString(dir)
	if e != nil {
		return 0, e
	}
	var available uint64
	e = windows.GetDiskFreeSpaceEx(name, &available, nil, nil)
	return available, e
}

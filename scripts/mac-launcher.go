//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"syscall"
)

func main() {
	executable, err := os.Executable()
	if err != nil {
		panic(err)
	}
	contents := filepath.Dir(filepath.Dir(executable))
	engine := filepath.Join(contents, "Frameworks", "Electron.app", "Contents", "MacOS", "Electron")
	args := append([]string{engine, filepath.Join(contents, "Resources", "app")}, os.Args[1:]...)
	if err = syscall.Exec(engine, args, os.Environ()); err != nil {
		panic(err)
	}
}

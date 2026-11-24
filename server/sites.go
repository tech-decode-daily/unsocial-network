package main

import (
	"crypto/subtle"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	bolt "go.etcd.io/bbolt"
)

// A live site is an explicit, session-only grant to a directory on the host.
// Only the bundled desktop can grant one. Readers use ordinary room membership.
func (s *service) setSite(w http.ResponseWriter, r *http.Request) error {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.desktop || !net.ParseIP(host).IsLoopback() || subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.admin)) != 1 {
		return denied
	}
	id := r.PathValue("room")
	var in struct{ Folder string }
	if err := decode(w, r, &in); err != nil {
		return err
	}
	var root *os.Root
	if in.Folder != "" {
		if !filepath.IsAbs(in.Folder) {
			return fail(400, "Choose a website folder")
		}
		var err error
		root, err = os.OpenRoot(in.Folder)
		if err != nil {
			return fail(400, "Website folder is unavailable")
		}
		index, err := openAsset(root, "index.html")
		if err != nil {
			root.Close()
			return fail(400, "Choose a folder containing index.html")
		}
		index.Close()
	}
	err := s.db.View(func(tx *bolt.Tx) error {
		if _, _, err := rr(tx, id); err != nil {
			return err
		}
		s.replaceSite(id, root)
		return nil
	})
	if err != nil {
		if root != nil {
			root.Close()
		}
		return err
	}
	s.wake(id)
	return reply(w, true)
}

func (s *service) replaceSite(id string, root *os.Root) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old := s.sites[id]; old != nil {
		old.Close()
	}
	if root == nil {
		delete(s.sites, id)
		return
	}
	s.sites[id] = root
}

func openAsset(root *os.Root, asset string) (*os.File, error) {
	if asset == "" || strings.HasSuffix(asset, "/") {
		asset += "index.html"
	}
	if !fs.ValidPath(asset) || strings.ContainsAny(asset, "\\:\x00") {
		return nil, missing
	}
	// Serve web assets only. Never list folders, dotfiles or linked files.
	switch strings.ToLower(path.Ext(asset)) {
	case ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".wav", ".mp4", ".webm", ".wasm", ".webmanifest":
	default:
		return nil, missing
	}
	var prefix string
	for _, part := range strings.Split(asset, "/") {
		if strings.HasPrefix(part, ".") || strings.EqualFold(part, "node_modules") {
			return nil, missing
		}
		prefix = path.Join(prefix, part)
		info, err := root.Lstat(filepath.FromSlash(prefix))
		if err != nil || info.Mode()&os.ModeSymlink != 0 || (prefix == asset && !info.Mode().IsRegular()) {
			return nil, missing
		}
	}
	f, err := root.Open(filepath.FromSlash(asset))
	if err != nil {
		return nil, missing
	}
	return f, nil
}

func (s *service) siteAsset(w http.ResponseWriter, r *http.Request) error {
	var f *os.File
	err := s.change(r, false, func(_ *bolt.Bucket, rm room, _ member) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		root := s.sites[rm.ID]
		if root == nil {
			return missing
		}
		var err error
		f, err = openAsset(root, r.PathValue("asset"))
		return err
	})
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return missing
	}
	typ := mime.TypeByExtension(strings.ToLower(filepath.Ext(info.Name())))
	if typ == "" {
		typ = "application/octet-stream"
	}
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Content-Security-Policy", "sandbox")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

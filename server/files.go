package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	bolt "go.etcd.io/bbolt"
)

func diskErr(e error) error {
	if errors.Is(e, syscall.ENOSPC) {
		return fail(507, "Server storage is full")
	}
	return e
}
func (s *service) offer(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Name, Mime, Hash, Key string
		Size                  *int64
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if !safeName(in.Name) || len(in.Mime) > 200 || strings.ContainsAny(in.Mime, "\r\n") || !validHex(in.Hash, 64) || !validHex(in.Key, 32) || in.Size == nil || *in.Size < 0 {
		return fail(400, "Invalid filename, size or integrity metadata")
	}
	var f fileRec
	e := s.change(r, true, func(b *bolt.Bucket, _ room, m member) error {
		d := sub(b, "dedup")
		k := "file" + m.ID + in.Key
		if id := d.Get([]byte(k)); id != nil {
			return get(sub(b, "files"), string(id), &f)
		}
		f = fileRec{ID: secret(12), Name: in.Name, Mime: in.Mime, Hash: strings.ToLower(in.Hash), Sender: m.Name, Member: m.ID, Size: *in.Size, Time: time.Now().UnixMilli()}
		if e := put(sub(b, "files"), f.ID, f); e != nil {
			return e
		}
		return d.Put([]byte(k), []byte(f.ID))
	})
	if e != nil {
		return diskErr(e)
	}
	return reply(w, f)
}
func (s *service) record(r *http.Request, owner bool) (fileRec, error) {
	var f fileRec
	e := s.change(r, false, func(b *bolt.Bucket, _ room, m member) error {
		if e := get(sub(b, "files"), r.PathValue("file"), &f); e != nil {
			return e
		}
		if m.ID != f.Member && (owner || !f.Ready) {
			return missing
		}
		return nil
	})
	return f, e
}
func (s *service) info(w http.ResponseWriter, r *http.Request) error {
	f, e := s.record(r, false)
	if e != nil {
		return e
	}
	return reply(w, f)
}
func (s *service) lockFile(id string) func() {
	h := sha256.Sum256([]byte(id))
	mu := &s.locks[int(h[0])%len(s.locks)]
	mu.Lock()
	return mu.Unlock
}
func (s *service) appendChunk(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("file")
	unlock := s.lockFile(id)
	defer unlock()
	f, e := s.record(r, true)
	if e != nil {
		return e
	}
	offset, e := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	if e != nil || offset != f.Offset || f.Ready {
		return fail(409, "Refresh the acknowledged upload offset")
	}
	size := r.ContentLength
	hash := r.Header.Get("Chunk-SHA256")
	if size <= 0 || size > chunkLimit || size > f.Size-offset || !validHex(hash, 64) {
		return fail(400, "Invalid chunk length or digest")
	}
	release, e := s.reserve(uint64(size))
	if e != nil {
		return e
	}
	defer release()
	path := s.object(r.PathValue("room"), id)
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return diskErr(e)
	}
	out, e := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0600)
	if e != nil {
		return diskErr(e)
	}
	defer out.Close()
	stat, e := out.Stat()
	if e != nil {
		return e
	}
	if stat.Size() < offset {
		return fail(409, "Stored upload is incomplete. Cancel and retry")
	}
	if e = out.Truncate(offset); e != nil {
		return diskErr(e)
	}
	if _, e = out.Seek(offset, io.SeekStart); e != nil {
		return e
	}
	h := sha256.New()
	n, e := io.CopyN(io.MultiWriter(out, h), r.Body, size)
	if e != nil {
		if errors.Is(e, io.EOF) || errors.Is(e, io.ErrUnexpectedEOF) {
			return fail(400, "Chunk interrupted")
		}
		return diskErr(e)
	}
	if hex.EncodeToString(h.Sum(nil)) != strings.ToLower(hash) {
		return fail(422, "Chunk failed integrity verification")
	}
	if e = out.Sync(); e != nil {
		return diskErr(e)
	}
	f.Offset += n
	e = s.change(r, true, func(b *bolt.Bucket, _ room, _ member) error { return put(sub(b, "files"), id, f) })
	if e != nil {
		return diskErr(e)
	}
	return reply(w, f)
}
func (s *service) verify(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("file")
	unlock := s.lockFile(id)
	defer unlock()
	f, e := s.record(r, true)
	if e != nil {
		return e
	}
	if f.Ready {
		return reply(w, f)
	}
	if f.Offset != f.Size {
		return fail(409, "Upload has missing bytes")
	}
	path := s.object(r.PathValue("room"), id)
	if f.Size == 0 {
		if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			return diskErr(e)
		}
		p, e := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0600)
		if e != nil {
			return diskErr(e)
		}
		if e = p.Close(); e != nil {
			return e
		}
	}
	p, e := os.Open(path)
	if e != nil {
		return e
	}
	defer p.Close()
	h := sha256.New()
	n, e := io.Copy(h, p)
	if e != nil {
		return e
	}
	if n != f.Size || hex.EncodeToString(h.Sum(nil)) != f.Hash {
		return fail(422, "File failed SHA-256 verification. Cancel and select the source again")
	}
	f.Ready = true
	e = s.change(r, true, func(b *bolt.Bucket, _ room, m member) error {
		if e := put(sub(b, "files"), id, f); e != nil {
			return e
		}
		_, e := addEvent(b, "file", m, f.Name, id)
		return e
	})
	if e != nil {
		return diskErr(e)
	}
	s.wake(r.PathValue("room"))
	return reply(w, f)
}
func (s *service) cancel(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("file")
	unlock := s.lockFile(id)
	defer unlock()
	f, e := s.record(r, true)
	if e != nil {
		return e
	}
	if f.Ready {
		return fail(409, "File already published")
	}
	path := s.object(r.PathValue("room"), id)
	e = s.change(r, true, func(b *bolt.Bucket, _ room, _ member) error { return sub(b, "files").Delete([]byte(id)) })
	if e != nil {
		return e
	}
	// If unlinking fails, room expiration retries cleanup of the whole spool.
	if e = os.Remove(path); e != nil && !os.IsNotExist(e) {
		return e
	}
	return reply(w, true)
}
func (s *service) content(w http.ResponseWriter, r *http.Request) error {
	f, e := s.record(r, false)
	if e != nil {
		return e
	}
	if !f.Ready {
		return fail(409, "File is awaiting verification")
	}
	p, e := os.Open(s.object(r.PathValue("room"), f.ID))
	if e != nil {
		return e
	}
	defer p.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment")
	w.Header().Set("ETag", "\""+f.Hash+"\"")
	http.ServeContent(w, r, "attachment", time.UnixMilli(f.Time), p)
	return nil
}

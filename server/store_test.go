package main

import (
	"errors"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestStorageReserveAndRelease(t *testing.T) {
	s, e := openService(t.TempDir(), secret(32), time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	s.minFree = ^uint64(0)
	_, e = s.reserve(1)
	var p problem
	if !errors.As(e, &p) || p.status != 507 {
		t.Fatalf("storage pressure: %v", e)
	}
	s.minFree = 0
	release, e := s.reserve(chunkLimit)
	if e != nil {
		t.Fatal(e)
	}
	if s.reserved != chunkLimit {
		t.Fatal("reservation missing")
	}
	release()
	if s.reserved != 0 {
		t.Fatal("reservation leaked")
	}
}
func TestRetentionAndRate(t *testing.T) {
	s, e := openService(t.TempDir(), secret(32), time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	id := secret(12)
	e = s.db.Update(func(tx *bolt.Tx) error {
		b, e := subRoot(tx).CreateBucket([]byte(id))
		if e != nil {
			return e
		}
		return put(b, "meta", room{ID: id, Expires: time.Now().Add(-time.Hour).Unix()})
	})
	if e != nil {
		t.Fatal(e)
	}
	if e = os.MkdirAll(s.object(id, ""), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(s.object(id, "partial"), []byte("abc"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = s.sweep(); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(s.object(id, "")); !os.IsNotExist(e) {
		t.Fatal("expired object directory survived")
	}
	req := httptest.NewRequest("POST", "/rooms", nil)
	req.RemoteAddr = "127.0.0.1:35000"
	s.attempts = 2
	if !s.allow(req) || !s.allow(req) || s.allow(req) {
		t.Fatal("unexpected authentication rate result")
	}
}

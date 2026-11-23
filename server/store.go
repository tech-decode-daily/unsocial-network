package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	bolt "go.etcd.io/bbolt"
)

const chunkLimit = 4 << 20
const pageSize = 150

type room struct {
	ID, Name, InviteHash string
	Expires              int64
}
type member struct{ ID, Name, TokenHash string }
type participant struct {
	ID, Name string
	Online   bool
}
type event struct {
	Seq                              uint64
	Kind, Sender, Member, Text, File string
	Time                             int64
}
type fileRec struct {
	ID, Name, Mime, Hash, Sender, Member string
	Size, Offset, Time                   int64
	Ready                                bool
}
type problem struct {
	status int
	msg    string
}

func (e problem) Error() string         { return e.msg }
func fail(status int, msg string) error { return problem{status, msg} }

var missing = fail(404, "Room or resource unavailable")
var denied = fail(403, "Room credential rejected")

type rate struct {
	count int
	until time.Time
}
type service struct {
	db                *bolt.DB
	dir, admin        string
	ttl               time.Duration
	mu                sync.Mutex
	online            map[string]map[string]int
	signals           map[string]chan struct{}
	rates             map[string]rate
	locks             [97]sync.Mutex
	minFree, reserved uint64
	attempts          int
}

func openService(dir, admin string, ttl time.Duration) (*service, error) {
	if err := os.MkdirAll(filepath.Join(dir, "objects"), 0700); err != nil {
		return nil, err
	}
	db, err := bolt.Open(filepath.Join(dir, "rooms.db"), 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error { _, e := tx.CreateBucketIfNotExists([]byte("rooms")); return e })
	if err != nil {
		db.Close()
		return nil, err
	}
	return &service{db: db, dir: dir, admin: admin, ttl: ttl, minFree: 64 << 20, attempts: 90, online: map[string]map[string]int{}, signals: map[string]chan struct{}{}, rates: map[string]rate{}}, nil
}

// Account for independent chunk writers before admitting another disk write.
func (s *service) reserve(bytes uint64) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	available, err := freeSpace(s.dir)
	if err != nil {
		return nil, err
	}
	if available < s.minFree || available-s.minFree < s.reserved || available-s.minFree-s.reserved < bytes {
		return nil, fail(507, "Server disk reserve reached. Free space and resume")
	}
	s.reserved += bytes
	return func() { s.mu.Lock(); s.reserved -= bytes; s.mu.Unlock() }, nil
}
func secret(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func validHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	_, e := hex.DecodeString(s)
	return e == nil
}
func label(s string, n int) bool {
	return strings.TrimSpace(s) != "" && utf8.ValidString(s) && len(s) <= n && strings.IndexFunc(s, unicode.IsControl) < 0
}
func safeName(s string) bool {
	return label(s, 255) && s != "." && s != ".." && !strings.ContainsAny(s, "/\\:")
}
func put(b *bolt.Bucket, k string, v any) error {
	d, e := json.Marshal(v)
	if e != nil {
		return e
	}
	return b.Put([]byte(k), d)
}
func get(b *bolt.Bucket, k string, v any) error {
	d := b.Get([]byte(k))
	if d == nil {
		return missing
	}
	return json.Unmarshal(d, v)
}
func sub(b *bolt.Bucket, k string) *bolt.Bucket { return b.Bucket([]byte(k)) }
func rr(tx *bolt.Tx, id string) (*bolt.Bucket, room, error) {
	var r room
	b := sub(subRoot(tx), id)
	if b == nil {
		return nil, r, missing
	}
	if e := get(b, "meta", &r); e != nil {
		return nil, r, e
	}
	if time.Now().Unix() >= r.Expires {
		return nil, r, fail(410, "Room expired")
	}
	return b, r, nil
}
func subRoot(tx *bolt.Tx) *bolt.Bucket { return tx.Bucket([]byte("rooms")) }
func addEvent(b *bolt.Bucket, kind string, m member, msg, id string) (event, error) {
	events := sub(b, "events")
	seq, e := events.NextSequence()
	if e != nil {
		return event{}, e
	}
	row := event{seq, kind, m.Name, m.ID, msg, id, time.Now().UnixMilli()}
	return row, put(events, fmt.Sprintf("%020d", seq), row)
}
func auth(b *bolt.Bucket, token string) (member, error) {
	var m member
	if !validHex(token, 64) {
		return m, denied
	}
	id := sub(b, "tokens").Get([]byte(digest(token)))
	if id == nil {
		return m, denied
	}
	e := get(sub(b, "members"), string(id), &m)
	return m, e
}
func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
func (s *service) change(r *http.Request, write bool, fn func(*bolt.Bucket, room, member) error) error {
	op := s.db.View
	if write {
		op = s.db.Update
	}
	return op(func(tx *bolt.Tx) error {
		b, room, e := rr(tx, r.PathValue("room"))
		if e != nil {
			return e
		}
		m, e := auth(b, bearer(r))
		if e != nil {
			return e
		}
		return fn(b, room, m)
	})
}
func (s *service) wake(room string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.signals[room]; c != nil {
		close(c)
		delete(s.signals, room)
	}
}
func (s *service) watch(room string) <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.signals[room]
	if c == nil {
		c = make(chan struct{})
		s.signals[room] = c
	}
	return c
}
func (s *service) presence(room, id string, delta int) {
	s.mu.Lock()
	if s.online[room] == nil {
		s.online[room] = map[string]int{}
	}
	s.online[room][id] += delta
	if s.online[room][id] <= 0 {
		delete(s.online[room], id)
	}
	if len(s.online[room]) == 0 {
		delete(s.online, room)
	}
	s.mu.Unlock()
	s.wake(room)
}
func (s *service) participants(b *bolt.Bucket, id string) ([]participant, error) {
	out := []participant{}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := sub(b, "members").ForEach(func(_, v []byte) error {
		var m member
		if e := json.Unmarshal(v, &m); e != nil {
			return e
		}
		out = append(out, participant{m.ID, m.Name, s.online[id][m.ID] > 0})
		return nil
	})
	return out, e
}
func (s *service) object(room, id string) string { return filepath.Join(s.dir, "objects", room, id) }
func (s *service) sweep() error {
	var expired []string
	e := s.db.Update(func(tx *bolt.Tx) error {
		root := subRoot(tx)
		err := root.ForEach(func(k, _ []byte) error {
			var r room
			if e := get(sub(root, string(k)), "meta", &r); e != nil {
				return e
			}
			if time.Now().Unix() >= r.Expires {
				expired = append(expired, string(k))
			}
			return nil
		})
		if err != nil {
			return err
		}
		for _, id := range expired {
			if e := root.DeleteBucket([]byte(id)); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	for _, id := range expired {
		s.wake(id)
	}
	// A crash between metadata removal and unlinking is recovered by the next sweep.
	dirs, e := os.ReadDir(filepath.Join(s.dir, "objects"))
	if e != nil {
		return e
	}
	for _, d := range dirs {
		if !d.IsDir() || !validHex(d.Name(), 24) {
			continue
		}
		var exists bool
		e = s.db.View(func(tx *bolt.Tx) error { exists = sub(subRoot(tx), d.Name()) != nil; return nil })
		if e != nil {
			return e
		}
		if !exists {
			if e = os.RemoveAll(s.object(d.Name(), "")); e != nil {
				return e
			}
		}
	}
	return nil
}
func jsonError(w http.ResponseWriter, e error) {
	var p problem
	if !errors.As(e, &p) {
		p = problem{500, "Storage or service operation failed"}
	}
	w.WriteHeader(p.status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": p.msg})
}

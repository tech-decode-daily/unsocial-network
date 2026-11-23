package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	bolt "go.etcd.io/bbolt"
)

type handler func(http.ResponseWriter, *http.Request) error

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(&struct{}{}) != io.EOF {
		return fail(400, "Invalid or oversized JSON request")
	}
	return nil
}
func reply(w http.ResponseWriter, v any) error { return json.NewEncoder(w).Encode(v) }
func (s *service) router() http.Handler {
	mux := http.NewServeMux()
	route := func(pattern string, h handler) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Type", "application/json")
			if r.Header.Get("Origin") != "" {
				jsonError(w, denied)
				return
			}
			if e := h(w, r); e != nil {
				var p problem
				if !errors.As(e, &p) || p.status >= 500 {
					slog.Warn("request failed", "operation", pattern, "class", fmt.Sprintf("%T", e))
				}
				jsonError(w, e)
			}
		})
	}
	route("GET /health", func(w http.ResponseWriter, r *http.Request) error {
		return reply(w, map[string]any{"service": "unsocial-network", "protocol": 1})
	})
	route("POST /rooms", s.create)
	route("POST /rooms/{room}/join", s.join)
	route("GET /rooms/{room}/state", s.state)
	route("GET /rooms/{room}/events", s.events)
	route("POST /rooms/{room}/chat", s.chat)
	route("POST /rooms/{room}/leave", s.leave)
	route("POST /rooms/{room}/files", s.offer)
	route("GET /rooms/{room}/files/{file}", s.info)
	route("PATCH /rooms/{room}/files/{file}", s.appendChunk)
	route("POST /rooms/{room}/files/{file}/verify", s.verify)
	route("DELETE /rooms/{room}/files/{file}", s.cancel)
	route("GET /rooms/{room}/files/{file}/content", s.content)
	return mux
}
func (s *service) allow(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.rates {
		if now.After(v.until) {
			delete(s.rates, k)
		}
	}
	v := s.rates[host]
	if v.until.IsZero() {
		v.until = now.Add(time.Minute)
	}
	v.count++
	s.rates[host] = v
	return v.count <= s.attempts
}

type credentials struct {
	Room, Name, Member, Display, Token, Invite string
	Expires                                    int64
}

func enroll(b *bolt.Bucket, r room, name, invite string) (credentials, error) {
	if e := sub(b, "members").ForEach(func(_, v []byte) error {
		var m member
		if e := json.Unmarshal(v, &m); e != nil {
			return e
		}
		if strings.EqualFold(m.Name, name) {
			return fail(409, "This display name is in use in this room")
		}
		return nil
	}); e != nil {
		return credentials{}, e
	}
	token := secret(32)
	m := member{secret(12), name, digest(token)}
	if e := put(sub(b, "members"), m.ID, m); e != nil {
		return credentials{}, e
	}
	if e := sub(b, "tokens").Put([]byte(m.TokenHash), []byte(m.ID)); e != nil {
		return credentials{}, e
	}
	_, e := addEvent(b, "join", m, "", "")
	return credentials{r.ID, r.Name, m.ID, name, token, invite, r.Expires}, e
}
func (s *service) create(w http.ResponseWriter, r *http.Request) error {
	if !s.allow(r) {
		return fail(429, "Too many attempts. Try again in a minute")
	}
	if subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.admin)) != 1 {
		return denied
	}
	var in struct{ Name, Display string }
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if !label(in.Name, 100) || !label(in.Display, 80) {
		return fail(400, "Enter a room and display name")
	}
	invite := secret(32)
	room := room{secret(12), strings.TrimSpace(in.Name), digest(invite), time.Now().Add(s.ttl).Unix()}
	var out credentials
	e := s.db.Update(func(tx *bolt.Tx) error {
		b, e := subRoot(tx).CreateBucket([]byte(room.ID))
		if e != nil {
			return e
		}
		for _, k := range []string{"members", "tokens", "events", "files", "dedup"} {
			if _, e = b.CreateBucket([]byte(k)); e != nil {
				return e
			}
		}
		if e = put(b, "meta", room); e != nil {
			return e
		}
		out, e = enroll(b, room, strings.TrimSpace(in.Display), invite)
		return e
	})
	if e != nil {
		return e
	}
	return reply(w, out)
}
func (s *service) join(w http.ResponseWriter, r *http.Request) error {
	if !s.allow(r) {
		return fail(429, "Too many attempts. Try again in a minute")
	}
	var in struct{ Invite, Display string }
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if !label(in.Display, 80) {
		return fail(400, "Enter a display name")
	}
	var out credentials
	e := s.db.Update(func(tx *bolt.Tx) error {
		b, room, e := rr(tx, r.PathValue("room"))
		if e != nil {
			return e
		}
		if subtle.ConstantTimeCompare([]byte(digest(in.Invite)), []byte(room.InviteHash)) != 1 {
			return denied
		}
		out, e = enroll(b, room, strings.TrimSpace(in.Display), in.Invite)
		return e
	})
	if e != nil {
		return e
	}
	s.wake(out.Room)
	return reply(w, out)
}
func (s *service) leave(w http.ResponseWriter, r *http.Request) error {
	e := s.change(r, true, func(b *bolt.Bucket, _ room, m member) error {
		if e := sub(b, "tokens").Delete([]byte(m.TokenHash)); e != nil {
			return e
		}
		if e := sub(b, "members").Delete([]byte(m.ID)); e != nil {
			return e
		}
		_, e := addEvent(b, "leave", m, "", "")
		return e
	})
	if e != nil {
		return e
	}
	s.wake(r.PathValue("room"))
	return reply(w, true)
}
func (s *service) chat(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Text, Key string }
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if strings.TrimSpace(in.Text) == "" || len(in.Text) > 8000 || !validHex(in.Key, 32) {
		return fail(400, "Message or message identifier is invalid")
	}
	var out event
	e := s.change(r, true, func(b *bolt.Bucket, _ room, m member) error {
		d := sub(b, "dedup")
		k := m.ID + in.Key
		if v := d.Get([]byte(k)); v != nil {
			return json.Unmarshal(v, &out)
		}
		var e error
		out, e = addEvent(b, "chat", m, in.Text, "")
		if e != nil {
			return e
		}
		return put(d, k, out)
	})
	if e != nil {
		return e
	}
	s.wake(r.PathValue("room"))
	return reply(w, out)
}

type snapshot struct {
	Room, Name string
	Expires    int64
	Members    []participant
	Files      []fileRec
	Events     []event
	Cursor     uint64
	More       bool
}

func (s *service) readState(r *http.Request, after uint64, initial bool) (snapshot, error) {
	out := snapshot{Files: []fileRec{}, Events: []event{}}
	e := s.change(r, false, func(b *bolt.Bucket, room room, m member) error {
		out.Room = room.ID
		out.Name = room.Name
		out.Expires = room.Expires
		var e error
		out.Members, e = s.participants(b, room.ID)
		if e != nil {
			return e
		}
		if initial {
			if e = sub(b, "files").ForEach(func(_, v []byte) error {
				var f fileRec
				if e := json.Unmarshal(v, &f); e != nil {
					return e
				}
				if f.Ready {
					out.Files = append(out.Files, f)
				}
				return nil
			}); e != nil {
				return e
			}
		}
		bucket := sub(b, "events")
		if initial && bucket.Sequence() > pageSize {
			after = bucket.Sequence() - pageSize
		}
		out.Cursor = after
		c := bucket.Cursor()
		for k, v := c.Seek([]byte(fmt.Sprintf("%020d", after+1))); k != nil; k, v = c.Next() {
			if len(out.Events) == pageSize {
				out.More = true
				break
			}
			var ev event
			if e := json.Unmarshal(v, &ev); e != nil {
				return e
			}
			out.Events = append(out.Events, ev)
			out.Cursor = ev.Seq
		}
		return nil
	})
	return out, e
}
func (s *service) state(w http.ResponseWriter, r *http.Request) error {
	out, e := s.readState(r, 0, true)
	if e != nil {
		return e
	}
	return reply(w, out)
}
func (s *service) events(w http.ResponseWriter, r *http.Request) error {
	var id string
	if e := s.change(r, false, func(_ *bolt.Bucket, _ room, m member) error { id = m.ID; return nil }); e != nil {
		return e
	}
	cursor, e := strconv.ParseUint(r.URL.Query().Get("after"), 10, 63)
	if e != nil {
		return fail(400, "Invalid event cursor")
	}
	up := websocket.Upgrader{}
	conn, e := up.Upgrade(w, r, nil)
	if e != nil {
		return nil
	}
	defer conn.Close()
	roomID := r.PathValue("room")
	s.presence(roomID, id, 1)
	defer s.presence(roomID, id, -1)
	done := make(chan struct{})
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(50 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(50 * time.Second)) })
	go func() {
		defer close(done)
		for {
			if _, _, e := conn.ReadMessage(); e != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		wake := s.watch(roomID)
		out, e := s.readState(r, cursor, false)
		if e != nil {
			var p problem
			if errors.As(e, &p) {
				conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4003, p.msg), time.Now().Add(time.Second))
			}
			return nil
		}
		conn.SetWriteDeadline(time.Now().Add(12 * time.Second))
		if e = conn.WriteJSON(out); e != nil {
			return nil
		}
		cursor = out.Cursor
		if out.More {
			continue
		}
		select {
		case <-r.Context().Done():
			return nil
		case <-done:
			return nil
		case <-wake:
		case <-ticker.C:
			if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return nil
			}
		}
	}
}

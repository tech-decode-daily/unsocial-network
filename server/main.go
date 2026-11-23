package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func run() error {
	dir := flag.String("data", "room-data", "private data directory")
	bind := flag.String("listen", "", "listen address (default all IPv4 interfaces, persistent port)")
	public := flag.String("public-url", "", "HTTPS origin of a reverse proxy; upstream binds to loopback")
	desktop := flag.Bool("desktop", false, "stop when parent stdin closes")
	ttl := flag.Duration("ttl", 24*time.Hour, "room lifetime from creation")
	minFree := flag.Uint64("reserve-bytes", 64<<20, "minimum free spool space")
	attempts := flag.Int("auth-rate", 90, "create and join attempts per source IP per minute")
	advertise := flag.String("advertise", "", "LAN IPv4 address to include in invitations")
	flag.Parse()
	admin := os.Getenv("UNSOCIAL_ADMIN_TOKEN")
	if len(admin) < 32 {
		return errors.New("set UNSOCIAL_ADMIN_TOKEN to at least 32 random characters")
	}
	if *ttl <= 0 {
		return errors.New("room lifetime must be positive")
	}
	s, e := openService(*dir, admin, *ttl)
	if e != nil {
		return e
	}
	defer s.db.Close()
	if *attempts < 1 {
		return errors.New("auth-rate must be positive")
	}
	s.minFree = *minFree
	s.attempts = *attempts
	if e = s.sweep(); e != nil {
		return e
	}
	addr := *bind
	ips := hostIPs()
	ip := ips[0]
	if *advertise != "" {
		ip = net.ParseIP(*advertise)
		if ip == nil {
			return errors.New("invalid advertise IP")
		}
		ips = append(ips, ip)
	}
	origin := *public
	if origin != "" {
		u, e := url.Parse(origin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.Fragment != "" || u.RawQuery != "" {
			return errors.New("public-url must be an HTTPS origin")
		}
		if addr == "" {
			addr = "127.0.0.1:8484"
		}
		h, _, e := net.SplitHostPort(addr)
		if e != nil || !net.ParseIP(h).IsLoopback() {
			return errors.New("reverse proxy upstream must bind to loopback")
		}
	}
	if addr == "" {
		port := "0"
		if p, e := os.ReadFile(filepath.Join(*dir, "port")); e == nil {
			port = strings.TrimSpace(string(p))
		}
		addr = net.JoinHostPort("0.0.0.0", port)
	}
	l, e := net.Listen("tcp", addr)
	if e != nil {
		return e
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	ca := ""
	if origin == "" {
		var cert tls.Certificate
		cert, ca, e = identity(*dir, ips)
		if e != nil {
			return e
		}
		cfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		l = tls.NewListener(l, cfg)
		origin = "https://" + net.JoinHostPort(ip.String(), port)
		if *bind == "" {
			if e = os.WriteFile(filepath.Join(*dir, "port"), []byte(port), 0600); e != nil {
				return e
			}
		}
	}
	srv := &http.Server{Handler: s.router(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 5 * time.Minute, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *desktop {
		go func() { io.Copy(io.Discard, os.Stdin); stop() }()
	}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(l) }()
	json.NewEncoder(os.Stdout).Encode(map[string]string{"origin": origin, "ca": ca, "port": port})
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			return srv.Shutdown(ctx)
		case e := <-done:
			if errors.Is(e, http.ErrServerClosed) {
				return nil
			}
			return e
		case <-timer.C:
			if e := s.sweep(); e != nil {
				slog.Error("retention cleanup failed", "error", e.Error())
			}
		}
	}
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	if e := run(); e != nil {
		slog.Error("room server stopped", "error", fmt.Sprint(e))
		os.Exit(1)
	}
}

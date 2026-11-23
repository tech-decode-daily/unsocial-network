package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

func serial() (*big.Int, error) { return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 126)) }
func hostIPs() []net.IP {
	out := []net.IP{}
	ifs, _ := net.Interfaces()
	for _, n := range ifs {
		if n.Flags&net.FlagUp == 0 || n.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := n.Addrs()
		for _, a := range addrs {
			ip, _, e := net.ParseCIDR(a.String())
			if e == nil && ip.To4() != nil && !ip.IsLinkLocalUnicast() {
				out = append(out, ip)
			}
		}
	}
	return append(out, net.ParseIP("127.0.0.1"), net.IPv6loopback)
}
func identity(dir string, ips []net.IP) (tls.Certificate, string, error) {
	var empty tls.Certificate
	path := filepath.Join(dir, "host-identity.pem")
	raw, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if e != nil {
			return empty, "", e
		}
		n, e := serial()
		if e != nil {
			return empty, "", e
		}
		ca := &x509.Certificate{SerialNumber: n, Subject: pkix.Name{CommonName: "Unsocial Network room host"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, MaxPathLenZero: true, KeyUsage: x509.KeyUsageCertSign}
		der, e := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
		if e != nil {
			return empty, "", e
		}
		kb, e := x509.MarshalECPrivateKey(key)
		if e != nil {
			return empty, "", e
		}
		raw = append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})...)
		tmp, e := os.CreateTemp(dir, "identity-")
		if e != nil {
			return empty, "", e
		}
		defer os.Remove(tmp.Name())
		_, e = tmp.Write(raw)
		if e == nil {
			e = tmp.Sync()
		}
		ce := tmp.Close()
		if e == nil {
			e = ce
		}
		if e == nil {
			e = os.Rename(tmp.Name(), path)
		}
		if e != nil {
			return empty, "", e
		}
	} else if e != nil {
		return empty, "", e
	}
	cert, rest := pem.Decode(raw)
	key, _ := pem.Decode(rest)
	if cert == nil || key == nil {
		return empty, "", errors.New("invalid host identity")
	}
	ca, e := x509.ParseCertificate(cert.Bytes)
	if e != nil {
		return empty, "", e
	}
	priv, e := x509.ParseECPrivateKey(key.Bytes)
	if e != nil {
		return empty, "", e
	}
	leaf, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return empty, "", e
	}
	n, e := serial()
	if e != nil {
		return empty, "", e
	}
	t := &x509.Certificate{SerialNumber: n, Subject: pkix.Name{CommonName: "Room service"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(0, 3, 0), DNSNames: []string{"localhost"}, IPAddresses: ips, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, t, ca, &leaf.PublicKey, priv)
	if e != nil {
		return empty, "", e
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: leaf}, string(pem.EncodeToMemory(cert)), nil
}

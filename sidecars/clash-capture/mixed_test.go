package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/elazarl/goproxy"
	socks "golang.org/x/net/proxy"
)

func TestSOCKSHTTPSAndHTTPProxyShareListener(t *testing.T) {
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer origin.Close()
	s := testStore(t)
	s.settings.Enabled = true
	s.settings.All = true
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := newProxy(s, ca, "")
	if e != nil {
		t.Fatal(e)
	}
	roots := x509.NewCertPool()
	roots.AddCert(origin.Certificate())
	p.Tr.TLSClientConfig.RootCAs = roots
	p.Tr.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address == "127.0.0.1:443" {
			address = origin.Listener.Addr().String()
		}
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	mixed := newMixedListener(listener)
	server := &http.Server{Handler: p}
	go server.Serve(mixed)
	defer server.Close()
	dialer, e := socks.SOCKS5("tcp", listener.Addr().String(), nil, socks.Direct)
	if e != nil {
		t.Fatal(e)
	}
	caCert, e := x509.ParseCertificate(ca.Certificate[0])
	if e != nil {
		t.Fatal(e)
	}
	clientRoots := x509.NewCertPool()
	clientRoots.AddCert(caCert)
	client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.Dial(network, address)
	}, TLSClientConfig: &tls.Config{RootCAs: clientRoots}}}
	request(t, client, "https://127.0.0.1:443/")
	f := waitFlow(t, s)
	if f.Status != 200 {
		t.Fatal("SOCKS not captured")
	}
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer plain.Close()
	request(t, clientFor(t, "http://"+listener.Addr().String(), nil), plain.URL)
}
func TestProxyChainPreservesUpstream(t *testing.T) {
	var count atomic.Int32
	upstream := goproxy.NewProxyHttpServer()
	upstream.OnRequest().DoFunc(func(r *http.Request, c *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		count.Add(1)
		return r, nil
	})
	up := httptest.NewServer(upstream)
	defer up.Close()
	s := testStore(t)
	s.settings.Enabled = true
	s.settings.All = true
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := newProxy(s, ca, up.URL)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(p)
	defer server.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer origin.Close()
	request(t, clientFor(t, server.URL, nil), origin.URL)
	if count.Load() != 1 {
		t.Fatal("upstream bypassed")
	}
}

func TestSOCKSHTTPURLRule(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer origin.Close()
	s := testStore(t)
	s.settings.Enabled = true
	s.settings.Rules = []Rule{{1, "http://127.0.0.1/"}}
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := newProxy(s, ca, "")
	if e != nil {
		t.Fatal(e)
	}
	p.Tr.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, origin.Listener.Addr().String())
	}
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	server := &http.Server{Handler: p}
	go server.Serve(newMixedListener(l))
	defer server.Close()
	dialer, e := socks.SOCKS5("tcp", l.Addr().String(), nil, socks.Direct)
	if e != nil {
		t.Fatal(e)
	}
	client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, n, a string) (net.Conn, error) { return dialer.Dial(n, a) }}}
	request(t, client, "http://127.0.0.1/")
	if waitFlow(t, s).Status != 200 {
		t.Fatal("HTTP through SOCKS not captured")
	}
}

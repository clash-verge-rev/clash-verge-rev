package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"github.com/elazarl/goproxy"
	"io"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web/*
var assets embed.FS

// bodyLimit caps stored bytes per body; it must never limit bytes forwarded to the peer.
const bodyLimit = 1024 * 1024

type Rule struct {
	ID  int    `json:"id"`
	URL string `json:"url"`
}
type Settings struct {
	Enabled bool   `json:"enabled"`
	All     bool   `json:"capture_all"`
	Rules   []Rule `json:"rules"`
}

// UnmarshalJSON accepts the legacy "record_all" name so existing settings keep loading.
func (s *Settings) UnmarshalJSON(data []byte) error {
	type alias Settings
	var v struct {
		alias
		RecordAll bool `json:"record_all"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*s = Settings(v.alias)
	if v.RecordAll {
		s.All = true
	}
	return nil
}

type Body struct {
	Complete  bool        `json:"complete"`
	Headers   [][2]string `json:"headers"`
	Content   string      `json:"body"`
	Encoding  string      `json:"encoding"`
	Bytes     int64       `json:"bytes"`
	Truncated bool        `json:"truncated"`
}
type Summary struct {
	ID          string  `json:"id"`
	Time        float64 `json:"time"`
	Method      string  `json:"method"`
	URL         string  `json:"url"`
	Status      int     `json:"status"`
	Error       string  `json:"error"`
	ContentType string  `json:"content_type"`
	Bytes       int64   `json:"bytes"`
}

var commonMethods = []string{"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}

func isCommonMethod(method string) bool {
	for _, m := range commonMethods {
		if strings.EqualFold(method, m) {
			return true
		}
	}
	return false
}

func contentTypeKind(value string) string {
	kind := strings.ToLower(value)
	if i := strings.IndexByte(kind, ';'); i >= 0 {
		kind = kind[:i]
	}
	kind = strings.TrimSpace(kind)
	switch {
	case strings.Contains(kind, "html"):
		return "html"
	case strings.Contains(kind, "json"):
		return "json"
	case strings.HasPrefix(kind, "image/"):
		return "image"
	case strings.Contains(kind, "javascript") || strings.Contains(kind, "ecmascript"):
		return "script"
	case strings.Contains(kind, "css"):
		return "css"
	case strings.HasPrefix(kind, "font/") || strings.Contains(kind, "font-"):
		return "font"
	default:
		return "other"
	}
}

func matchStatus(filter string, f Summary) bool {
	switch filter {
	case "":
		return true
	case "success":
		return f.Status >= 200 && f.Status < 300
	case "redirect":
		return f.Status >= 300 && f.Status < 400
	case "client":
		return f.Status >= 400 && f.Status < 500
	case "server":
		return f.Status >= 500
	case "error":
		return f.Error != "" || f.Status >= 400
	case "failed":
		return f.Error != ""
	}
	return true
}

type Flow struct {
	Summary
	Request  *Body `json:"request"`
	Response *Body `json:"response"`
}
type Store struct {
	diskMu          sync.Mutex
	pending         map[string]*Flow
	pendingBytes    int
	dropped         uint64
	reportedDropped uint64
	prune           bool
	revision        uint64
	changed         chan struct{}
	stop            chan struct{}
	done            chan struct{}
	closed          bool
	closeOnce       sync.Once
	mu              sync.Mutex
	dir             string
	settings        Settings
	index           map[string]Summary
}

// Rename a complete temporary file so readers never observe partially written JSON.
func atomicJSON(path string, v any) error {
	data, e := json.Marshal(v)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".capture-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(data); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(f.Name(), path)
}

// Keep summaries in memory and a bounded set of pending body snapshots; older
// bodies are loaded from disk only when their details are requested.
func openStore(dir string) (*Store, error) {
	if e := os.MkdirAll(filepath.Join(dir, "flows"), 0700); e != nil {
		return nil, e
	}
	s := &Store{pending: map[string]*Flow{}, changed: make(chan struct{}), stop: make(chan struct{}), done: make(chan struct{}), dir: dir, index: map[string]Summary{}, settings: Settings{Rules: []Rule{}}}
	if b, e := os.ReadFile(filepath.Join(dir, "settings.json")); e == nil {
		if e = json.Unmarshal(b, &s.settings); e != nil {
			return nil, e
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	files, e := os.ReadDir(filepath.Join(dir, "flows"))
	if e != nil {
		return nil, e
	}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		b, e := os.ReadFile(filepath.Join(dir, "flows", file.Name()))
		if e != nil {
			return nil, e
		}
		var f Flow
		if e = json.Unmarshal(b, &f); e != nil {
			return nil, e
		}
		s.index[f.ID] = f.Summary
	}
	s.trimLocked()
	go s.writer()
	return s, nil
}
func (s *Store) config() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.settings
	v.Rules = append([]Rule{}, v.Rules...)
	return v
}

func host(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
}
func validRule(raw string) bool {
	if strings.Contains(raw, "://") {
		u, e := url.Parse(raw)
		return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && !strings.Contains(raw, "*")
	}
	raw = strings.TrimPrefix(raw, "*.")
	if !strings.Contains(raw, ".") || len(raw) > 253 {
		return false
	}
	for _, p := range strings.Split(raw, ".") {
		if len(p) == 0 || len(p) > 63 || strings.HasPrefix(p, "-") || strings.HasSuffix(p, "-") {
			return false
		}
		for _, c := range p {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}
func authority(u *url.URL) string {
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else if u.Scheme == "http" {
			port = "80"
		}
	}
	return net.JoinHostPort(strings.TrimSuffix(strings.ToLower(u.Hostname()), "."), port)
}

// CONNECT exposes only the host, so hostOnly decides whether TLS must be decrypted.
// After decryption the full path is checked again before a request is recorded.
func matchRule(rule, target string, hostOnly bool) bool {
	if strings.HasPrefix(rule, "*.") {
		return strings.HasSuffix(host(target), "."+rule[2:])
	}
	if !strings.Contains(rule, "://") {
		return host(target) == rule
	}
	r, e := url.Parse(rule)
	if e != nil {
		return false
	}
	u, e := url.Parse(target)
	if e != nil {
		return false
	}
	if hostOnly {
		return r.Scheme == u.Scheme && authority(r) == authority(u)
	}
	return r.Scheme == u.Scheme && authority(r) == authority(u) && strings.HasPrefix(u.Path, r.Path)
}
func (s *Store) matches(target string, hostOnly bool) bool {
	v := s.config()
	if !v.Enabled {
		return false
	}
	if v.All {
		return true
	}
	for _, r := range v.Rules {
		if matchRule(r.URL, target, hostOnly) {
			return true
		}
	}
	return false
}
func headers(h http.Header) [][2]string {
	v := [][2]string{}
	for k, values := range h {
		for _, val := range values {
			v = append(v, [2]string{k, val})
		}
	}
	return v
}

type activeFlow struct {
	mu sync.Mutex
	f  Flow
	s  *Store
}
type captureBody struct {
	io.ReadCloser
	mu      sync.Mutex
	a       *activeFlow
	request bool
	data    []byte
	size    int64
	once    sync.Once
}

// Tee the stream as the transport consumes it; buffering the entire body here
// would delay forwarding and break large downloads or long-lived responses.
func (b *captureBody) Read(p []byte) (int, error) {
	n, e := b.ReadCloser.Read(p)
	b.mu.Lock()
	b.size += int64(n)
	if len(b.data) < bodyLimit {
		take := n
		if take > bodyLimit-len(b.data) {
			take = bodyLimit - len(b.data)
		}
		b.data = append(b.data, p[:take]...)
	}
	b.mu.Unlock()
	if e != nil {
		b.finish(e)
	}
	return n, e
}
func (b *captureBody) Close() error { e := b.ReadCloser.Close(); b.finish(e); return e }

// EOF and Close can both finish a body. Publish exactly once, locking body state
// before flow state; persistence then takes the store lock in the same direction.
func (b *captureBody) finish(e error) {
	b.once.Do(func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.a.mu.Lock()
		defer b.a.mu.Unlock()
		v := b.a.f.Response
		if b.request {
			v = b.a.f.Request
		}
		v.Content = base64.StdEncoding.EncodeToString(b.data)
		v.Encoding = "base64"
		v.Bytes = b.size
		v.Truncated = b.size > bodyLimit
		// Replays must distinguish a finished empty body from an unfinished capture.
		v.Complete = e == io.EOF
		if !b.request {
			b.a.f.Bytes = b.size
		}
		if e != nil && e != io.EOF {
			b.a.f.Error = e.Error()
		}
		b.a.s.save(b.a.f, false)
	})
}

type certificateCache struct {
	mu    sync.Mutex
	certs map[string]*tls.Certificate
}

// Signing a leaf certificate is expensive. Serialize cache misses so concurrent
// connections to one host reuse a single certificate instead of signing repeatedly.
func (c *certificateCache) Fetch(host string, generate func() (*tls.Certificate, error)) (*tls.Certificate, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if cert := c.certs[host]; cert != nil {
		return cert, nil
	}
	cert, err := generate()
	if err == nil {
		c.certs[host] = cert
	}
	return cert, err
}
func newProxy(s *Store, ca tls.Certificate, upstream string) (*goproxy.ProxyHttpServer, error) {
	p := goproxy.NewProxyHttpServer()
	p.CertStore = &certificateCache{certs: map[string]*tls.Certificate{}}
	p.Tr = &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ForceAttemptHTTP2: true, MaxIdleConns: 100, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 30 * time.Second}
	// Avoid inheriting environment proxy settings for raw CONNECT tunnels.
	p.ConnectDial = nil
	if upstream != "" {
		u, e := url.Parse(upstream)
		if e != nil || u.Scheme != "http" || u.Host == "" {
			return nil, fmt.Errorf("upstream must be an http:// proxy")
		}
		p.Tr.Proxy = http.ProxyURL(u)
		p.ConnectDial = p.NewConnectDialToProxy(upstream)
	}
	// Clients trust this local CA; upstream TLS still uses normal server validation.
	action := &goproxy.ConnectAction{Action: goproxy.ConnectMitm, TLSConfig: goproxy.TLSConfigFromCA(&ca)}
	p.OnRequest().HandleConnect(goproxy.FuncHttpsHandler(func(h string, c *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
		// Arbitrary SOCKS TCP protocols must remain opaque, even when capture-all is on.
		if c.Req.Header.Get("X-Capture-Socks") == "1" {
			_, port, _ := net.SplitHostPort(h)
			if port != "80" && port != "443" && port != "8443" {
				return goproxy.OkConnect, h
			}
		}
		target := "https://" + h
		if strings.HasSuffix(h, ":80") {
			target = "http://" + h
		}
		if s.matches(target, true) {
			if strings.HasSuffix(h, ":80") {
				return &goproxy.ConnectAction{Action: goproxy.ConnectHTTPMitm}, h
			}
			return action, h
		}
		return goproxy.OkConnect, h
	}))
	p.OnRequest().DoFunc(func(r *http.Request, c *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		if r.URL.Scheme == "" && r.Host != "" {
			r.URL.Scheme = "http"
			r.URL.Host = r.Host
		}
		if !s.matches(r.URL.String(), false) {
			return r, nil
		}
		id := make([]byte, 16)
		if _, e := rand.Read(id); e != nil {
			return r, goproxy.NewResponse(r, goproxy.ContentTypeText, 500, "capture ID failed")
		}
		a := &activeFlow{s: s, f: Flow{Summary: Summary{ID: hex.EncodeToString(id), Time: float64(time.Now().UnixMilli()) / 1000, Method: r.Method, URL: r.URL.String()}, Request: &Body{Headers: headers(r.Header), Encoding: "base64", Complete: r.Body == nil || r.Body == http.NoBody}}}
		c.UserData = a
		s.save(a.f, true)
		if r.Body != nil {
			r.Body = &captureBody{ReadCloser: r.Body, a: a, request: true}
		}
		return r, nil
	})
	p.OnResponse().DoFunc(func(r *http.Response, c *goproxy.ProxyCtx) *http.Response {
		a, ok := c.UserData.(*activeFlow)
		if !ok {
			return r
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if r == nil {
			if c.Error != nil {
				a.f.Error = c.Error.Error()
			}
			a.s.save(a.f, false)
			return r
		}
		a.f.Status = r.StatusCode
		a.f.ContentType = r.Header.Get("Content-Type")
		a.f.Response = &Body{Headers: headers(r.Header), Encoding: "base64"}
		a.s.save(a.f, false)
		// A WebSocket upgrade needs a bidirectional body; the capture wrapper is read-only.
		if r.Body != nil && r.StatusCode != http.StatusSwitchingProtocols {
			r.Body = &captureBody{ReadCloser: r.Body, a: a}
		}
		return r
	})
	return p, nil
}

// Persist the CA across restarts: regenerating it would invalidate device trust.
// ca.pem contains the signing key as well as the certificate and must stay private.
func loadCA(dir string) (tls.Certificate, error) {
	path := filepath.Join(dir, "ca.pem")
	if b, e := os.ReadFile(path); e == nil {
		return tls.X509KeyPair(b, b)
	} else if !errors.Is(e, os.ErrNotExist) {
		return tls.Certificate{}, e
	}
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		return tls.Certificate{}, e
	}
	serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return tls.Certificate{}, e
	}
	cert := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Clash Verge Proxy"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(5, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	der, e := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if e != nil {
		return tls.Certificate{}, e
	}
	pub := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	priv := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if e = os.WriteFile(path, append(pub, priv...), 0600); e != nil {
		return tls.Certificate{}, e
	}
	return tls.X509KeyPair(pub, priv)
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func (s *Store) list(r *http.Request) []Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Summary{}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	d := strings.ToLower(r.URL.Query().Get("domain"))
	status := r.URL.Query().Get("status")
	kind := r.URL.Query().Get("type")
	method := strings.ToUpper(r.URL.Query().Get("method"))
	minBytes, _ := strconv.ParseInt(r.URL.Query().Get("min_bytes"), 10, 64)
	for _, f := range s.index {
		if d != "" && host(f.URL) != d {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(f.URL+" "+f.Method+" "+strconv.Itoa(f.Status)+" "+f.Error), q) {
			continue
		}
		switch {
		case method == "OTHER":
			if isCommonMethod(f.Method) {
				continue
			}
		case method != "":
			if !strings.EqualFold(f.Method, method) {
				continue
			}
		}
		if !matchStatus(status, f) {
			continue
		}
		if kind != "" && contentTypeKind(f.ContentType) != kind {
			continue
		}
		if minBytes > 0 && f.Bytes < minBytes {
			continue
		}
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Time == out[j].Time {
			return out[i].ID > out[j].ID
		}
		return out[i].Time > out[j].Time
	})
	return out
}
func apiHandler(s *Store, ca tls.Certificate, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth", func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("token")), []byte(token)) != 1 {
			http.Error(w, "Unauthorized", 401)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "capture_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", 303)
	})
	mux.HandleFunc("GET /certificate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-x509-ca-cert")
		w.Header().Set("Content-Disposition", "attachment; filename=clash-verge-proxy-ca.cer")
		w.Write(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.Certificate[0]}))
	})
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.config()) })
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Enabled   bool  `json:"enabled"`
			All       *bool `json:"capture_all"`
			RecordAll *bool `json:"record_all"` // legacy name kept for the old console
		}
		if json.NewDecoder(r.Body).Decode(&v) != nil {
			http.Error(w, "Invalid settings", 400)
			return
		}
		s.mu.Lock()
		next := s.settings
		next.Enabled = v.Enabled
		if v.All != nil {
			next.All = *v.All
		}
		if v.RecordAll != nil {
			next.All = *v.RecordAll
		}
		e := atomicJSON(filepath.Join(s.dir, "settings.json"), next)
		// Publish settings only after persistence succeeds, so a failed write changes no runtime state.
		if e == nil {
			s.settings = next
			s.changedLocked()
		}
		s.mu.Unlock()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		writeJSON(w, s.config())
	})
	mux.HandleFunc("POST /api/rules", func(w http.ResponseWriter, r *http.Request) {
		var v Rule
		if json.NewDecoder(r.Body).Decode(&v) != nil {
			http.Error(w, "Invalid rule", 400)
			return
		}
		v.URL = strings.TrimSpace(v.URL)
		if !strings.Contains(v.URL, "://") {
			v.URL = strings.ToLower(v.URL)
		}
		if !validRule(v.URL) {
			http.Error(w, "Enter a domain, wildcard domain, or HTTP/HTTPS URL prefix", 400)
			return
		}
		s.mu.Lock()
		max := 0
		for _, rule := range s.settings.Rules {
			if rule.URL == v.URL {
				s.mu.Unlock()
				writeJSON(w, s.config())
				return
			}
			if rule.ID > max {
				max = rule.ID
			}
		}
		v.ID = max + 1
		next := s.settings
		next.Rules = append(append([]Rule{}, s.settings.Rules...), v)
		e := atomicJSON(filepath.Join(s.dir, "settings.json"), next)
		// Publish settings only after persistence succeeds, so a failed write changes no runtime state.
		if e == nil {
			s.settings = next
			s.changedLocked()
		}
		s.mu.Unlock()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		writeJSON(w, s.config())
	})
	mux.HandleFunc("DELETE /api/rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		s.mu.Lock()
		next := s.settings
		next.Rules = append([]Rule{}, s.settings.Rules...)
		for i, v := range next.Rules {
			if v.ID == id {
				next.Rules = append(next.Rules[:i], next.Rules[i+1:]...)
				break
			}
		}
		e := atomicJSON(filepath.Join(s.dir, "settings.json"), next)
		// Publish settings only after persistence succeeds, so a failed write changes no runtime state.
		if e == nil {
			s.settings = next
			s.changedLocked()
		}
		s.mu.Unlock()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		writeJSON(w, s.config())
	})
	mux.HandleFunc("GET /api/flows", func(w http.ResponseWriter, r *http.Request) {
		items := s.list(r)
		total := len(items)
		pages := (total + 19) / 20
		if pages == 0 {
			pages = 1
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		if page > pages {
			page = pages
		}
		end := page * 20
		if end > total {
			end = total
		}
		writeJSON(w, map[string]any{"items": items[(page-1)*20 : end], "total": total, "page": page, "pages": pages, "page_size": 20, "retained_limit": historyLimit, "dropped": s.dropCount()})
	})
	mux.HandleFunc("GET /api/flows/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if len(id) != 32 {
			http.NotFound(w, r)
			return
		}
		if _, e := hex.DecodeString(id); e != nil {
			http.NotFound(w, r)
			return
		}
		data, e := s.readFlow(id)
		if e != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})
	mux.HandleFunc("GET /api/flow-count", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]int{"count": len(s.list(r))}) })
	mux.HandleFunc("GET /api/flow-domains", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		counts := map[string]int{}
		for _, v := range s.index {
			counts[host(v.URL)]++
		}
		s.mu.Unlock()
		keys := []string{}
		for k := range counts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := []map[string]any{}
		for _, k := range keys {
			out = append(out, map[string]any{"domain": k, "count": counts[k]})
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("DELETE /api/flows", func(w http.ResponseWriter, r *http.Request) {
		d := strings.ToLower(r.URL.Query().Get("domain"))
		count, err := s.clear(d)
		if err != nil {
			http.Error(w, "Failed to delete captures", 500)
			return
		}
		writeJSON(w, map[string]int{"deleted": count})
	})
	// Long polling carries only a revision. Coalesce bursts before the UI reloads
	// its current page, avoiding one IPC round trip per proxy event.
	mux.HandleFunc("GET /api/changes", func(w http.ResponseWriter, r *http.Request) {
		since, _ := strconv.ParseUint(r.URL.Query().Get("since"), 10, 64)
		s.mu.Lock()
		revision, changed := s.revision, s.changed
		s.mu.Unlock()
		if revision == since {
			select {
			case <-changed:
			case <-time.After(5 * time.Second):
			case <-r.Context().Done():
				return
			}
		}
		select {
		case <-time.After(50 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		s.mu.Lock()
		revision = s.revision
		s.mu.Unlock()
		writeJSON(w, map[string]uint64{"revision": revision})
	})
	web, _ := fs.Sub(assets, "web")
	mux.Handle("/", http.FileServer(http.FS(web)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/auth" {
			mux.ServeHTTP(w, r)
			return
		}
		// Desktop IPC uses Bearer auth; the standalone console also supports a local
		// session cookie and tokenized entry/certificate URLs. None may expose the CA key.
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if provided == "" && (r.URL.Path == "/" || r.URL.Path == "/certificate") {
			provided = r.URL.Query().Get("token")
		}
		if c, e := r.Cookie("capture_session"); e == nil && provided == "" {
			provided = c.Value
		}
		if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			http.Error(w, "Open the console through the desktop application", 401)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func main() {
	proxyAddr := flag.String("proxy", "127.0.0.1:17891", "local proxy address")
	apiAddr := flag.String("api", "127.0.0.1:17892", "loopback admin address")
	dir := flag.String("data", "", "persistent data directory")
	upstream := flag.String("upstream", "", "HTTP upstream, e.g. http://127.0.0.1:7890")
	flag.Parse()
	if *dir == "" {
		base, e := os.UserConfigDir()
		if e != nil {
			log.Fatal(e)
		}
		*dir = filepath.Join(base, "clash-capture")
	}
	for _, addr := range []string{*proxyAddr, *apiAddr} {
		h, _, e := net.SplitHostPort(addr)
		if e != nil || net.ParseIP(h) == nil || !net.ParseIP(h).IsLoopback() {
			log.Fatal("only loopback listening is supported")
		}
	}
	s, e := openStore(*dir)
	if e != nil {
		log.Fatal(e)
	}
	defer s.close()
	ca, e := loadCA(*dir)
	if e != nil {
		log.Fatal(e)
	}
	random := make([]byte, 32)
	if _, e = rand.Read(random); e != nil {
		log.Fatal(e)
	}
	token := hex.EncodeToString(random)
	if e = os.WriteFile(filepath.Join(*dir, "api-token"), []byte(token), 0600); e != nil {
		log.Fatal(e)
	}
	p, e := newProxy(s, ca, *upstream)
	if e != nil {
		log.Fatal(e)
	}
	lp, e := net.Listen("tcp", *proxyAddr)
	if e != nil {
		log.Fatal(e)
	}
	defer lp.Close()
	la, e := net.Listen("tcp", *apiAddr)
	if e != nil {
		log.Fatal(e)
	}
	defer la.Close()
	ps := &http.Server{Handler: p, ReadHeaderTimeout: 15 * time.Second}
	as := &http.Server{Handler: apiHandler(s, ca, token), ReadHeaderTimeout: 10 * time.Second}
	done := make(chan error, 2)
	go func() { done <- ps.Serve(newMixedListener(lp)) }()
	go func() { done <- as.Serve(la) }()
	log.Printf("proxy=%s admin=%s token-file=%s", *proxyAddr, *apiAddr, filepath.Join(*dir, "api-token"))
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case <-signals:
	case e = <-done:
		if e != http.ErrServerClosed {
			log.Print(e)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	as.Shutdown(ctx)
	ps.Shutdown(ctx)
}

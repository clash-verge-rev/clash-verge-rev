package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := openStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.close)
	return s
}
func clientFor(t *testing.T, proxy string, roots *x509.CertPool) *http.Client {
	t.Helper()
	u, e := url.Parse(proxy)
	if e != nil {
		t.Fatal(e)
	}
	return &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(u), TLSClientConfig: &tls.Config{RootCAs: roots}, DisableKeepAlives: true}, Timeout: 5 * time.Second}
}
func request(t *testing.T, c *http.Client, u string) {
	t.Helper()
	r, e := c.Post(u, "text/plain", strings.NewReader("request-body"))
	if e != nil {
		t.Fatal(e)
	}
	defer r.Body.Close()
	b, e := io.ReadAll(r.Body)
	if e != nil || r.StatusCode != 200 || string(b) != "reply:request-body" {
		t.Fatalf("response %d %q %v", r.StatusCode, b, e)
	}
}
func waitFlow(t *testing.T, s *Store) Flow {
	t.Helper()
	for n := 0; n < 100; n++ {
		s.mu.Lock()
		for id := range s.index {
			b, _ := os.ReadFile(filepath.Join(s.dir, "flows", id+".json"))
			var f Flow
			json.Unmarshal(b, &f)
			if f.Response != nil && f.Response.Bytes > 0 {
				s.mu.Unlock()
				return f
			}
		}
		s.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("record not completed")
	return Flow{}
}
func TestHTTPRecordAndSwitch(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer origin.Close()
	s := testStore(t)
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := newProxy(s, ca, "")
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(p)
	defer server.Close()
	client := clientFor(t, server.URL, nil)
	request(t, client, origin.URL)
	if len(s.index) != 0 {
		t.Fatal("disabled traffic was recorded")
	}
	s.settings.Enabled = true
	s.settings.Rules = []Rule{{1, "https://missing.example"}}
	request(t, client, origin.URL)
	if len(s.index) != 0 {
		t.Fatal("unmatched traffic was recorded")
	}
	s.settings.All = true
	request(t, client, origin.URL)
	f := waitFlow(t, s)
	req, _ := base64.StdEncoding.DecodeString(f.Request.Content)
	resp, _ := base64.StdEncoding.DecodeString(f.Response.Content)
	if !f.Request.Complete {
		t.Fatal("finished request body must be marked complete for replay")
	}
	if string(req) != "request-body" || string(resp) != "reply:request-body" {
		t.Fatalf("bad bodies: %q %q", req, resp)
	}
	restored, e := openStore(s.dir)
	if e != nil || len(restored.index) != 1 {
		t.Fatal("record not persistent", e)
	}
}
func TestHTTPSMITMAndDisabledTunnel(t *testing.T) {
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprint(w, "reply:"+string(b))
	}))
	defer origin.Close()
	s := testStore(t)
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := newProxy(s, ca, "")
	if e != nil {
		t.Fatal(e)
	}
	originRoots := x509.NewCertPool()
	originRoots.AddCert(origin.Certificate())
	p.Tr.TLSClientConfig.RootCAs = originRoots
	server := httptest.NewServer(p)
	defer server.Close()
	// With recording off, only the origin CA is trusted. A MITM here would fail.
	request(t, clientFor(t, server.URL, originRoots), origin.URL)
	if len(s.index) != 0 {
		t.Fatal("tunnel traffic recorded")
	}
	s.settings.Enabled = true
	s.settings.All = true
	captureRoots := x509.NewCertPool()
	cert, e := x509.ParseCertificate(ca.Certificate[0])
	if e != nil {
		t.Fatal(e)
	}
	captureRoots.AddCert(cert)
	request(t, clientFor(t, server.URL, captureRoots), origin.URL)
	f := waitFlow(t, s)
	if f.Status != 200 {
		t.Fatal(f.Status)
	}
	// An untrusted origin must still be rejected by the module.
	p.Tr.CloseIdleConnections()
	p.Tr.TLSClientConfig = &tls.Config{RootCAs: x509.NewCertPool()}
	r, e := clientFor(t, server.URL, captureRoots).Get(origin.URL)
	if e == nil {
		defer r.Body.Close()
		if r.StatusCode == 200 {
			t.Fatal("untrusted upstream accepted")
		}
	}
}
func TestAdminPaginationDeletionAndToken(t *testing.T) {
	s := testStore(t)
	ca, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(apiHandler(s, ca, "secret"))
	defer server.Close()
	r, e := http.Get(server.URL + "/api/flows")
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatal("admin open without token")
	}
	for i := 0; i < 25; i++ {
		s.save(Flow{Summary: Summary{ID: fmt.Sprintf("%032x", i+1), URL: "https://api.example.com/test", Time: float64(i)}}, true)
	}
	s.save(Flow{Summary: Summary{ID: fmt.Sprintf("%032x", 100), URL: "https://api.example.com.evil.com/test", Time: 100}}, true)
	call := func(method, path string) map[string]any {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, nil)
		req.Header.Set("Authorization", "Bearer secret")
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal(resp.StatusCode)
		}
		var v map[string]any
		if e = json.NewDecoder(resp.Body).Decode(&v); e != nil {
			t.Fatal(e)
		}
		return v
	}
	first := call("GET", "/api/flows?domain=api.example.com")
	last := call("GET", "/api/flows?domain=api.example.com&page=2")
	if len(first["items"].([]any)) != 20 || len(last["items"].([]any)) != 5 {
		t.Fatal("pagination")
	}
	if call("DELETE", "/api/flows?domain=api.example.com")["deleted"].(float64) != 25 {
		t.Fatal("clear count")
	}
	if len(s.index) != 1 {
		t.Fatal("domain boundary")
	}
	// A body finishing after deletion must not resurrect the row.
	s.save(Flow{Summary: Summary{ID: fmt.Sprintf("%032x", 1)}}, false)
	if len(s.index) != 1 {
		t.Fatal("deleted row resurrected")
	}
}
func TestWildcardRulesAndCAReuse(t *testing.T) {
	for _, u := range []string{"https://a.example.com/a", "http://a.b.example.com:80/x"} {
		if !matchRule("*.example.com", u, false) {
			t.Fatal(u)
		}
	}
	for _, u := range []string{"https://example.com", "https://notexample.com", "https://a.example.com.evil.com"} {
		if matchRule("*.example.com", u, false) {
			t.Fatal(u)
		}
	}
	s := testStore(t)
	a, e := loadCA(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	b, e := loadCA(s.dir)
	if e != nil || string(a.Certificate[0]) != string(b.Certificate[0]) {
		t.Fatal("CA rotated on reload", e)
	}
}
func TestCaptureLimitDoesNotTruncateForwarding(t *testing.T) {
	s := testStore(t)
	a := &activeFlow{s: s, f: Flow{Summary: Summary{ID: strings.Repeat("a", 32)}, Response: &Body{}}}
	s.save(a.f, true)
	body := strings.Repeat("x", bodyLimit+100)
	reader := &captureBody{ReadCloser: io.NopCloser(strings.NewReader(body)), a: a}
	got, e := io.ReadAll(reader)
	if e != nil || string(got) != body {
		t.Fatal("forwarding was truncated")
	}
	if !a.f.Response.Truncated || a.f.Response.Bytes != int64(len(body)) {
		t.Fatal("capture size metadata")
	}
}

func TestURLRuleDefaultPorts(t *testing.T) {
	for _, u := range []string{"https://example.com:443/api/x", "https://EXAMPLE.com/api/x"} {
		if !matchRule("https://example.com/api/", u, false) {
			t.Fatal(u)
		}
	}
	for _, u := range []string{"http://example.com/api/x", "https://example.com:444/api/x", "https://example.com/other"} {
		if matchRule("https://example.com/api/", u, false) {
			t.Fatal(u)
		}
	}
	if !matchRule("https://example.com/api/", "https://example.com:443", true) {
		t.Fatal("CONNECT rule did not match default port")
	}
}

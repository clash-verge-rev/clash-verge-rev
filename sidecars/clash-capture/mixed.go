package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
)

type bufferedConn struct {
	net.Conn
	reader io.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// socksConn presents a synthetic HTTP CONNECT to goproxy while translating its
// initial HTTP response back into the SOCKS5 handshake expected by the client.
type socksConn struct {
	bufferedConn
	pending []byte
	ready   bool
}

func (c *socksConn) Write(p []byte) (int, error) {
	if c.ready {
		return c.Conn.Write(p)
	}
	// Headers can span writes, and the final write may already contain tunnel bytes.
	c.pending = append(c.pending, p...)
	if len(c.pending) > 8192 {
		return 0, fmt.Errorf("CONNECT response too large")
	}
	i := bytes.Index(c.pending, []byte("\r\n\r\n"))
	if i < 0 {
		return len(p), nil
	}
	code := byte(1)
	parts := strings.Fields(string(c.pending[:i]))
	if len(parts) > 1 && parts[1] == "200" {
		code = 0
	}
	if _, e := c.Conn.Write([]byte{5, code, 0, 1, 0, 0, 0, 0, 0, 0}); e != nil {
		return 0, e
	}
	c.ready = true
	if len(c.pending) > i+4 {
		if _, e := c.Conn.Write(c.pending[i+4:]); e != nil {
			return 0, e
		}
	}
	c.pending = nil
	return len(p), nil
}

// Peek without consuming payload bytes: HTTP and SOCKS5 share the system-proxy port.
// Only negotiation has a deadline; established tunnels may legitimately stay idle.
func protocolConn(c net.Conn) (net.Conn, error) {
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(c)
	first, e := r.Peek(1)
	if e != nil {
		return nil, e
	}
	if first[0] != 5 {
		c.SetReadDeadline(time.Time{})
		return &bufferedConn{c, r}, nil
	}
	header := make([]byte, 2)
	if _, e = io.ReadFull(r, header); e != nil {
		return nil, e
	}
	methods := make([]byte, int(header[1]))
	if _, e = io.ReadFull(r, methods); e != nil {
		return nil, e
	}
	supported := false
	for _, m := range methods {
		if m == 0 {
			supported = true
		}
	}
	if !supported {
		c.Write([]byte{5, 255})
		return nil, fmt.Errorf("SOCKS authentication not supported")
	}
	if _, e = c.Write([]byte{5, 0}); e != nil {
		return nil, e
	}
	request := make([]byte, 4)
	if _, e = io.ReadFull(r, request); e != nil {
		return nil, e
	}
	if request[0] != 5 || request[1] != 1 {
		c.Write([]byte{5, 7, 0, 1, 0, 0, 0, 0, 0, 0})
		return nil, fmt.Errorf("only SOCKS CONNECT supported")
	}
	var host string
	switch request[3] {
	case 1:
		b := make([]byte, 4)
		if _, e = io.ReadFull(r, b); e != nil {
			return nil, e
		}
		host = net.IP(b).String()
	case 4:
		b := make([]byte, 16)
		if _, e = io.ReadFull(r, b); e != nil {
			return nil, e
		}
		host = net.IP(b).String()
	case 3:
		n, e := r.ReadByte()
		if e != nil {
			return nil, e
		}
		b := make([]byte, int(n))
		if _, e = io.ReadFull(r, b); e != nil {
			return nil, e
		}
		host = string(b)
	default:
		return nil, fmt.Errorf("invalid SOCKS address")
	}
	port := make([]byte, 2)
	if _, e = io.ReadFull(r, port); e != nil {
		return nil, e
	}
	target := net.JoinHostPort(host, fmt.Sprint(binary.BigEndian.Uint16(port)))
	c.SetReadDeadline(time.Time{})
	// Keep any eagerly sent application bytes after the synthetic request. The marker
	// lets the CONNECT handler distinguish SOCKS traffic from ordinary HTTP proxy use.
	prefix := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\nX-Capture-Socks: 1\r\n\r\n"
	return &socksConn{bufferedConn: bufferedConn{c, io.MultiReader(strings.NewReader(prefix), r)}}, nil
}

type mixedListener struct {
	net.Listener
	ready     chan net.Conn
	done      chan struct{}
	closeOnce sync.Once
}

// Negotiate each accepted socket separately so one slow SOCKS handshake cannot
// block unrelated HTTP clients. Closing the listener also releases queued handoffs.
func newMixedListener(base net.Listener) *mixedListener {
	l := &mixedListener{Listener: base, ready: make(chan net.Conn), done: make(chan struct{})}
	go func() {
		for {
			c, e := base.Accept()
			if e != nil {
				return
			}
			go func() {
				wrapped, e := protocolConn(c)
				if e != nil {
					c.Close()
					return
				}
				select {
				case l.ready <- wrapped:
				case <-l.done:
					c.Close()
				}
			}()
		}
	}()
	return l
}
func (l *mixedListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ready:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}
func (l *mixedListener) Close() error {
	var err error
	l.closeOnce.Do(func() { close(l.done); err = l.Listener.Close() })
	return err
}

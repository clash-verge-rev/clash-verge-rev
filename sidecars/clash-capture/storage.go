package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"
)

const historyLimit = 1000
const pendingLimit = 64
const pendingByteLimit = 32 * 1024 * 1024
const flushInterval = 500 * time.Millisecond

// Flow snapshots are immutable once queued. Body pointers must be copied because
// transport callbacks continue updating their activeFlow after save returns.
func snapshot(f Flow) *Flow {
	if f.Request != nil {
		body := *f.Request
		f.Request = &body
	}
	if f.Response != nil {
		body := *f.Response
		f.Response = &body
	}
	return &f
}
func snapshotBytes(f *Flow) int {
	n := len(f.URL) + len(f.Error) + 512
	for _, b := range []*Body{f.Request, f.Response} {
		if b == nil {
			continue
		}
		n += len(b.Content)
		for _, h := range b.Headers {
			n += len(h[0]) + len(h[1])
		}
	}
	return n
}

// Never wait for disk on the forwarding path. Coalesce updates by flow ID and
// bound both entry count and payload bytes; overload sacrifices recording, not traffic.
func (s *Store) save(f Flow, create bool) {
	next := snapshot(f)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if _, ok := s.index[f.ID]; !ok && !create {
		return
	}
	old := s.pending[f.ID]
	size := snapshotBytes(next)
	previous := 0
	if old != nil {
		previous = snapshotBytes(old)
	}
	if (old == nil && len(s.pending) >= pendingLimit) || s.pendingBytes-previous+size > pendingByteLimit {
		s.dropped++
		s.changedLocked()
		return
	}
	s.pendingBytes += size - previous
	s.pending[f.ID] = next
	s.index[f.ID] = f.Summary
	s.trimLocked()
	s.changedLocked()
}

func (s *Store) changedLocked() {
	s.revision++
	close(s.changed)
	s.changed = make(chan struct{})
}
func (s *Store) trimLocked() {
	for len(s.index) > historyLimit {
		var oldest Summary
		first := true
		for _, f := range s.index {
			if first || f.Time < oldest.Time || (f.Time == oldest.Time && f.ID < oldest.ID) {
				oldest = f
				first = false
			}
		}
		delete(s.index, oldest.ID)
		s.discardPendingLocked(oldest.ID)
		s.prune = true
	}
}
func (s *Store) discardPendingLocked(id string) {
	if f := s.pending[id]; f != nil {
		s.pendingBytes -= snapshotBytes(f)
		delete(s.pending, id)
	}
}

// diskMu orders flushes against explicit deletion. The short metadata lock is
// released during I/O, so slow writes cannot stall proxy callbacks or rule checks.
func (s *Store) flush() {
	s.diskMu.Lock()
	defer s.diskMu.Unlock()
	s.mu.Lock()
	batch := make(map[string]*Flow, len(s.pending))
	for id, f := range s.pending {
		batch[id] = f
	}
	prune := s.prune
	s.prune = false
	keep := make(map[string]bool)
	if prune {
		for id := range s.index {
			keep[id] = true
		}
	}
	dropped := s.dropped
	s.mu.Unlock()
	if dropped != s.reportedDropped {
		log.Printf("capture queue overloaded: %d record updates dropped", dropped)
		s.reportedDropped = dropped
	}
	for id, f := range batch {
		s.mu.Lock()
		current := s.pending[id] == f
		_, exists := s.index[id]
		s.mu.Unlock()
		if !current || !exists {
			continue
		}
		if err := atomicJSON(filepath.Join(s.dir, "flows", id+".json"), f); err != nil {
			log.Printf("capture persistence: %v", err)
			continue
		}
		s.mu.Lock()
		if s.pending[id] == f {
			s.discardPendingLocked(id)
		}
		s.mu.Unlock()
	}
	if prune {
		entries, err := os.ReadDir(filepath.Join(s.dir, "flows"))
		if err != nil {
			log.Print(err)
			s.mu.Lock()
			s.prune = true
			s.mu.Unlock()
			return
		}
		for _, entry := range entries {
			name := entry.Name()
			if len(name) != 37 || filepath.Ext(name) != ".json" || keep[name[:32]] {
				continue
			}
			if err := os.Remove(filepath.Join(s.dir, "flows", name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				log.Print(err)
				s.mu.Lock()
				s.prune = true
				s.mu.Unlock()
			}
		}
	}
}
func (s *Store) writer() {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	defer close(s.done)
	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.stop:
			s.flush()
			return
		}
	}
}
func (s *Store) close() {
	s.closeOnce.Do(func() { s.mu.Lock(); s.closed = true; s.mu.Unlock(); close(s.stop) })
	<-s.done
}
func (s *Store) readFlow(id string) ([]byte, error) {
	s.mu.Lock()
	if _, ok := s.index[id]; !ok {
		s.mu.Unlock()
		return nil, os.ErrNotExist
	}
	pending := s.pending[id]
	s.mu.Unlock()
	if pending != nil {
		return json.Marshal(pending)
	}
	s.diskMu.Lock()
	defer s.diskMu.Unlock()
	return os.ReadFile(filepath.Join(s.dir, "flows", id+".json"))
}
func (s *Store) clear(domain string) (int, error) {
	s.diskMu.Lock()
	defer s.diskMu.Unlock()
	s.mu.Lock()
	ids := []string{}
	for id, f := range s.index {
		if domain == "" || host(f.URL) == domain {
			ids = append(ids, id)
		}
	}
	s.mu.Unlock()
	count := 0
	for _, id := range ids {
		if err := os.Remove(filepath.Join(s.dir, "flows", id+".json")); err != nil && !errors.Is(err, os.ErrNotExist) {
			return count, err
		}
		s.mu.Lock()
		delete(s.index, id)
		s.discardPendingLocked(id)
		s.changedLocked()
		s.mu.Unlock()
		count++
	}
	return count, nil
}

func (s *Store) dropCount() uint64 { s.mu.Lock(); defer s.mu.Unlock(); return s.dropped }

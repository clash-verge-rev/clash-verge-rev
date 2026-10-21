package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func storedFlow(n int) Flow {
	return Flow{Summary: Summary{ID: fmt.Sprintf("%032x", n), Time: float64(n), Method: "GET", URL: "http://example.com/"}, Request: &Body{Encoding: "base64", Complete: true}}
}

func TestQueueDoesNotWaitForDiskAndDropsOnOverload(t *testing.T) {
	s := testStore(t)
	s.diskMu.Lock()
	defer s.diskMu.Unlock()
	done := make(chan struct{})
	go func() {
		for i := 0; i < pendingLimit+1; i++ {
			s.save(storedFlow(i), true)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("proxy callbacks blocked on disk")
	}
	s.mu.Lock()
	count, dropped, bytes := len(s.pending), s.dropped, s.pendingBytes
	s.mu.Unlock()
	if count != pendingLimit || dropped != 1 || bytes > pendingByteLimit {
		t.Fatalf("unbounded queue: %d/%d/%d", count, dropped, bytes)
	}
}
func TestQueuedDeletionCannotResurrectAfterFlush(t *testing.T) {
	s := testStore(t)
	f := storedFlow(1)
	s.save(f, true)
	if n, e := s.clear(""); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	f.Status = 200
	s.save(f, false)
	s.flush()
	if _, e := s.readFlow(f.ID); !os.IsNotExist(e) {
		t.Fatal("deleted record returned", e)
	}
	if _, e := os.Stat(filepath.Join(s.dir, "flows", f.ID+".json")); !os.IsNotExist(e) {
		t.Fatal("deleted record persisted", e)
	}
}
func TestHistoryEvictionRemovesOldestFile(t *testing.T) {
	s := testStore(t)
	s.mu.Lock()
	for i := 0; i < historyLimit; i++ {
		f := storedFlow(i)
		s.index[f.ID] = f.Summary
	}
	s.mu.Unlock()
	oldest := storedFlow(0)
	if e := atomicJSON(filepath.Join(s.dir, "flows", oldest.ID+".json"), oldest); e != nil {
		t.Fatal(e)
	}
	s.save(storedFlow(historyLimit), true)
	s.flush()
	s.mu.Lock()
	n := len(s.index)
	_, old := s.index[oldest.ID]
	s.mu.Unlock()
	if n != historyLimit || old {
		t.Fatal("retention limit not applied")
	}
	if _, e := os.Stat(filepath.Join(s.dir, "flows", oldest.ID+".json")); !os.IsNotExist(e) {
		t.Fatal("evicted record remains on disk", e)
	}
}
func TestCloseDrainsLatestSnapshotAndReadSeesPending(t *testing.T) {
	s := testStore(t)
	f := storedFlow(1)
	s.save(f, true)
	f.Status = 201
	s.save(f, false)
	data, e := s.readFlow(f.ID)
	if e != nil || len(data) == 0 {
		t.Fatal("pending detail unavailable", e)
	}
	s.close()
	restored, e := openStore(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.close()
	if restored.index[f.ID].Status != 201 {
		t.Fatal("last snapshot was not drained")
	}
}

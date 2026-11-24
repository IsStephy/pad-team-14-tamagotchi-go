package hashring

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type vectorsFile struct {
	Hashes []struct {
		Input string `json:"input"`
		Hash  uint32 `json:"hash"`
	} `json:"hashes"`
	Lookups []struct {
		Nodes        []string `json:"nodes"`
		VirtualNodes int      `json:"virtualNodes"`
		Cases        []struct {
			Key  string `json:"key"`
			Node string `json:"node"`
		} `json:"cases"`
	} `json:"lookups"`
}

// The Go port must give exactly the TypeScript ring's answers.
func TestMatchesVectors(t *testing.T) {
	raw, err := os.ReadFile("../test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectorsFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Hashes {
		if got := Hash32(c.Input); got != c.Hash {
			t.Errorf("Hash32(%q) = %d, want %d", c.Input, got, c.Hash)
		}
	}
	checked := 0
	for _, l := range v.Lookups {
		r, err := New(l.Nodes, l.VirtualNodes)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range l.Cases {
			got, err := r.NodeFor(c.Key)
			if err != nil || got != c.Node {
				t.Errorf("%v x%d: NodeFor(%q) = %q (%v), want %q", l.Nodes, l.VirtualNodes, c.Key, got, err, c.Node)
			}
			checked++
		}
	}
	t.Logf("%d hashes and %d lookups match", len(v.Hashes), checked)
}

func TestSpreadAndMovement(t *testing.T) {
	three := []string{"cache-1", "cache-2", "cache-3"}
	before, _ := New(three, VirtualNodes)
	after, _ := New(append(append([]string{}, three...), "cache-4"), VirtualNodes)
	const n = 100000
	counts := map[string]int{}
	moved := 0
	for i := 0; i < n; i++ {
		key := fmt.Sprintf("guild-service:guild:%d", i)
		a, _ := before.NodeFor(key)
		b, _ := after.NodeFor(key)
		counts[a]++
		if a != b {
			moved++
			if b != "cache-4" {
				t.Fatalf("%s moved %s -> %s, not to the new node", key, a, b)
			}
		}
	}
	for node, c := range counts {
		if share := float64(c) / n; share < 1.0/3-0.05 || share > 1.0/3+0.05 {
			t.Errorf("%s got %.1f%%", node, share*100)
		}
	}
	if share := float64(moved) / n; share < 0.2 || share > 0.3 {
		t.Errorf("%.1f%% of the keys moved", share*100)
	}
}

func TestEmptyRing(t *testing.T) {
	r, _ := New(nil, VirtualNodes)
	if _, err := r.NodeFor("x"); err != ErrEmpty {
		t.Fatalf("want ErrEmpty, got %v", err)
	}
	if _, err := New(nil, 0); err == nil {
		t.Fatal("virtualNodes 0 must be refused")
	}
}

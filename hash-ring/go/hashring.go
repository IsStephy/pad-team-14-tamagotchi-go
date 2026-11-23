// Package hashring is the Go port of the shared consistent-hash ring
// (../src/hashRing.ts, Lab 5 #230). Copy this file into a Go service to shard
// its cache over cache-1..3; hashring_test.go checks it against
// ../test-vectors.json, so a copy that still passes picks the same node for
// every key as the TypeScript services.
//
// The algorithm (identical in every language):
//
//  1. Hash32(text): FNV-1a 32-bit over the UTF-8 bytes, then murmur3 fmix32.
//  2. Every node is placed VirtualNodes (160) times, at Hash32("<node>#<i>").
//  3. Points are sorted by hash; equal hashes by node name.
//  4. A key belongs to the first point with hash >= Hash32(key), wrapping
//     around to the first point.
package hashring

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// VirtualNodes is how many points each node gets unless New is told otherwise.
const VirtualNodes = 160

const (
	fnvOffsetBasis uint32 = 0x811c9dc5
	fnvPrime       uint32 = 0x01000193
)

// ErrEmpty is returned by NodeFor when the ring has no nodes.
var ErrEmpty = errors.New("the hash ring has no nodes")

// Hash32 is the ring's hash: FNV-1a 32-bit, then fmix32. A Go string is
// already UTF-8 bytes, and uint32 arithmetic wraps exactly like the
// TypeScript version's Math.imul(...) >>> 0.
func Hash32(text string) uint32 {
	h := fnvOffsetBasis
	for i := 0; i < len(text); i++ {
		h ^= uint32(text[i])
		h *= fnvPrime
	}
	return fmix32(h)
}

// fmix32 is murmur3's finalizer. FNV-1a alone spreads labels that differ
// only in their last characters ("cache-1#0", "cache-1#1") badly: one node
// of three got ~60% of the keys. fmix32 mixes every bit into every other.
func fmix32(h uint32) uint32 {
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}

type point struct {
	hash uint32
	node string
}

// Ring is safe for concurrent use: lookups take a read lock, AddNode and
// RemoveNode a write lock.
type Ring struct {
	mu           sync.RWMutex
	virtualNodes int
	nodes        map[string]struct{}
	points       []point // sorted by hash, then node name
}

// New builds a ring. The order of nodes does not matter; duplicates are ignored.
func New(nodes []string, virtualNodes int) (*Ring, error) {
	if virtualNodes < 1 {
		return nil, fmt.Errorf("virtualNodes must be a positive integer, got %d", virtualNodes)
	}
	r := &Ring{virtualNodes: virtualNodes, nodes: map[string]struct{}{}}
	for _, n := range nodes {
		r.nodes[n] = struct{}{}
	}
	r.rebuild()
	return r, nil
}

// Nodes returns the node names, sorted.
func (r *Ring) Nodes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.nodes))
	for n := range r.nodes {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// AddNode adds a node; only the keys that now fall on its points move to it.
func (r *Ring) AddNode(node string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[node]; ok {
		return
	}
	r.nodes[node] = struct{}{}
	r.rebuild()
}

// RemoveNode removes a node; only its own keys move.
func (r *Ring) RemoveNode(node string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[node]; !ok {
		return
	}
	delete(r.nodes, node)
	r.rebuild()
}

// NodeFor returns the node that owns key.
func (r *Ring) NodeFor(key string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.points) == 0 {
		return "", ErrEmpty
	}
	h := Hash32(key)
	// First point with hash >= h (binary search).
	i := sort.Search(len(r.points), func(i int) bool { return r.points[i].hash >= h })
	if i == len(r.points) {
		i = 0 // past the last point: wrap around
	}
	return r.points[i].node, nil
}

// rebuild recomputes every point; the caller holds the write lock.
func (r *Ring) rebuild() {
	points := make([]point, 0, len(r.nodes)*r.virtualNodes)
	for n := range r.nodes {
		for i := 0; i < r.virtualNodes; i++ {
			points = append(points, point{hash: Hash32(fmt.Sprintf("%s#%d", n, i)), node: n})
		}
	}
	sort.Slice(points, func(a, b int) bool {
		if points[a].hash != points[b].hash {
			return points[a].hash < points[b].hash
		}
		return points[a].node < points[b].node
	})
	r.points = points
}

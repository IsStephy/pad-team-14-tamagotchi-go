"""The Python port of the shared consistent-hash ring (../src/hashRing.ts).

Copy this file into a Python service to shard its cache over cache-1..3.
test_hashring.py checks it against ../test-vectors.json, so a copy that still
passes picks the same node for every key as the TypeScript and Go services.

The algorithm (identical in every language):

1. hash32(text): FNV-1a 32-bit over the UTF-8 bytes, then murmur3 fmix32.
2. Every node is placed VIRTUAL_NODES (160) times, at hash32("<node>#<i>").
3. Points are sorted by hash; equal hashes by node name (byte order).
4. A key belongs to the first point with hash >= hash32(key), wrapping
   around to the first point.

Standard library only.
"""

from __future__ import annotations

import bisect
import threading
from typing import Iterable

VIRTUAL_NODES = 160

_FNV_OFFSET_BASIS = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK = 0xFFFFFFFF


class EmptyRingError(LookupError):
    """node_for on a ring with no nodes."""


def hash32(text: str) -> int:
    """FNV-1a 32-bit over the UTF-8 bytes, then fmix32. Python ints don't
    overflow, so every multiplication is masked back to 32 bits."""
    h = _FNV_OFFSET_BASIS
    for byte in text.encode("utf-8"):
        h = ((h ^ byte) * _FNV_PRIME) & _MASK
    return _fmix32(h)


def _fmix32(h: int) -> int:
    """murmur3's finalizer: FNV-1a alone spreads labels that differ only in
    their last characters ("cache-1#0", "cache-1#1") badly."""
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & _MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & _MASK
    h ^= h >> 16
    return h


class HashRing:
    """Safe to share between threads: changes swap in a new list of points
    under a lock, and a lookup reads whichever list is current."""

    def __init__(self, nodes: Iterable[str] = (), virtual_nodes: int = VIRTUAL_NODES):
        if not isinstance(virtual_nodes, int) or isinstance(virtual_nodes, bool) or virtual_nodes < 1:
            raise ValueError(f"virtual_nodes must be a positive integer, got {virtual_nodes!r}")
        self._virtual_nodes = virtual_nodes
        self._lock = threading.Lock()
        self._nodes: set[str] = set(nodes)
        self._points: tuple[list[int], list[str]] = ([], [])
        self._rebuild()

    @property
    def nodes(self) -> list[str]:
        """The node names, sorted."""
        with self._lock:
            return sorted(self._nodes)

    def add_node(self, node: str) -> None:
        """Only the keys that now fall on the new node's points move to it."""
        with self._lock:
            if node not in self._nodes:
                self._nodes.add(node)
                self._rebuild()

    def remove_node(self, node: str) -> None:
        """Only the removed node's keys move."""
        with self._lock:
            if node in self._nodes:
                self._nodes.discard(node)
                self._rebuild()

    def node_for(self, key: str) -> str:
        hashes, owners = self._points
        if not hashes:
            raise EmptyRingError("the hash ring has no nodes")
        i = bisect.bisect_left(hashes, hash32(key))  # first point with hash >= hash32(key)
        return owners[i if i < len(owners) else 0]  # past the last point: wrap around

    def _rebuild(self) -> None:
        points = sorted(
            ((hash32(f"{node}#{i}"), node.encode("utf-8"), node)
             for node in self._nodes for i in range(self._virtual_nodes)),
            key=lambda p: (p[0], p[1]),
        )
        # One attribute holding both lists, so a lookup never sees one new list and one old.
        self._points = ([p[0] for p in points], [p[2] for p in points])

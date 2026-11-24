"""The Python ring must give exactly the TypeScript ring's answers.

Run from hash-ring/python:  python -m unittest -v
"""

import json
import unittest
from collections import Counter
from pathlib import Path

from hashring import VIRTUAL_NODES, EmptyRingError, HashRing, hash32

VECTORS = Path(__file__).resolve().parent.parent / "test-vectors.json"
THREE = ["cache-1", "cache-2", "cache-3"]


class MatchesVectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vectors = json.loads(VECTORS.read_text(encoding="utf-8"))

    def test_hashes(self):
        for case in self.vectors["hashes"]:
            with self.subTest(input=case["input"][:40]):
                self.assertEqual(hash32(case["input"]), case["hash"])

    def test_lookups(self):
        checked = 0
        for lookup in self.vectors["lookups"]:
            ring = HashRing(lookup["nodes"], lookup["virtualNodes"])
            for case in lookup["cases"]:
                with self.subTest(nodes=lookup["nodes"], virtual_nodes=lookup["virtualNodes"], key=case["key"][:40]):
                    self.assertEqual(ring.node_for(case["key"]), case["node"])
                checked += 1
        self.assertGreater(checked, 0)


class Behaviour(unittest.TestCase):
    def test_spread_and_movement(self):
        before = HashRing(THREE)
        after = HashRing(THREE + ["cache-4"])
        n = 100_000
        counts, moved = Counter(), 0
        for i in range(n):
            key = f"guild-service:guild:{i}"
            a, b = before.node_for(key), after.node_for(key)
            counts[a] += 1
            if a != b:
                moved += 1
                self.assertEqual(b, "cache-4", f"{key} moved {a} -> {b}, not to the new node")
        for node, count in counts.items():
            self.assertAlmostEqual(count / n, 1 / 3, delta=0.05, msg=node)
        self.assertTrue(0.2 <= moved / n <= 0.3, f"{moved / n:.1%} of the keys moved")

    def test_removing_a_node_moves_only_its_keys(self):
        ring = HashRing(THREE)
        keys = [f"k{i}" for i in range(5000)]
        before = {k: ring.node_for(k) for k in keys}
        ring.remove_node("cache-2")
        for k in keys:
            if before[k] != "cache-2":
                self.assertEqual(ring.node_for(k), before[k])
            else:
                self.assertNotEqual(ring.node_for(k), "cache-2")
        ring.add_node("cache-2")
        self.assertEqual({k: ring.node_for(k) for k in keys}, before)

    def test_node_order_and_duplicates_do_not_matter(self):
        a = HashRing(["cache-3", "cache-1", "cache-2", "cache-1"])
        b = HashRing(THREE)
        self.assertEqual(a.nodes, THREE)
        self.assertTrue(all(a.node_for(f"k{i}") == b.node_for(f"k{i}") for i in range(2000)))

    def test_empty_ring_and_bad_virtual_nodes(self):
        with self.assertRaises(EmptyRingError):
            HashRing().node_for("x")
        for bad in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                HashRing(THREE, bad)
        self.assertEqual(VIRTUAL_NODES, 160)


if __name__ == "__main__":
    unittest.main()

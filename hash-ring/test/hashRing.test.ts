// Tests for the shared hash ring. Plain node:test, so no test framework is
// needed:  npm test
//
// What #230 asks for: keys spread evenly over 3 nodes, and adding a 4th node
// moves only about 1/4 of the keys. Plus: the ring matches test-vectors.json
// (the file other languages are checked against).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { HashRing, hash32 } from "../src/hashRing";

const THREE = ["cache-1", "cache-2", "cache-3"];
// Fixed keys, so a run is reproducible: a failure today fails tomorrow too.
const KEYS = Array.from({ length: 100_000 }, (_, i) => `guild-service:guild:${i}`);

function countByNode(ring: HashRing, keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const node = ring.nodeFor(key);
    counts.set(node, (counts.get(node) ?? 0) + 1);
  }
  return counts;
}

test("keys spread evenly over 3 nodes (each gets 33% ± 5%)", () => {
  const counts = countByNode(new HashRing(THREE), KEYS);
  assert.deepEqual([...counts.keys()].sort(), THREE);
  for (const [node, count] of counts) {
    const share = count / KEYS.length;
    assert.ok(Math.abs(share - 1 / 3) <= 0.05, `${node} got ${(share * 100).toFixed(1)}%`);
  }
});

test("adding a 4th node moves about 1/4 of the keys, all of them to the new node", () => {
  const before = new HashRing(THREE);
  const after = new HashRing([...THREE, "cache-4"]);
  let moved = 0;
  for (const key of KEYS) {
    const from = before.nodeFor(key);
    const to = after.nodeFor(key);
    if (from !== to) {
      moved++;
      // A key only ever moves TO the new node, never between old nodes.
      assert.equal(to, "cache-4", `${key} moved ${from} -> ${to}`);
    }
  }
  const share = moved / KEYS.length;
  assert.ok(share >= 0.2 && share <= 0.3, `${(share * 100).toFixed(1)}% of the keys moved`);
});

test("removing a node moves only that node's keys", () => {
  const ring = new HashRing(THREE);
  const before = KEYS.map((key) => ring.nodeFor(key));
  ring.removeNode("cache-2");
  KEYS.forEach((key, i) => {
    const now = ring.nodeFor(key);
    if (before[i] === "cache-2") assert.notEqual(now, "cache-2");
    else assert.equal(now, before[i], `${key} moved off ${before[i]} although that node stayed`);
  });
});

test("addNode then removeNode gives back the same ring", () => {
  const ring = new HashRing(THREE);
  const before = KEYS.slice(0, 5000).map((key) => ring.nodeFor(key));
  ring.addNode("cache-4");
  ring.removeNode("cache-4");
  assert.deepEqual(KEYS.slice(0, 5000).map((key) => ring.nodeFor(key)), before);
});

test("the order nodes are given in does not matter", () => {
  const a = new HashRing(["cache-1", "cache-2", "cache-3"]);
  const b = new HashRing(["cache-3", "cache-1", "cache-2"]);
  for (const key of KEYS.slice(0, 5000)) assert.equal(a.nodeFor(key), b.nodeFor(key));
});

test("duplicate nodes are ignored, and nodes are listed sorted", () => {
  const ring = new HashRing(["cache-2", "cache-1", "cache-2"]);
  ring.addNode("cache-1");
  assert.deepEqual(ring.nodes, ["cache-1", "cache-2"]);
});

test("an empty ring refuses lookups, and virtualNodes must be positive", () => {
  assert.throws(() => new HashRing().nodeFor("x"), /no nodes/);
  assert.throws(() => new HashRing(THREE, 0), /positive integer/);
});

test("hash32 is an unsigned 32-bit number", () => {
  for (const key of ["", "a", "🐉", "x".repeat(10_000)]) {
    const h = hash32(key);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${h}`);
  }
});

test("matches test-vectors.json", () => {
  // dist/test/hashRing.test.js -> hash-ring/test-vectors.json
  const file = path.join(__dirname, "..", "..", "test-vectors.json");
  const vectors = JSON.parse(fs.readFileSync(file, "utf8"));

  for (const { input, hash } of vectors.hashes) {
    assert.equal(hash32(input), hash, `hash32(${JSON.stringify(input)})`);
  }
  for (const { nodes, virtualNodes, cases } of vectors.lookups) {
    const ring = new HashRing(nodes, virtualNodes);
    for (const { key, node } of cases) {
      assert.equal(ring.nodeFor(key), node, `${nodes.join(",")} x${virtualNodes}: ${JSON.stringify(key)}`);
    }
  }
});

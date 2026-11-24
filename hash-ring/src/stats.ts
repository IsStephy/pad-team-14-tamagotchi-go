// Prints the numbers behind the README's consistent-hashing write-up, so they
// can be re-run live during the presentation:
//
//   npm run stats
//
// 1. How evenly 100 000 keys spread over 3 nodes, by number of virtual nodes.
// 2. How many keys move when a 4th node is added: the ring vs `hash mod N`.

import { HashRing, hash32 } from "./hashRing";

const KEYS = 100_000;
const keys = Array.from({ length: KEYS }, (_, i) => `guild-service:guild:${i}`);
const three = ["cache-1", "cache-2", "cache-3"];
const four = [...three, "cache-4"];

const pct = (n: number) => `${((n / KEYS) * 100).toFixed(1)}%`;

console.log(`Spread of ${KEYS} keys over 3 nodes`);
console.log("virtual nodes | cache-1 | cache-2 | cache-3");
for (const v of [1, 10, 40, 160]) {
  const ring = new HashRing(three, v);
  const counts = new Map<string, number>(three.map((n) => [n, 0]));
  for (const key of keys) {
    const node = ring.nodeFor(key);
    counts.set(node, counts.get(node)! + 1);
  }
  console.log(`${String(v).padStart(13)} | ${three.map((n) => pct(counts.get(n)!).padStart(7)).join(" | ")}`);
}

console.log(`\nKeys that move when cache-4 joins (3 -> 4 nodes)`);
const before = new HashRing(three);
const after = new HashRing(four);
let ringMoved = 0;
let modMoved = 0;
for (const key of keys) {
  if (before.nodeFor(key) !== after.nodeFor(key)) ringMoved++;
  const h = hash32(key);
  if (h % 3 !== h % 4) modMoved++;
}
console.log(`consistent-hash ring: ${pct(ringMoved)} (ideal: 1/4 = 25%)`);
console.log(`hash mod N:           ${pct(modMoved)}`);

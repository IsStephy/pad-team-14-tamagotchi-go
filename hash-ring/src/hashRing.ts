// Consistent-hash ring with virtual nodes (Lab 5, #230).
//
// Every service that caches data shards its keys over the shared cache nodes
// (cache-1, cache-2, cache-3) with this ring: ring.nodeFor(key) names the node
// that key lives on. Every service must pick the SAME node for the same key,
// so the algorithm below is fixed. The Go port (../go/hashring.go) follows it
// exactly, and both are checked against ../test-vectors.json.
//
// The algorithm, in four steps:
//
//   1. hash32(text): FNV-1a 32-bit over the text's UTF-8 bytes, then
//      murmur3's fmix32 finalizer. All arithmetic is unsigned 32-bit.
//   2. Every node is placed on the ring VIRTUAL_NODES (160) times, at
//      hash32("<node>#<i>") for i = 0 .. 159.
//   3. The points are sorted by hash; equal hashes by node name.
//   4. A key belongs to the first point whose hash is >= hash32(key),
//      wrapping around to the first point past the end of the ring.
//
// Why each step is there is explained in the CPR README, "Cache Sharding with
// Consistent Hashing".

/** How many points each node gets on the ring, unless the caller says otherwise. */
export const VIRTUAL_NODES = 160;

// FNV-1a's two constants: the starting value (offset basis) and the prime it
// multiplies by after every byte. Both are fixed by the FNV specification.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const utf8 = new TextEncoder();

/**
 * The ring's hash: FNV-1a 32-bit, then fmix32. Returns an unsigned 32-bit
 * integer (0 .. 4294967295).
 *
 * JavaScript numbers are 64-bit floats, not 32-bit integers, so two tricks
 * keep the arithmetic identical to Go's uint32:
 *   - Math.imul(a, b) multiplies as 32-bit integers (a plain a * b would lose
 *     the low bits once the product passes 2^53);
 *   - `>>> 0` turns the result back into an UNSIGNED 32-bit number.
 */
export function hash32(text: string): number {
  let h = FNV_OFFSET_BASIS;
  for (const byte of utf8.encode(text)) {
    h ^= byte;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return fmix32(h);
}

// murmur3's finalizer ("fmix32"): mixes every input bit into every output bit.
//
// Why it is needed: FNV-1a alone barely changes the HIGH bits when only the
// last character changes, and the ring's labels differ only in their last
// characters ("cache-1#0", "cache-1#1", ...). Without fmix32, one node of
// three ended up with ~60% of the keys; with it, each gets ~33%.
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** One point on the ring: a position, and the node that owns it. */
interface Point {
  hash: number;
  node: string;
}

export class HashRing {
  private readonly virtualNodes: number;
  private readonly nodeNames = new Set<string>();
  // Sorted by hash, so nodeFor() can binary-search it.
  private points: Point[] = [];

  /**
   * @param nodes        node names, e.g. ["cache-1", "cache-2", "cache-3"]. The
   *                     order does not matter: the same set gives the same ring.
   * @param virtualNodes points per node; every service must use the same value.
   */
  constructor(nodes: Iterable<string> = [], virtualNodes = VIRTUAL_NODES) {
    if (!Number.isInteger(virtualNodes) || virtualNodes < 1) {
      throw new Error(`virtualNodes must be a positive integer, got ${virtualNodes}`);
    }
    this.virtualNodes = virtualNodes;
    for (const node of nodes) this.nodeNames.add(node);
    this.rebuild();
  }

  /** The node names on the ring, sorted. */
  get nodes(): string[] {
    return [...this.nodeNames].sort(compareNames);
  }

  /** Adds a node. Only the keys between its new points and the points before them move to it. */
  addNode(node: string): void {
    if (this.nodeNames.has(node)) return;
    this.nodeNames.add(node);
    this.rebuild();
  }

  /** Removes a node. Only its own keys move, each to the next point clockwise. */
  removeNode(node: string): void {
    if (!this.nodeNames.delete(node)) return;
    this.rebuild();
  }

  /** The node that owns `key`. Throws when the ring is empty. */
  nodeFor(key: string): string {
    if (this.points.length === 0) {
      throw new Error("the hash ring has no nodes");
    }
    const h = hash32(key);

    // Binary search for the first point with hash >= h. O(log n): 480
    // points (3 nodes x 160) take at most 9 comparisons.
    let lo = 0;
    let hi = this.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.points[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    // Past the last point: the ring wraps around to the first one.
    return this.points[lo === this.points.length ? 0 : lo].node;
  }

  // Recomputes every point. Rings are tiny (a few hundred points) and change
  // only when a node is added or removed, so rebuilding from scratch is
  // simpler than inserting points one by one, and costs well under 1 ms.
  private rebuild(): void {
    const points: Point[] = [];
    for (const node of this.nodeNames) {
      for (let i = 0; i < this.virtualNodes; i++) {
        points.push({ hash: hash32(`${node}#${i}`), node });
      }
    }
    // Ties (two labels with the same hash) are broken by node name, so the
    // ring is identical in every service and every language.
    points.sort((a, b) => a.hash - b.hash || compareNames(a.node, b.node));
    this.points = points;
  }
}

// Byte-wise string order, the same as Go's `a < b`. Node names are ASCII
// (cache-1, cache-2, ...), where it matches JavaScript's `<` as well;
// localeCompare would not.
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

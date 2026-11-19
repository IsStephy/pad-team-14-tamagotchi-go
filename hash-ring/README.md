# hash-ring

The consistent-hash ring every service uses to shard its cache over the three
cache nodes `cache-1`, `cache-2` and `cache-3` (Lab 5, #230). The CPR README's
[Cache Sharding with Consistent Hashing](../README.md#cache-sharding-with-consistent-hashing)
explains what consistent hashing is and why the ring is built this way.

Every service must pick the **same node for the same key**. Otherwise one
service writes a key to `cache-2` while another looks for it on `cache-3`.
So there is one algorithm, one file per language, and one file of expected
answers every one of them is checked against:

| File | What |
|---|---|
| [`src/hashRing.ts`](src/hashRing.ts) | TypeScript ring: Guild, Package Registry, Map, Monster Raid |
| [`go/hashring.go`](go/hashring.go) | Go ring: User Management, Battle, Tamagotchi, Notification |
| `python/` | Python ring: the Gateway's token cache (#234). Written by Denis, held to the same vectors |
| [`test-vectors.json`](test-vectors.json) | 213 hashes and 852 lookups both must reproduce |

## The algorithm

1. **Hash:** `hash32(text)` = FNV-1a 32-bit over the text's UTF-8 bytes
   (offset basis `0x811c9dc5`, prime `0x01000193`), then murmur3's `fmix32`
   finalizer. All arithmetic is unsigned 32-bit and wraps on overflow.
2. **Virtual nodes:** each node gets **160** points on the ring, at
   `hash32("<node>#<i>")` for `i` = 0 … 159 (e.g. `cache-1#0`).
3. **Order:** points sorted by hash ascending; equal hashes by node name
   (byte order).
4. **Lookup:** a key belongs to the first point whose hash is `>=`
   `hash32(key)`. Past the last point it wraps around to the first one.

```
fnv1a32(bytes):  h = 0x811c9dc5
                 for b in bytes: h = (h XOR b) * 0x01000193   (mod 2^32)
fmix32(h):       h ^= h >> 16;  h *= 0x85ebca6b
                 h ^= h >> 13;  h *= 0xc2b2ae35
                 h ^= h >> 16
hash32(text):    fmix32(fnv1a32(utf8(text)))
```

## Using it in a service

Copy the file into the service: `hashRing.ts` into `src/`, or `hashring.go`
into a package of its own. It is one small file with no dependencies, so a
copy is simpler than publishing a package. Then:

```ts
import { HashRing } from "./hashRing";

const ring = new HashRing(["cache-1", "cache-2", "cache-3"]);
ring.nodeFor("guild-service:guild:3f2a9c1b"); // -> "cache-3", every time, in every service
```

```go
ring, _ := hashring.New([]string{"cache-1", "cache-2", "cache-3"}, hashring.VirtualNodes)
node, _ := ring.NodeFor("guild-service:guild:3f2a9c1b")
```

Rules for every service:
- **Node names are the host names from `CACHE_NODES`** (`cache-1`, not
  `cache-1:6379`), and every service lists the same nodes.
- **Keep 160 virtual nodes.** A different count gives a different ring.
- **A node that is down stays on the ring.** Its keys become cache misses,
  read from the database, until it comes back. Removing it would move its
  keys to other nodes and then back again.

**To check your copy:** run the vector test against it. In Go, put
`hashring_test.go` next to your copy and point it at `test-vectors.json`. A
copy that passes picks the same node as everyone else for every key.

## Commands

```bash
cd hash-ring
npm install
npm test          # builds, then runs the tests (node:test, no framework)
npm run stats     # spread by number of virtual nodes, keys moved: ring vs hash mod N
npm run vectors   # rewrites test-vectors.json - only when the algorithm changes on purpose

# The Go port, without installing Go:
docker run --rm -v "$PWD:/w" -w /w/go golang:1.22-alpine go test -v ./...
```

The tests check that:
- 100 000 keys spread evenly over 3 nodes, each node getting 33% ± 5%;
- adding a 4th node moves 20–30% of the keys, all of them to the new node;
- removing a node moves only that node's keys;
- the order nodes are listed in doesn't matter;
- the ring reproduces `test-vectors.json`.

`test-vectors.json` covers the empty key, non-ASCII keys, a 1000-character
key, a single-node ring, and a ring with one virtual node per node, where at
least one key wraps around past the last point. A port that skips `fmix32`
or the wrap-around fails it.

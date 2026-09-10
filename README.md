# pad-team-14-tamagotchi-go

Common Public Repository (CPR) for Team 14 — **Topic 2: Tamagotchi Go** (FAF.PAD21.1, Autumn 2026).

A distributed system of 8 microservices letting players raise, battle, and trade virtual pets ("Tamagotchis") across independently developed client apps ("packages") sharing one backend.



## Service Boundaries

### User Management Service
Owns the global identity of players: registration, authentication, profiles, friends/enemies, and both currencies (package-local currency and the shared global currency). Authoritative for identity/relationship/currency questions asked by every other service (e.g. "does this user have enough global currency?").

### Battle Service
Owns turn-based PvP combat execution once a match is created. Calculates damage from Tamagotchi level, type advantage, equipped boosts, and current health; tracks battle state/turn. Distributes rewards (global currency, XP, loser's primary Tamagotchi) at battle end. Does **not** own Tamagotchi or user records — only consults them.

### Tamagotchi Service
Owns the globally relevant state of every Tamagotchi: identity, owner, combat type (one of 6 elemental types with an advantage cycle), level, sprite reference, and package-local health stats (hunger, tiredness, happiness, etc. — intentionally *not* normalized across packages). Secondary Tamagotchis are references to existing entries, never new rows.

### Notification Service
Owns asynchronous delivery to clients via Firebase push notifications. Consumes events published by other services (friend request, nearby player, battle request, guild invite, raid started, etc.) and decides how/whether to deliver them. Does not generate the underlying events itself.

### Map Service
Owns each user's latest known geolocation and proximity detection. Shows nearby users on a map (friends/enemies always visible; unknown users become visible within ~6m). Emits proximity events that *suggest* befriending/battling. Does **not** manage battles or notifications directly — only signals opportunities for them.

### Monster Raid Service
Owns cooperative clicker-style guild raids against a shared monster: current HP, participating users, damage dealt, timestamps, raid status/duration. Distributes rewards on kill or handles raid failure on timeout. Consults Tamagotchi combat stats but doesn't own them.

### Guild Service
Owns guild identity, membership, roles (owner/officer/member), and real-time guild chat over WebSockets. Provides the social context for Monster Raids — members join an active raid with their primary Tamagotchi. Uses User Management Service to resolve identity/relationships for invitations.

### Package Registry Service
Owns the registry of client apps ("packages") participating in the ecosystem: package identifier/version/status, associated moderators/admins, and which users belong to which package. Stores each package's local Tamagotchi stat definitions/thresholds (non-normalized) so Battle Service can compute package-specific bonuses without a shared schema. Admins here design/schedule Monster Raids.

## Technologies & Communication Patterns

The team works in **2 languages**, split by repo/member pair:

| Repo | Service | Language / Framework | Sync communication | Async communication |
|---|---|---|---|---|
| `user-management-service` | User Management | **Go** (e.g. Gin/Echo) | REST CRUD (auth, profile, currency checks) | Publishes friend/relationship/currency-change events for other services to consume |
| `battle-service` | Battle | **Go** (e.g. Gin/Echo) | REST to create/query a match; WebSocket pushes live turn/state updates during a match | Publishes battle-end events (reward/XP/currency change, Tamagotchi transfer) for Notification/Tamagotchi/User Management to consume |
| `tamagotchi-service` | Tamagotchi | **Go** (e.g. Gin/Echo) | REST CRUD (create/level/read stats) | Publishes Tamagotchi-updated/transferred events |
| `notification-service` | Notification | **Go** (e.g. Gin/Echo) | REST for device registration only | Purely event-driven: consumes events from every other service and delivers via Firebase push; no service should call it synchronously for delivery |
| `map-service` | Map | **TypeScript** (Node.js, e.g. NestJS/Express) | REST for nearby-user queries; WebSocket/streaming for continuous geolocation updates | Emits proximity events (async, fire-and-forget) rather than blocking callers |
| `monster-raid-service` | Monster Raid | **TypeScript** (Node.js, e.g. NestJS/Express) | REST for raid queries/attacks (current HP/status) | Publishes raid-complete/raid-failed events for rewards |
| `guild-service` | Guild | **TypeScript** (Node.js, e.g. NestJS/Express) | REST for guild/membership CRUD; WebSocket for Guild Chat (real-time, low-latency) | Publishes invite/raid-join events |
| `package-registry-service` | Package Registry | **TypeScript** (Node.js, e.g. NestJS/Express) | REST for package/moderator/stat-definition CRUD | Publishes raid-config-activated events for Monster Raid Service |

**Why this split:**
- **Go** for User Management, Battle, Tamagotchi, Notification: these are the services with the most structured, relational domain data (accounts, currencies, combat math, stat definitions), and Go's low memory footprint, fast startup, and static typing keep these always-on core services cheap to run while still giving strong compile-time guarantees around combat/currency logic where correctness matters most (e.g. atomic Tamagotchi transfer on battle end). Its built-in goroutine concurrency also handles the event consuming/publishing these services do without extra machinery.
- **TypeScript (Node.js)** for Map, Monster Raid, Guild, Package Registry: these are I/O-heavy, connection-heavy services (constant geolocation streams, guild chat WebSockets, many concurrent raid clicks) where Node's non-blocking event loop and first-class WebSocket support are a natural fit, and where the JSON-shaped, loosely-structured config data (package-specific stat definitions, raid configs) suits a more dynamic language.
- **WebSockets** are used specifically where the interaction is inherently real-time/bidirectional (Battle turn updates, Guild Chat, Monster Raid live damage) — REST elsewhere, since most other operations are simple request/response.
- **Async events** (rather than synchronous calls) are used wherever a service shouldn't block on/depend on the availability of a downstream consumer — most notably Notification Service, and reward/XP distribution after Battle or Monster Raid completes.

## Communication Contract

### Data management strategy

**Database-per-service.** Each of the 8 services owns its own database, matching the ownership boundaries above — no service reaches into another's schema directly. Cross-service data needs are resolved through synchronous REST/WebSocket calls or async events, never shared tables.

| Service | Suggested store | Why |
|---|---|---|
| User Management | PostgreSQL | Relational: accounts, currencies, friend/enemy graph, needs transactional integrity |
| Battle | PostgreSQL (+ in-memory/Redis for live match state) | Match history is relational; active turn state is ephemeral/high-churn |
| Tamagotchi | PostgreSQL | Relational ownership records; package-local stat blobs stored as JSON columns (non-normalized by design) |
| Notification | Redis / lightweight queue store | Ephemeral delivery queue, not long-term source of truth |
| Map | Redis (geospatial) | Frequently-updated key-value/geo lookups, not relational history |
| Monster Raid | PostgreSQL (+ Redis for live HP/damage counters) | Raid definition/results are relational; live damage ticking is high-frequency |
| Guild | PostgreSQL | Relational membership/roles; chat messages can go in the same store or a append-only log |
| Package Registry | PostgreSQL | Relational config data (packages, moderators, stat-definition schemas as JSON) |

All cross-service reads (e.g. Battle Service checking a user's currency) go through that owning service's REST API — never direct DB access.

### Endpoints

Each field below is annotated with its type (`string`, `int`, `float`, `bool`, `object`, `array<T>`, ISO 8601 timestamp, etc.).

#### User Management Service (`user-battle`, Go)

**Register a Player**

`POST` `/users/register` — Description: Creates a new player account. Payload:

```json
{
  "username": "string",
  "password": "string",
  "email": "string",
  "packageId": "string"
}
```

Success Response (201 Created):

```json
{
  "userId": "string",
  "username": "string",
  "email": "string"
}
```

**Login**

`POST` `/users/login` — Description: Authenticates a player and returns a JWT. Payload:

```json
{
  "username": "string",
  "password": "string"
}
```

Success Response (200 OK):

```json
{
  "token": "string",
  "userId": "string"
}
```

**Get Player**

`GET` `/users/{userId}` — Description: Retrieves a player's profile.

Success Response (200 OK):

```json
{
  "userId": "string",
  "username": "string",
  "profile": "string",
  "level": "int",
  "xp": "int"
}
```

**Get Currency Balance**

`GET` `/users/{userId}/currency` — Description: Retrieves a player's local and global currency balances.

Success Response (200 OK):

```json
{
  "localCurrency": "int",
  "globalCurrency": "int"
}
```

**Adjust Currency**

`POST` `/users/{userId}/currency/adjust` — Description: Applies a currency delta (positive or negative) to a player. Payload:

```json
{
  "globalCurrencyDelta": "int",
  "localCurrencyDelta": "int",
  "reason": "string"
}
```

Success Response (200 OK):

```json
{
  "localCurrency": "int",
  "globalCurrency": "int"
}
```

**Send Friend Request**

`POST` `/users/{userId}/friends/{targetId}` — Description: Sends or accepts a friend request between two players.

Success Response (200 OK):

```json
{
  "status": "string (enum: pending, friends)"
}
```

**List Friends**

`GET` `/users/{userId}/friends` — Description: Lists a player's friends.

Success Response (200 OK):

```json
[
  {
    "userId": "string",
    "username": "string",
    "status": "string"
  }
]
```

**Get Relationship**

`GET` `/users/{userId}/relationship/{targetId}` — Description: Returns the relationship between two players.

Success Response (200 OK):

```json
{
  "relationship": "string (enum: friend, enemy, none)"
}
```

#### Battle Service (`user-battle`, Go)

**Create Battle**

`POST` `/battles` — Description: Creates a new PvP battle between two players. Payload:

```json
{
  "player1Id": "string",
  "player2Id": "string",
  "primaryTamagotchiId": "string",
  "secondaryTamagotchiId": "string",
  "boosts": "array<string>"
}
```

Success Response (201 Created):

```json
{
  "battleId": "string",
  "status": "string (enum: in_progress)"
}
```

**Get Battle**

`GET` `/battles/{battleId}` — Description: Retrieves the current state of a battle.

Success Response (200 OK):

```json
{
  "battleId": "string",
  "state": "string",
  "currentTurn": "int",
  "healthP1": "int",
  "healthP2": "int"
}
```

**Submit Battle Action**

`POST` `/battles/{battleId}/action` — Description: Submits a turn action for a battle. Payload:

```json
{
  "userId": "string",
  "action": "string",
  "targetMoveId": "string"
}
```

Success Response (200 OK):

```json
{
  "battleId": "string",
  "state": "string",
  "log": "array<string>"
}
```

**Live Battle Updates**

`WS` `/battles/{battleId}/live` — Description: Server pushes live turn/state updates for a battle.

Server push message:

```json
{
  "type": "string (enum: turn_update, battle_end)",
  "payload": "object"
}
```

**Battle Ended (internal event)**

Not client-facing — published when a battle ends, consumed by Notification/Tamagotchi/User Management services.

```json
{
  "winnerId": "string",
  "loserId": "string",
  "rewardCurrency": "int",
  "rewardXp": "int",
  "transferredTamagotchiId": "string"
}
```

#### Tamagotchi Service (`tamagotchi-notification`, Go)

**Create Tamagotchi**

`POST` `/tamagotchis` — Description: Creates a new Tamagotchi for a player. Payload:

```json
{
  "ownerId": "string",
  "type": "string",
  "packageId": "string",
  "name": "string"
}
```

Success Response (201 Created):

```json
{
  "tamagotchiId": "string",
  "type": "string",
  "level": "int",
  "stats": "object"
}
```

**Get Tamagotchi**

`GET` `/tamagotchis/{id}` — Description: Retrieves a Tamagotchi's details.

Success Response (200 OK):

```json
{
  "tamagotchiId": "string",
  "ownerId": "string",
  "type": "string",
  "level": "int",
  "sprite": "string",
  "packageStats": "object"
}
```

**List Player's Tamagotchis**

`GET` `/users/{userId}/tamagotchis` — Description: Lists all Tamagotchis owned by a player.

Success Response (200 OK):

```json
[
  {
    "tamagotchiId": "string",
    "type": "string",
    "level": "int",
    "isPrimary": "bool"
  }
]
```

**Update Tamagotchi Stats**

`PATCH` `/tamagotchis/{id}/stats` — Description: Updates a Tamagotchi's package-local stats. Payload:

```json
{
  "statUpdates": "object"
}
```

Success Response (200 OK):

```json
{
  "tamagotchiId": "string",
  "packageStats": "object"
}
```

**Add XP**

`POST` `/tamagotchis/{id}/xp` — Description: Adds experience points to a Tamagotchi, possibly leveling it up. Payload:

```json
{
  "xpAmount": "int"
}
```

Success Response (200 OK):

```json
{
  "tamagotchiId": "string",
  "level": "int",
  "xp": "int"
}
```

**Transfer Ownership**

`POST` `/tamagotchis/{id}/transfer-owner` — Description: Transfers a Tamagotchi to a new owner (e.g. on battle loss). Payload:

```json
{
  "newOwnerId": "string"
}
```

Success Response (200 OK):

```json
{
  "tamagotchiId": "string",
  "ownerId": "string"
}
```

#### Notification Service (`tamagotchi-notification`, Go)

**Register Device**

`POST` `/notifications/register-device` — Description: Registers a device's Firebase token for push notifications. Payload:

```json
{
  "userId": "string",
  "fcmToken": "string"
}
```

Success Response (200 OK):

```json
{
  "status": "string (enum: registered)"
}
```

**List Notifications**

`GET` `/notifications/{userId}` — Description: Lists a player's notifications.

Success Response (200 OK):

```json
[
  {
    "id": "string",
    "type": "string",
    "payload": "object",
    "read": "bool",
    "createdAt": "string (ISO 8601 timestamp)"
  }
]
```

> No public "send" endpoint — notifications are triggered internally by consuming events: `FriendRequestReceived`, `NearbyPlayerDetected`, `BattleRequestReceived`, `TamagotchiCaptured`, `GuildInvitation`, `RaidStarted`.

#### Map Service (`map-raid`, TypeScript)

**Update Location**

`POST` `/map/location` — Description: Updates a player's latest known geolocation. Payload:

```json
{
  "userId": "string",
  "lat": "float",
  "lng": "float",
  "timestamp": "string (ISO 8601 timestamp)"
}
```

Success Response (200 OK):

```json
{
  "status": "string (enum: updated)"
}
```

**Get Nearby Users**

`GET` `/map/nearby/{userId}` — Description: Lists users near a given player.

Success Response (200 OK):

```json
[
  {
    "userId": "string",
    "distance": "float",
    "relationship": "string"
  }
]
```

**Stream Location**

`WS` `/map/stream/{userId}` — Description: Client continuously streams its geolocation.

Client message:

```json
{
  "lat": "float",
  "lng": "float",
  "timestamp": "string (ISO 8601 timestamp)"
}
```

**Proximity Detected (event)**

Published when two unrelated users cross the proximity threshold (~6m).

```json
{
  "userAId": "string",
  "userBId": "string",
  "distance": "float"
}
```

#### Monster Raid Service (`map-raid`, TypeScript)

**Join Raid**

`POST` `/raids/{raidId}/join` — Description: Joins an active raid with a Tamagotchi. Payload:

```json
{
  "userId": "string",
  "tamagotchiId": "string"
}
```

Success Response (200 OK):

```json
{
  "raidId": "string",
  "participantCount": "int"
}
```

**Attack Raid Monster**

`POST` `/raids/{raidId}/attack` — Description: Deals damage to the shared raid monster. Payload:

```json
{
  "userId": "string"
}
```

Success Response (200 OK):

```json
{
  "raidId": "string",
  "monsterHp": "int",
  "damageDealt": "int"
}
```

**Get Raid**

`GET` `/raids/{raidId}` — Description: Retrieves the current state of a raid.

Success Response (200 OK):

```json
{
  "raidId": "string",
  "monsterHp": "int",
  "maxHp": "int",
  "participants": "array<object>",
  "status": "string",
  "expiresAt": "string (ISO 8601 timestamp)"
}
```

**Raid Completed / Raid Failed (events)**

Published on kill or on timeout.

```json
{
  "raidId": "string",
  "rewards": [
    {
      "userId": "string",
      "currency": "int",
      "xp": "int"
    }
  ]
}
```

```json
{
  "raidId": "string"
}
```

#### Guild Service (`guild-registry`, TypeScript)

**Search Guilds**

`GET` `/guilds/search` — Description: Searches guilds by name.

Query params:

```json
{
  "query": "string",
  "limit": "int",
  "offset": "int"
}
```

Success Response (200 OK):

```json
[
  {
    "guildId": "string",
    "name": "string",
    "memberCount": "int"
  }
]
```

**Join Guild**

`POST` `/guilds/{guildId}/join` — Description: Lets a player self-join an open guild (no invitation required). Payload:

```json
{
  "userId": "string"
}
```

Success Response (200 OK):

```json
{
  "status": "string (enum: joined)"
}
```

**Create Guild**

`POST` `/guilds` — Description: Creates a new guild. Payload:

```json
{
  "name": "string",
  "ownerId": "string"
}
```

Success Response (201 Created):

```json
{
  "guildId": "string",
  "name": "string"
}
```

**Invite/Add Member**

`POST` `/guilds/{guildId}/members` — Description: Invites or adds a member to a guild. Payload:

```json
{
  "userId": "string",
  "invitedBy": "string"
}
```

Success Response (200 OK):

```json
{
  "status": "string (enum: invited, joined)"
}
```

**Get Guild**

`GET` `/guilds/{guildId}` — Description: Retrieves a guild's details and members.

Success Response (200 OK):

```json
{
  "guildId": "string",
  "name": "string",
  "members": [
    {
      "userId": "string",
      "role": "string (enum: owner, officer, member)"
    }
  ]
}
```

**Update Member Role**

`PATCH` `/guilds/{guildId}/members/{userId}/role` — Description: Updates a guild member's role. Payload:

```json
{
  "role": "string (enum: owner, officer, member)"
}
```

Success Response (200 OK):

```json
{
  "userId": "string",
  "role": "string"
}
```

**Guild Chat**

`WS` `/guilds/{guildId}/chat` — Description: Bidirectional real-time guild chat.

Message shape (client ↔ server):

```json
{
  "authorId": "string",
  "message": "string",
  "timestamp": "string (ISO 8601 timestamp)"
}
```

#### Package Registry Service (`guild-registry`, TypeScript)

**Register Package**

`POST` `/packages` — Description: Registers a new client package. Payload:

```json
{
  "name": "string",
  "version": "string",
  "description": "string",
  "moderatorIds": "array<string>"
}
```

Success Response (201 Created):

```json
{
  "packageId": "string",
  "status": "string"
}
```

**Get Package**

`GET` `/packages/{packageId}` — Description: Retrieves a package's details.

Success Response (200 OK):

```json
{
  "packageId": "string",
  "name": "string",
  "version": "string",
  "status": "string",
  "statDefinitions": "object"
}
```

**Update Stat Definitions**

`PUT` `/packages/{packageId}/stat-definitions` — Description: Updates a package's local Tamagotchi stat definitions. Payload:

```json
{
  "statDefinitions": "object"
}
```

Success Response (200 OK):

```json
{
  "packageId": "string",
  "statDefinitions": "object"
}
```

**Register User to Package**

`POST` `/packages/{packageId}/users` — Description: Registers a player as belonging to a package. Payload:

```json
{
  "userId": "string"
}
```

Success Response (200 OK):

```json
{
  "status": "string (enum: registered)"
}
```

**Create Raid Config**

`POST` `/raid-configs` — Description: Creates a new Monster Raid configuration. Payload:

```json
{
  "monsterName": "string",
  "maxHp": "int",
  "duration": "int",
  "rewards": "object",
  "createdByAdminId": "string"
}
```

Success Response (201 Created):

```json
{
  "raidConfigId": "string"
}
```

**Activate Raid Config**

`POST` `/raid-configs/{id}/activate` — Description: Activates a raid configuration, spinning up a live raid.

Success Response (200 OK):

```json
{
  "raidId": "string",
  "status": "string (enum: active)"
}
```

## Architecture Diagram

![Architecture Diagram](docs/images/architecture.png)

## Contributing

Workflow rules for Team 14 — Tamagotchi Go (CPR + all submodules follow the same rules).

### Branches

- `main` — always deployable/presentable. Protected: no direct pushes, PRs only.
- `dev` — integration branch. Protected: no direct pushes, PRs only.
- Feature/fix branches, cut from `dev`:
  - `feature/<short-description>` — new functionality (e.g. `feature/battle-turn-endpoint`)
  - `fix/<short-description>` — bug fixes (e.g. `fix/currency-negative-balance`)
  - `chore/<short-description>` — tooling, docs, config (e.g. `chore/update-readme`)

### Pull requests

- Open PRs against `dev` (never directly against `main`).
- Title: short, imperative (e.g. "Add battle damage calculation").
- Description must include:
  - What changed and why
  - How it was tested
  - Linked issue/task from the GitHub Project, if any
- **At least 1 approval** required before merging (2 for changes touching a shared contract, e.g. `.gitmodules` or endpoint schemas in the CPR README).
- Merge strategy: **squash and merge** — keeps `dev`/`main` history linear and one commit per feature.
- CI (when set up) must pass before merge.
- Delete the branch after merging.

### Commits

- Use present-tense, imperative messages (e.g. "Add", not "Added"/"Adds").
- Keep commits scoped to one logical change.
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <description>`
  - `feat` — a new feature (e.g. `feat(battle): add turn action endpoint`)
  - `fix` — a bug fix (e.g. `fix(currency): prevent negative balance on adjust`)
  - `chore` — tooling, config, dependency bumps, non-code maintenance
  - `docs` — documentation only changes (e.g. README, CONTRIBUTING)
  - `refactor` — code change that neither fixes a bug nor adds a feature
  - `test` — adding or correcting tests
  - `perf` — a change that improves performance
  - `ci` — changes to CI configuration/scripts
  - Scope is optional but recommended — typically the service or module name (e.g. `guild`, `tamagotchi`, `map`).

### Test coverage

- New endpoints/business logic should ship with at least basic unit tests before a PR is opened.

### General

- Never commit `.env` files, credentials, API keys, or `node_modules`/`vendor` (see `.gitignore`).

## Getting Started

Clone the CPR together with all submodules:

```bash
git clone --recurse-submodules https://github.com/IsStephy/pad-team-14-tamagotchi-go.git
cd pad-team-14-tamagotchi-go
```

If you already cloned without `--recurse-submodules`, pull the submodule content separately:

```bash
git submodule update --init --recursive
```

Pull in the latest changes for every submodule later on:

```bash
git submodule update --remote --merge
```

Each submodule is an independent service repo — enter it and follow its own README for language-specific setup/run instructions:

```bash
cd user-battle              # or tamagotchi-notification / map-raid / guild-registry
```


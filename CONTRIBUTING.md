# Contributing

Workflow rules for Team 14 — Tamagotchi Go (CPR + all submodules follow the same rules).

## Branches

- `main` — always deployable/presentable. Protected: no direct pushes, PRs only.
- `dev` — integration branch. Protected: no direct pushes, PRs only.
- Feature/fix branches, cut from `dev`:
  - `feature/<short-description>` — new functionality (e.g. `feature/battle-turn-endpoint`)
  - `fix/<short-description>` — bug fixes (e.g. `fix/currency-negative-balance`)
  - `chore/<short-description>` — tooling, docs, config (e.g. `chore/update-readme`)

## Pull requests

- Open PRs against `dev` (never directly against `main`).
- Title: short, imperative (e.g. "Add battle damage calculation").
- Description must include:
  - What changed and why
  - Linked issue/task from the GitHub Project, if any
- **At least 1 approval** required before merging (2 for changes touching a shared contract, e.g. `.gitmodules` or endpoint schemas in the CPR README).
- Merge strategy: **merge commit** (no squash, no rebase) — every commit on the branch lands on `dev`/`main` as-is and the merge commit records which PR brought them in, so each commit must follow the commit rules below.
- CI (when set up) must pass before merge.
- Delete the branch after merging.

## Commits

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

## Database schema changes

We only share **images** (Docker Hub) and **contracts** (this repo) — never each
other's source or databases. Every database belongs to exactly one service, so
its migrations are that service's private business and must travel **inside its
image**:

- **Versioned migration files in the service repo**, run by a migration tool —
  e.g. `node-pg-migrate` (TypeScript) or `golang-migrate` (Go). Plain `.sql`
  files are preferred: anyone can read them.
- **Numbered sequentially:** `0001_short-name.sql`, `0002_…` — zero-padded and
  applied in that order. No timestamps; the number is the order.
- **Applied automatically on start-up**, before the service accepts requests.
  Nobody else ever runs your migrations by hand; pulling your new image and
  running `docker compose up` must be enough.
- **Tracked in a table in your own database**, so each migration runs exactly
  once, with a lock so two containers starting together can't both run one.
- **Fail fast:** if a migration fails, the service exits — it never serves on a
  half-migrated schema.
- **Never edit a migration once its image is published** — it has already run
  somewhere and won't run again. Add a new one.
- **Backward-compatible changes only, per release** (expand, then contract):
  e.g. add a column as nullable in `v1.1`, and drop the old one no earlier than
  `v1.2`. Rolling back to the previous image must still work against the newer
  schema, because teammates can only roll back by changing a tag.
- **Ship with a version bump:** a new migration means a new image tag, and the
  tag in the shared `docker-compose.yml` is updated in the same PR.
- **A schema change that alters an endpoint, response or event shape is a
  contract change** — update the CPR README contract first, with the
  2-approval rule above. Purely internal schema changes need no coordination.

Redis has no schema, but key names and value formats are an implicit one. When
changing them, either version the key prefix (e.g. `raid:v2:hp:<id>`), read the
old format while writing the new one for a release, or rely on key TTLs to age
old data out. Each service has its own Redis, so keys never clash across teams.

## General

- Never commit `.env` files, credentials, API keys, or `node_modules`/`vendor` (see `.gitignore`).

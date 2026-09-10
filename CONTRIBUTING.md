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
  - How it was tested
  - Linked issue/task from the GitHub Project, if any
- **At least 1 approval** required before merging (2 for changes touching a shared contract, e.g. `.gitmodules` or endpoint schemas in the CPR README).
- Merge strategy: **squash and merge** — keeps `dev`/`main` history linear and one commit per feature.
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


## Test coverage

- New endpoints/business logic should ship with at least basic unit tests before a PR is opened.

## General

- Never commit `.env` files, credentials, API keys, or `node_modules`/`vendor` (see `.gitignore`).

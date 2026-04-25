# Contributing to SmartScrape

Thanks for considering a contribution. This guide is short on purpose; if something here is wrong or missing, please open an issue.

## Dev setup

Prereqs: Node 20+, Docker Desktop (or compatible), npm 10+.

```bash
git clone https://github.com/9ny4/smartscrape.git
cd smartscrape
npm install
npx playwright install chromium

cp .env.example .env
# generate JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY — instructions in .env.example

docker compose up -d
npm run migrate:up --workspace server
npm run dev
```

- API → `http://localhost:3000`
- Client → `http://localhost:5173`
- Health → `http://localhost:3000/api/health`

## Working on a change

We follow a hard policy that maps cleanly onto the [Conventional Commits](https://www.conventionalcommits.org) spec:

1. **Open a GitHub issue first** — even for small fixes. Capture the number; you'll need it for the branch name.
2. **Branch off `main`** with `<type>/<issue-number>-<short-slug>`, where type is one of `feat | fix | chore | refactor | docs | test | build | ci | perf | style`. Examples: `feat/42-streak-command`, `fix/17-off-by-one-cooldown`.
3. **Small, focused commits** with the same conventional-commit type prefix. `git blame` should be useful.
4. **Open a PR** with body containing `Closes #<issue-number>` so merging auto-closes the issue.
5. **Wait for CI** to go green — five required checks (see below).
6. **Squash and merge** once approved. Keeps `main` linear.

Don't push directly to `main`.

## Required checks

Every PR runs:

| Check | What it does |
|---|---|
| `verify` | Prettier `format:check`, ESLint, TypeScript, server unit tests, full build |
| `audit` | `npm audit --audit-level=moderate` across the monorepo |
| `migrations` | Apply all migrations up, reverse them all, re-apply — round-trip test |
| `e2e` | Playwright smoke suite against a fresh Postgres + Redis + API + client |

Before pushing, run locally:

```bash
npm run format          # auto-fix if you've drifted
npm run lint
npm run typecheck
npm run test --workspace server
```

For UI changes:

```bash
npm run dev                              # one terminal
npm run test:e2e --workspace client      # another
```

Set `SKIP_RATE_LIMIT=1` on the dev server when running e2e back-to-back so the auth-entry limiter doesn't bite the shared-session fixture.

## Style

- Prettier formats everything (including JSON / YAML / Markdown). The repo enforces LF line endings via `.gitattributes` regardless of OS.
- ESLint config is in `eslint.config.mjs`. No bypassing rules without a comment justifying the exception.
- TypeScript is strict. Don't `any`-cast to bypass type errors; refactor or narrow.

## Tests

Backend unit tests live alongside the file under test (e.g. `server/src/lib/csv.test.ts`). Cover security-critical code paths — SSRF, CSV neutralization, cron validation, AI output validation — even if the change is small. The Playwright smoke suite under `client/tests/e2e` covers UI flows; only add to it when a regression actually warrants automation.

## Database changes

Use `npm run migrate:create -- <description> --workspace server`. Both `up` and `down` blocks are required. The CI `migrations` job exercises the down path, so a one-way migration will fail review.

## Commit messages

```
type(scope): short summary

Optional longer body. Wrap at ~72 cols. Explain *why*, not what — the
diff shows what.

Closes #<issue>
```

`scope` is optional but encouraged: `feat(jobs):`, `fix(scraper):`, `docs(readme):`. Use `!` for breaking changes (`feat!:`).

## Security

If you find a security issue, please email instead of opening a public issue. Repo owner contact is on the GitHub profile linked from the About card.

## Anything else

Open an issue with the `question` label and we'll figure it out.

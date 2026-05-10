# SmartScrape CLI

Headless command-line client for the SmartScrape REST API. Built so external
agents (OpenClaw, cron jobs, scripts) can drive SmartScrape without a browser.

## Install (within the monorepo)

```bash
npm install
npm run -w @smartscrape/cli build
node cli/dist/index.js --help
```

Once published or linked, the `smartscrape` binary is available globally.

## Configure

The CLI reads `SMARTSCRAPE_URL` and `SMARTSCRAPE_TOKEN` from the environment, or
falls back to `~/.smartscrape/config.json` written by `auth login`.

```bash
# Interactive login (writes config + refresh cookie)
smartscrape auth login --url http://localhost:3000 --email you@example.com --password '...'

# Personal access token — preferred for cron/agents, never expires until revoked
smartscrape auth tokens create --name "ci-runner" > /run/secrets/smartscrape-token
export SMARTSCRAPE_URL=http://localhost:3000
export SMARTSCRAPE_API_KEY=$(cat /run/secrets/smartscrape-token)
smartscrape jobs list --json

# JWT — works too, but cron needs to handle the refresh cookie
export SMARTSCRAPE_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

## Commands

```
auth login | logout | whoami
auth tokens list | create --name <n> | revoke <id>
jobs list | show <id> | create | edit <id> | delete <id> | toggle <id> | run <id>
jobs webhook test <id>      # send a synthetic payload to the configured URL
runs show <id> | data <id> | diff <id>
results <job-id>            # latest run's data
export <job-id> --csv | --json | --sheets
settings show | set <key=value> | unset <key>
providers list | set --provider <p> --key <k> | test <p> | delete <p>
notifications test email | telegram
dashboard stats
```

Pass `--webhook-url <url>` and `--webhook-secret <secret>` on `jobs create` /
`jobs edit` to receive POSTed run results. On `jobs edit`, an empty string
(e.g. `--webhook-url ""`) clears the field.

Every command supports `--json` (raw JSON to stdout) and `--quiet` (suppress
non-error output), plus `--server-url`, `--token`, and `--api-key` for
per-invocation overrides. Exit codes: `0` success, `1` generic error, `2` auth
failure, `3` not found, `4` validation error.

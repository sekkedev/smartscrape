# SmartScrape

AI-powered self-hosted web scraping with structured data extraction, change detection, and automated notifications. Describe what you want to track in plain English; the AI configures the scraping job, extracts structured data, detects changes across runs, and alerts you via email or Telegram. Export to Google Sheets or CSV.

> Status: **early scaffold**. See [HANDOFF-smartscrape.md](HANDOFF-smartscrape.md) for the full spec and Build Order.

## Stack

- **Backend:** Node.js + Express + TypeScript, PostgreSQL, Redis + BullMQ, Playwright + Cheerio
- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **AI:** OpenAI, Anthropic, OpenRouter (users bring their own keys)

## Prerequisites

- Node.js 20+ (`.nvmrc` pins to 20)
- Docker Desktop (for local Postgres + Redis)
- `npm` 10+

## Quickstart

```bash
# 1. Install dependencies for the whole monorepo
npm install

# 1a. Install the Chromium browser used by the Playwright scraper
npx playwright install chromium

# 2. Copy env template and fill in secrets
cp .env.example .env
# Generate values:
#   JWT_SECRET / JWT_REFRESH_SECRET: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   ENCRYPTION_KEY: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Start Postgres + Redis
docker compose up -d

# 4. Run the dev server + client (parallel)
npm run dev
```

- Server: <http://localhost:3000>
- Client: <http://localhost:5173>
- Health check: <http://localhost:3000/api/health>

The client renders the backend health status on load so you can confirm everything is wired up.

## Scripts

| Script             | Description                                    |
| ------------------ | ---------------------------------------------- |
| `npm run dev`      | Run server + client in parallel (watch mode)   |
| `npm run build`    | Build both workspaces                          |
| `npm run typecheck`| Type-check both workspaces                     |
| `npm run lint`     | ESLint across the repo                         |
| `npm run format`   | Prettier write                                 |

## Project layout

```
smartscrape/
  server/            # Express + TS API
  client/            # React + Vite + Tailwind SPA
  docker-compose.yml # Postgres 16 + Redis 7
  .env.example
  HANDOFF-smartscrape.md  # full v1 spec
```

## License

MIT

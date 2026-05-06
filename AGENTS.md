# AGENTS.md - Backend API

## Quick Start
```bash
npm run dev   # Start with nodemon (PORT env or default 4001)
npm start     # Production start
```

## Project Structure
- **Entry**: `app.js` (ES modules)
- **Legacy v1**: `routes/`, `controllers/`
- **v2 (current)**: `src/routes/v2/`, `src/controllers/`, `src/services/`, `src/clients/`, `src/middleware/`

## Key Commands
- `npm run dev` - Dev server with nodemon on port 4001 (or PORT from .env)
- No test framework configured (`npm test` does nothing)
- No lint/typecheck scripts defined

## Environment
- Copy `.env.example` to `.env` before running
- Required vars: `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `API_ACCESS_TOKEN`
- Optional: `RDSTATION_*` credentials, `OPENAI_API_KEY`, `EVOLUTION_API_*`
- Rate limiting enabled by default; set `SKIP_RATE_LIMIT=true` in development

## Integrations
- **Chatwoot**: Contact/conversation management
- **RD Station**: CRM integration with OAuth2 auto-refresh
- **InConcert**: Contact sync
- **Evolution API**: WhatsApp
- **OpenAI**: Optional AI conversation analysis

## Important Notes
- Webhook auth tokens are deprecated; use rate limiting instead
- v2 endpoints use `/api/v2/` prefix (health at `/api/v2/health`)
- Processing is async - webhooks return 202 immediately
- Check `src/TESTING_GUIDE.md` for endpoint testing examples (PowerShell/curl)
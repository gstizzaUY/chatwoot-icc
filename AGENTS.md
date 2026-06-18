# AGENTS.md - Backend API (iChef ICC App)

## Quick Start
```bash
npm run dev   # Start with nodemon (PORT env or default 4001)
npm start     # Production start
```

## Project Structure
- **Entry**: `app.js` (ES modules)
- **Legacy v1**: `routes/`, `controllers/`
- **v2 (current)**: `src/routes/v2/`, `src/controllers/`, `src/services/`, `src/clients/`, `src/middleware/`
- **AI Agents**: `src/agents/` — multi-agent orchestration system
- **Documentation**: `docs/` — unified technical docs

## Key Commands
- `npm run dev` - Dev server with nodemon on port 4001 (or PORT from .env)
- No test framework configured (`npm test` does nothing)
- No lint/typecheck scripts defined

## Environment
- Copy `.env.example` to `.env` before running
- Required vars: `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `API_ACCESS_TOKEN`
- **Critical for agents**: `OPENAI_API_KEY` (model: `gpt-4o-mini` via `OPENAI_MODEL`)
- Optional: `RDSTATION_*` credentials, `EVOLUTION_API_*`
- Rate limiting enabled by default; set `SKIP_RATE_LIMIT=true` in development

## Integrations
- **Chatwoot**: Contact/conversation management + webhooks (message_created, conversation_status_changed)
- **RD Station**: CRM integration with OAuth2 auto-refresh
- **InConcert**: Contact sync
- **Evolution API**: WhatsApp (HSM campaigns)
- **OpenAI**: Multi-agent AI system (GPT-4o-mini) + Whisper-1 (audio transcription) + GPT-4o Vision (image analysis)

## AI Agents System (4 agents)
The multi-agent system intervenes in Chatwoot conversations in real-time and at close.
See `docs/AI_AGENTS_SYSTEM.md` for full technical documentation.

| Agent | Trigger | Output | Channels |
|-------|---------|--------|----------|
| **Nutridor** | Bot trigger message ("Como no ingresaste ninguna opción...") | Public messages to client (chat + info capture) | 23 |
| **Pre-Venta** | Client msg #1, then every 3 | Internal note with sales suggestions | 23,33,1,20,34,46,12,45 |
| **Post-Venta** | Client msg #1, then every 3 | Internal note with support diagnosis | 41,38 |
| **Resumen** | Conversation → resolved | Full analysis + CRM sync (note with 7 sections) | All |

Key files:
- `src/services/agent-orchestrator.service.js` — Central orchestrator
- `src/agents/base/BaseAgent.js` — Abstract base class (OpenAI + CRM sync)
- `src/agents/nutridor/NutridorAgent.js` — Only agent that sends public messages
- `src/constants/agent.constants.js` — Channel mapping, triggers, rate limits
- `src/services/shared/field-protection.service.js` — Business rules (never-downgrade, forward-only)

## Webhook Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v2/webhooks/chatwoot/message-created` | Triggers Nutridor/PreVenta/PostVenta agents |
| `POST` | `/api/v2/webhooks/chatwoot/conversation-status-changed` | Triggers Resumen agent (post-close analysis) |
| `POST` | `/api/v2/webhooks/chatwoot/analyze-conversation` | Manual analysis (testing) |
| `POST` | `/api/v2/webhooks/chatwoot/bulk-analyze` | Batch analysis |
| `POST` | `/api/v2/webhooks/rdstation/conversion` | RD Station conversion events |
| `GET` | `/api/v2/health` | Health check |

## Important Notes
- Webhook auth tokens are deprecated; use rate limiting instead
- v2 endpoints use `/api/v2/` prefix (health at `/api/v2/health`)
- Processing is async — webhooks return 202 immediately; agents run via `setImmediate`
- Agents require `OPENAI_API_KEY` — without it, agents won't start (BaseAgent throws)
- Multimedia (audio/images) is processed via Whisper-1 and GPT-4o Vision; only client messages are processed
- Channel 23 has special Nutridor priority logic that blocks PreVenta when active
- Business rules are enforced in 3 layers: AI prompts → field-protection.service.js → CRM sync validation
- Check `docs/AI_AGENTS_SYSTEM.md` for complete architecture, flows, and debugging
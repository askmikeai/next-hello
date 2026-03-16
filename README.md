# NextHello

AI-powered networking assistant that turns event connections into booked meetings.

Built with **CrewAI** multi-agent orchestration and **WhatsApp** via Baileys.

---

## Quick Start

```bash
# Clone
git clone https://github.com/askmikeai/nexthello
cd nexthello

# Configure
cp crewai/.env.example crewai/.env
# Edit crewai/.env with your API keys

# Start
./nexthello start

# Run database migrations
./nexthello migrate

# Connect WhatsApp (scan QR code)
./nexthello whatsapp

# Check status
./nexthello status
```

**API Docs:** http://localhost:8001/docs

---

## Production Deploy (GitHub Actions)

This repo includes `.github/workflows/deploy-production.yml`.

- Trigger: push to `main` (or manual `workflow_dispatch`)
- Target: OCI VM over SSH
- Action: pull latest code, run Liquibase migrations, rebuild and restart app services

Set these GitHub repository secrets before enabling deploys:

- `PROD_HOST` - public IP or hostname of your OCI server
- `PROD_USER` - SSH user (for this setup: `ubuntu`)
- `PROD_SSH_KEY` - private SSH key (multi-line PEM)
- `PROD_PORT` - optional SSH port (`22` default)
- `PROD_APP_DIR` - optional app path (`/opt/nexthello/app` default)

---

## CLI Commands

```bash
./nexthello <command>
```

| Command | Description |
|---------|-------------|
| `start` | Start all services |
| `stop` | Stop all services |
| `restart` | Restart all services |
| `status` | Check service health |
| `logs` | View logs (all, api, worker, whatsapp) |
| `whatsapp` | Connect WhatsApp (scan QR code) |
| `migrate` | Run database migrations |
| `build` | Build Docker images |
| `rebuild` | Build and restart |
| `shell` | Open shell in API container |
| `help` | Show help |

### Examples

```bash
# Start everything
./nexthello start

# Check service health
./nexthello status

# Connect WhatsApp (interactive QR scan)
./nexthello whatsapp

# View API logs
./nexthello logs api

# View all logs
./nexthello logs

# Run a specific CLI command
./nexthello cli research
```

---

## Setup Requirements

### 1. Environment Configuration

Copy and edit the environment file:

```bash
cp crewai/.env.example crewai/.env
```

**Required:**
```bash
# LLM Provider (pick one)
LLM_PROVIDER=anthropic/claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...

# Or use OpenAI
# LLM_PROVIDER=openai/gpt-4o
# OPENAI_API_KEY=sk-...

# Event Configuration
OWNER_NAME="Your Name"
EVENT_NAME="Your Event Name"
```

**Optional Integrations:**
```bash
# Contact Enrichment
PDL_API_KEY=                        # People Data Labs

# Media Generation
HEYGEN_API_KEY=                     # AI video avatars
ELEVENLABS_API_KEY=                 # AI voice messages

# CRM Integration
HUBSPOT_API_KEY=                    # HubSpot sync

# Database (uses Docker Postgres by default)
SUPABASE_URL=                       # Optional external database
SUPABASE_KEY=
```

### 2. Database Setup

Run migrations after starting services:

```bash
./nexthello migrate
```

### 3. WhatsApp Authentication

WhatsApp requires a one-time QR code scan:

```bash
./nexthello whatsapp
```

1. QR code appears in terminal
2. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
3. Scan the QR code
4. Session persists in `nexthello-whatsapp-auth` Docker volume

To re-authenticate (if connection lost):
```bash
docker volume rm nexthello-whatsapp-auth
./nexthello whatsapp
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NextHello Stack                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │   WhatsApp   │───▶│    FastAPI   │───▶│  CrewAI   │  │
│  │    Bridge    │    │     API      │    │  Agents   │  │
│  │  (Baileys)   │◀───│  (port 8001) │◀───│           │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
│                             │                            │
│         ┌───────────────────┼───────────────────┐       │
│         ▼                   ▼                   ▼       │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │    Redis     │    │  PostgreSQL  │    │    ARQ    │  │
│  │   (State)    │    │  (Contacts)  │    │  Worker   │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Components

| Component | Location | Description |
|-----------|----------|-------------|
| **CLI** | `crewai/cli.py` | Service orchestrator with health checks |
| **API** | `crewai/src/api.py` | FastAPI server, webhooks, admin dashboard |
| **Worker** | `crewai/src/queue/worker.py` | ARQ background job processor |
| **Agents** | `crewai/src/agents/` | CrewAI agent definitions |
| **WhatsApp Connector** | `crewai/whatsapp-bridge/` | Node.js Baileys connector |

---

## CrewAI Agents

| Agent | Purpose | External API |
|-------|---------|--------------|
| **Research** | Contact & company enrichment | People Data Labs |
| **Qualification** | Lead scoring (0-100), tier assignment | - |
| **Personalization** | Message & script generation | - |
| **Video** | AI avatar video creation | HeyGen |
| **Voice** | Voice message synthesis | ElevenLabs |
| **CRM** | Contact synchronization | HubSpot |

---

## Docker Services

| Container | Port | Description |
|-----------|------|-------------|
| `api` | 8001 | FastAPI + CrewAI + CLI |
| `worker` | - | ARQ background jobs |
| `whatsapp` | - | Baileys WhatsApp connector |
| `postgres` | 5432 | PostgreSQL database |
| `redis` | 6379 | Conversation state & job queues |

### Common Commands

```bash
./nexthello start      # Start all services
./nexthello stop       # Stop all services
./nexthello status     # Check health
./nexthello logs       # View all logs
./nexthello logs api   # View API logs only
./nexthello whatsapp-test # Verify inbound persistence in PostgreSQL
./nexthello whatsapp-session-test # Verify session persistence + restore
./nexthello whatsapp-flow-test # Interactive inbound flow test (logs + DB)
./nexthello rebuild    # Rebuild and restart
./nexthello ps         # Show containers
```

---

## API Endpoints

### Health & Status
- `GET /health` - Service health check
- `GET /config` - Current configuration

### WhatsApp
- `POST /whatsapp/message` - Receive from WhatsApp connector
- `POST /send` - Queue outbound message

### Agents
- `POST /research` - Research a contact
- `POST /qualify` - Qualify a lead
- `POST /personalize/welcome` - Generate welcome message
- `POST /video/generate` - Generate HeyGen video
- `POST /voice/generate` - Generate voice message
- `POST /crm/sync` - Sync to HubSpot

### Admin Dashboard
- `GET /admin/api/contacts` - List contacts
- `GET /admin/api/stats` - Dashboard statistics
- `GET /admin/api/messages` - Message history
- `GET /admin/api/whatsapp/connector` - Connector status + live QR payload
- `GET /admin/api/whatsapp/messages/persisted` - Persisted WhatsApp messages from PostgreSQL

Full interactive docs at http://localhost:8001/docs

---

## UI Dashboard (CRM + Swarm Live)

A React + ReactFlow dashboard is available in `ui/`.

```bash
cd ui
npm install
npm run dev
```

Open http://localhost:5173.

Features:
- CRM contacts list and detail panel
- Trigger swarm actions (research, qualification, video, voice, crm)
- Manual outbound WhatsApp send
- Live swarm graph via SSE (`/admin/api/swarm/events`) rendered with ReactFlow

---

## Development

### Local Development (without Docker)

```bash
cd crewai

# Install dependencies
pip install -e .

# Start Redis (required)
redis-server

# Start all services via CLI
python cli.py start

# Or start services individually
python cli.py api      # Terminal 1: API on port 8001
python cli.py worker   # Terminal 2: Background jobs
python cli.py whatsapp # Terminal 3: WhatsApp connector runtime
python cli.py connect  # Show QR through API endpoint
```

## Troubleshooting

### WhatsApp not connecting

```bash
# Check logs
./nexthello logs whatsapp

# Re-authenticate (clear old session)
docker volume rm nexthello-whatsapp-auth
./nexthello whatsapp
```

### Jobs not processing

```bash
# Check worker logs
./nexthello logs worker

# Check all services
./nexthello status
```

### API not responding

```bash
# Check health
curl http://localhost:8001/health

# Check logs
./nexthello logs api
```

### OpenClaw helper setup

Use the template and keep your tokenized helper local (gitignored):

```bash
cp openclaw_http_helpers.template.sh openclaw_http_helpers.sh
chmod +x openclaw_http_helpers.sh
# edit OPENCLAW_GATEWAY_TOKEN and OPENCLAW_HOOKS_TOKEN in openclaw_http_helpers.sh
```

### Database issues

```bash
# Re-run migrations
./nexthello migrate

# Check PostgreSQL
docker compose logs postgres
```

---

## License

MIT

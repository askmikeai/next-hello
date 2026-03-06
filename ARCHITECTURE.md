# NextHello Architecture

> AI-powered networking follow-up automation that converts event connections into booked meetings.

## Overview

NextHello uses a **multi-agent swarm architecture** where Claude (Anthropic) acts as the central orchestrator, coordinating specialized agents to handle contact engagement, research, personalization, and outreach.

```
                                    ┌─────────────────┐
                                    │   WhatsApp /    │
                                    │   Email Input   │
                                    └────────┬────────┘
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR (Claude)                            │
│                                                                          │
│  • Processes all incoming messages                                       │
│  • Makes routing and response decisions                                  │
│  • Triggers agents via tool calls                                        │
│  • Maintains conversation state in Redis                                 │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
         ┌───────────┬───────────┼───────────┬───────────┬───────────┐
         ▼           ▼           ▼           ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │Research │ │Qualify  │ │  CRM    │ │ Video   │ │ Voice   │ │ Email   │
    │ Agent   │ │ Agent   │ │ Agent   │ │ Agent   │ │ Agent   │ │ Agent   │
    └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
         │           │           │           │           │           │
         ▼           ▼           ▼           ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ PDL API │ │ Scoring │ │ HubSpot │ │ HeyGen  │ │ElevenLabs││  IMAP   │
    │  Luma   │ │  Logic  │ │   API   │ │   API   │ │   API   │ │ SendGrid│
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

---

## Directory Structure

```
nexthello/
├── src/
│   ├── server.ts                 # HTTP server entry point
│   ├── swarm/                    # Multi-agent orchestration
│   │   ├── orchestrator.ts       # Claude AI brain
│   │   ├── agents/               # Specialized agents
│   │   ├── parallel/             # Parallel execution engine
│   │   ├── llm/                  # Claude SDK wrapper
│   │   └── tools/                # Tool definitions
│   ├── queue/                    # BullMQ job queue
│   │   ├── client.ts             # Queue setup
│   │   └── workers/              # Job processors
│   ├── admin/                    # Admin API
│   │   ├── routes.ts             # API endpoints
│   │   ├── api.ts                # API logic
│   ├── integrations/             # External APIs
│   │   ├── heygen/               # Video generation
│   │   ├── elevenlabs/           # Text-to-speech
│   │   ├── pdl/                  # Contact enrichment
│   │   ├── hubspot/              # CRM sync
│   │   ├── calendly/             # Scheduling
│   │   ├── luma/                 # Event scraping
│   │   └── email/                # Email send/receive
│   ├── channels/
│   │   └── whatsapp/             # Baileys integration
│   ├── database/                 # PostgreSQL client
│   ├── storage/                  # Media file storage
│   ├── history/                  # Message history
│   └── observability/            # Logging & metrics
├── crewai/                       # Python CrewAI API
├── migrations/liquibase/         # Database migrations
├── docker-compose.yml            # Infrastructure
└── nexthello.config.json         # Configuration
```

---

## Core Components

### 1. Swarm Orchestrator

**Location:** `src/swarm/orchestrator.ts`

The AI brain that processes all conversations using Claude. It:
- Loads conversation context from Redis
- Builds dynamic system prompts with contact data
- Calls Claude with available tools
- Executes tool calls (agent triggers)
- Manages conversation state

**Available Tools:**

| Tool | Purpose |
|------|---------|
| `contact_lookup` | Query contact database |
| `contact_update` | Save enriched contact data |
| `get_calendly_link` | Retrieve scheduling links |
| `send_video` | Send video to contact |
| `generate_video` | Create HeyGen video |
| `research_contact` | Trigger PDL enrichment |
| `trigger_parallel_tasks` | Execute multiple agents |
| `set_voice_mode` | Toggle voice responses |
| `send_voice_response` | Send TTS message |

### 2. Specialized Agents

**Location:** `src/swarm/agents/`

| Agent | Responsibility | Integration |
|-------|---------------|-------------|
| **Research** | Contact enrichment | PDL API, Luma |
| **Qualification** | Lead scoring (0-100) | Internal logic |
| **CRM** | HubSpot sync | HubSpot API |
| **Video** | Personalized videos | HeyGen API |
| **Voice** | Text-to-speech | ElevenLabs API |
| **Email** | Email send/receive | IMAP, SendGrid |

**Agent Dependencies:**
```
Research ──► Qualification (waits for research)
     │
     └──► CRM, Video, Voice (run in parallel)
```

### 3. Parallel Execution

**Location:** `src/swarm/parallel/`

Executes agent tasks with three strategies:

| Strategy | Use Case |
|----------|----------|
| `fire-and-forget` | Video, voice, CRM (non-blocking) |
| `wait-all` | Research → Qualification pipeline |
| `first-wins` | Redundant lookups |

### 4. Job Queue (BullMQ)

**Location:** `src/queue/`

| Queue | Purpose | Concurrency |
|-------|---------|-------------|
| `incoming-messages` | Process WhatsApp messages | 5 |
| `outbound-messages` | Send messages/videos | 5 |
| `video-generation` | HeyGen jobs | 2 |
| `voice-generation` | ElevenLabs TTS | 2 |
| `research-jobs` | PDL enrichment | 3 |
| `crm-sync` | HubSpot sync | 3 |
| `agent-tasks` | Parallel execution | 5 |
| `luma-sync` | Event scraping | 1 |

---

## Database Schema

**Location:** `migrations/liquibase/`

### Core Tables

**networking_contacts**
```sql
- id, phone_number, email
- first_name, last_name
- company_name, job_title, industry
- qualification_tier (hot/warm/cold/unqualified)
- qualification_score (0-100)
- research_status, research_data (JSONB)
- status (new/active/welcomed/collecting/fields_complete/synced/meeting_scheduled/complete)
- luma_guest_id (FK to luma_guests)
```

**message_history**
```sql
- id, contact_id, correlation_id
- direction (inbound/outbound)
- channel (whatsapp/telegram/email)
- message_type (text/image/video/audio/document/sticker/location)
- content, media_url, media_mimetype
- location_latitude, location_longitude
- is_voice_note, is_video_note, is_view_once
```

**agent_activity_log**
```sql
- id, correlation_id, contact_id
- agent_type (orchestrator/research/qualification/crm/video/voice)
- action, status (started/completed/failed)
- started_at, completed_at, duration_ms
- input_tokens, output_tokens
```

**media_files**
```sql
- id, contact_id, phone_number
- storage_key, storage_backend (local/s3/r2)
- media_type (voice/video/image/document/avatar)
- mime_type, size_bytes, checksum_sha256
- retention_policy (temporary/standard/extended/permanent)
- expires_at, deleted_at
```

**pdl_person_enrichment**
```sql
- id, contact_id, pdl_id, likelihood
- full_name, job_title, job_company_name
- job_company_size, job_company_industry
- linkedin_url, work_email, mobile_phone
- experience (JSONB), education (JSONB)
- skills, interests, languages
- inferred_salary, inferred_years_experience
```

**luma_events / luma_guests / contact_luma_associations**
```sql
- Event: slug, name, url, event_date, host_name, guest_count
- Guest: email, name, phone, bio, luma_url
- Association: contact_id, guest_id, matched_at_event_id
```

---

## Message Flow

```
WhatsApp Message
       │
       ▼
┌──────────────────┐
│ incoming-messages│  (BullMQ queue)
│      queue       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Message Worker  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│           SwarmOrchestrator                  │
│                                              │
│  1. Load state from Redis                    │
│  2. Build system prompt with context         │
│  3. Call Claude with available tools         │
│  4. Execute tool calls                       │
│  5. Trigger parallel background tasks        │
│  6. Save response to message history         │
│  7. Update Redis state                       │
└──────────────────────────────────────────────┘
         │
         ├──► Immediate Response (text/voice)
         │
         └──► Background Tasks
              ├──► research-jobs queue
              ├──► video-generation queue
              ├──► voice-generation queue
              └──► crm-sync queue
```

### Voice Mode

```
User sends VOICE message ──► Auto-enable voice mode ──► Respond with VOICE
User sends TEXT message   ──► Check voice mode state ──► Respond accordingly
User asks for "text"      ──► Disable voice mode      ──► Respond with TEXT
```

---

## Admin API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/api/health` | Redis + Postgres health |
| `GET /admin/api/stats` | Contact statistics |
| `GET /admin/api/contacts` | List contacts |
| `GET /admin/api/contacts/:id` | Contact detail |
| `GET /admin/api/contacts/:id/enrichment` | PDL data |
| `GET /admin/api/contacts/:id/messages` | Conversation history |
| `GET /admin/api/contacts/:id/media` | Media files |
| `GET /admin/api/contacts/:id/luma` | Luma associations |
| `GET /admin/api/contacts/:id/activities` | Agent activities |
| `GET /admin/api/swarm/states` | Active conversations |
| `GET /admin/api/swarm/events` | SSE event stream |
| `GET /admin/api/activities` | Recent agent activities |
| `GET /admin/api/queues` | Queue statistics |

---

## Integrations

### HeyGen (Video)
- Personalized avatar videos
- Webhook for completion: `/webhooks/heygen`
- Mock mode: `HEYGEN_MOCK_MODE=true`

### ElevenLabs (Voice)
- Text-to-speech synthesis
- Multiple voice options
- Audio stored in media store

### People Data Labs (Research)
- Contact enrichment via email, phone, LinkedIn
- Returns: work history, education, skills, salary

### HubSpot (CRM)
- Contact and deal synchronization
- Two-way sync support

### Calendly (Scheduling)
- Single-use scheduling links
- OAuth for calendar access
- Webhook: `/webhooks/calendly`

### Luma (Events)
- Playwright-based event scraping
- Guest extraction and contact matching
- OTP login support

### WhatsApp (Baileys)
- Session-based connection
- QR code pairing
- Text/media messaging

---

## Infrastructure

### Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| `nexthello-legacy` | 3000 | Main HTTP server |
| `nexthello-api` | 8001 | Python CrewAI API |
| `nexthello-worker` | - | BullMQ workers |
| `nexthello-postgres` | 5432 | Database |
| `nexthello-redis` | 6379 | Queue + state |
| `nexthello-minio` | 9000 | S3 storage |
| `nexthello-prometheus` | 9090 | Metrics |
| `nexthello-grafana` | 3001 | Dashboards |
| `nexthello-whatsapp` | - | WhatsApp Baileys connector |

### Volumes

- `nexthello-auth` - WhatsApp sessions
- `nexthello-media` - Media files
- `nexthello-postgres` - Database data
- `nexthello-redis` - Redis persistence
- `nexthello-whatsapp-auth` - WhatsApp connector auth

---

## Observability

### Logging (Pino)
- Structured JSON logs
- Correlation IDs for tracing
- Component-based child loggers

### Metrics (Prometheus)

| Metric | Type | Description |
|--------|------|-------------|
| `nexthello_agent_executions_total` | Counter | Agent calls by type |
| `nexthello_llm_calls_total` | Counter | Claude API calls |
| `nexthello_tokens_used_total` | Counter | Token consumption |
| `nexthello_jobs_processed_total` | Counter | Worker jobs |
| `nexthello_parallel_tasks_total` | Counter | Parallel executions |
| `nexthello_http_requests_total` | Counter | HTTP requests |

### Activity Store
- Agent execution tracking in PostgreSQL
- Query interface for admin dashboard

---

## Configuration

**File:** `nexthello.config.json`

```json
{
  "enabled": true,
  "eventName": "Conference 2026",
  "ownerName": "Michael Friedberg",
  "requiredFields": ["email", "company_name", "job_title"],

  "heygen": {
    "enabled": true,
    "avatarId": "...",
    "voiceId": "..."
  },

  "elevenlabs": {
    "voiceId": "...",
    "modelId": "eleven_turbo_v2_5"
  },

  "calendly": {
    "schedulingLink": "https://calendly.com/..."
  },

  "swarm": {
    "enabled": true,
    "maxConversationTurns": 20,
    "defaultModel": "claude-sonnet-4-20250514"
  },

  "storage": {
    "backend": "local",
    "retention": { "defaultDays": 30 }
  }
}
```

### Environment Variables

```bash
# AI (Required)
ANTHROPIC_API_KEY=sk-ant-...

# Database (Required)
DATABASE_URL=postgres://user:pass@localhost:5432/nexthello

# Redis (Required)
REDIS_HOST=localhost
REDIS_PORT=6379

# Video Generation
HEYGEN_API_KEY=sk_...
HEYGEN_MOCK_MODE=true

# Voice Generation
ELEVENLABS_API_KEY=...

# Contact Enrichment
PDL_API_KEY=...

# CRM
HUBSPOT_API_KEY=pat-...

# Scheduling
CALENDLY_API_KEY=...
```

---

## Development

### Commands

```bash
# Start services
docker-compose up -d

# Run migrations
liquibase --changelog-file=migrations/liquibase/changelog.xml update

# Development
npm run dev              # TypeScript watch
npm start                # Run compiled server

# Testing
npm test                 # Unit tests
npm run test:swarm:e2e   # E2E swarm test

# WhatsApp connection
npx tsx scripts/connect-session.ts session-1 <phone>
```

### Key Files

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP server, worker startup |
| `src/swarm/orchestrator.ts` | AI brain |
| `src/swarm/parallel/task-runner.ts` | Parallel execution |
| `src/queue/client.ts` | BullMQ setup |
| `src/admin/routes.ts` | Dashboard API |
| `docker-compose.yml` | Infrastructure |

---

## Design Principles

1. **Single Orchestrator** - One Claude instance handles all conversations
2. **Specialized Agents** - Each agent has ONE responsibility
3. **Async-First** - Heavy operations use BullMQ queues
4. **Tool-Based Actions** - Claude uses tool_use to trigger agents
5. **Redis State** - Per-phone conversation context
6. **Graceful Degradation** - Works without Redis/S3 (fallbacks)
7. **Observable** - Prometheus metrics, structured logging, activity tracking
8. **GDPR Compliant** - Media tracking with retention policies

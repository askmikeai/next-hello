# NextHello Architecture

> AI-powered networking swarm that converts event connections into booked meetings.

## System Overview

**Architecture Type:** Multi-agent swarm with orchestrator pattern
**Agent Model:** LLM-powered agents (Anthropic Claude) with tool use
**Infrastructure:** Redis (state/queues), PostgreSQL (persistence), BullMQ (job processing)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NEXTHELLO SWARM                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                       ┌─────────────────────┐                               │
│                       │  SwarmOrchestrator  │                               │
│                       │ (Central Coordinator)│                               │
│                       └──────────┬──────────┘                               │
│                                  │                                           │
│         ┌────────────┬───────────┼───────────┬────────────┬────────────┐    │
│         │            │           │           │            │            │    │
│    ┌────▼────┐ ┌─────▼────┐ ┌────▼────┐ ┌────▼─────┐ ┌────▼───┐ ┌─────▼──┐ │
│    │Conversa-│ │ Research │ │Qualifi- │ │  Voice   │ │ Video  │ │  CRM   │ │
│    │  tion   │ │  Agent   │ │ cation  │ │  Agent   │ │ Agent  │ │ Agent  │ │
│    │  Agent  │ │          │ │  Agent  │ │(Eleven-  │ │(HeyGen)│ │(HubSpot│ │
│    │         │ │(LinkedIn)│ │         │ │  Labs)   │ │        │ │        │ │
│    └────┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘ └────┬───┘ └────┬───┘ │
│         │           │            │           │            │          │      │
│         └───────────┴────────────┴───────────┴────────────┴──────────┘      │
│                                  │                                           │
│                                  ▼                                           │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │                        Tool Executor                              │     │
│    │  ┌──────────────┬──────────────┬──────────────┬───────────────┐  │     │
│    │  │contact_lookup│contact_update│calendly_link │linkedin_research│ │     │
│    │  ├──────────────┼──────────────┼──────────────┼───────────────┤  │     │
│    │  │generate_voice│ send_video   │  sync_to_crm │ delete_contact│  │     │
│    │  └──────────────┴──────────────┴──────────────┴───────────────┘  │     │
│    └──────────────────────────────────────────────────────────────────┘     │
│                                  │                                           │
│         ┌────────────────────────┼────────────────────────┐                 │
│         ▼                        ▼                        ▼                 │
│    ┌─────────┐            ┌─────────────┐          ┌──────────┐            │
│    │  Redis  │            │ PostgreSQL  │          │  BullMQ  │            │
│    │ (State) │            │ (Database)  │          │ (Queues) │            │
│    └─────────┘            └─────────────┘          └──────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Agent Architecture

### SwarmOrchestrator

The central coordinator that:
- Routes incoming messages to appropriate agents
- Manages swarm state in Redis
- Handles agent-to-agent handoffs
- Provides fallback to rule-based handling when AI fails
- Tracks conversation turns and context

### Specialized Agents

| Agent | Type | Purpose | Tools | Temperature |
|-------|------|---------|-------|-------------|
| **ConversationAgent** | conversation | Natural language dialog, field collection | `contact_lookup`, `contact_update`, `calendly_link`, `send_video` | 0.7 |
| **ResearchAgent** | research | LinkedIn/company research, profile enrichment | `linkedin_research`, `update_research_status` | 0.3 |
| **QualificationAgent** | qualification | Lead scoring (hot/warm/cold/unqualified) | `set_qualification`, `get_engagement_data` | 0.2 |
| **VoiceAgent** | voice | ElevenLabs voice message generation | `generate_voice`, `send_voice` | 0.6 |
| **VideoAgent** | video | HeyGen video coordination | `generate_video`, `check_video_status` | 0.5 |
| **CRMAgent** | crm | HubSpot synchronization | `sync_to_crm`, `update_crm_status` | 0.3 |

### Tool System

Tools are registered with the `ToolExecutor` and exposed to agents via Claude's tool use:

```typescript
// Example tool definition
registerTool(
  "contact_lookup",
  "Look up a contact by phone number",
  { phoneNumber: { type: "string", description: "Phone number to look up" } },
  async (input, context) => {
    const contact = await findContactByPhone(input.phoneNumber, context.config.supabase);
    return contact || { error: "Contact not found" };
  }
);
```

## Infrastructure

### Job Queues (BullMQ + Redis)

| Queue | Purpose | Priority |
|-------|---------|----------|
| `incoming-messages` | WhatsApp/Telegram messages | High |
| `agent-tasks` | Agent-to-agent handoffs | Normal |
| `research-jobs` | Background LinkedIn research | Low |
| `video-generation` | Long-running HeyGen jobs | Low |
| `voice-generation` | ElevenLabs voice message jobs | Low |
| `crm-sync` | Background CRM synchronization | Low |
| `lead-qualification` | Batch lead scoring | Low |

### Resilience

**Circuit Breakers** protect against cascading failures:
- Per-integration breakers (Claude, HeyGen, ElevenLabs, LinkedIn, HubSpot, PostgreSQL, Redis)
- Configurable failure thresholds and recovery times
- Automatic state transitions: Closed → Open → Half-Open → Closed

**Retry Logic:**
- Exponential backoff with jitter
- Max 3 attempts per operation
- Configurable per-queue retry policies

### Observability (Cross-Cutting Layer)

The observability layer spans the entire system, providing visibility into all components.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OBSERVABILITY LAYER                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │    Pino      │  │  Prometheus  │  │   Activity   │  │    Health     │   │
│  │   Logging    │  │   Metrics    │  │    Store     │  │    Checks     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘   │
│         │                 │                 │                   │           │
│         └─────────────────┴─────────────────┴───────────────────┘           │
│                                     │                                        │
│    Spans: Agents | Queues | LLM | Database | Redis | Integrations | HTTP    │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

**Structured Logging (Pino):**
- Correlation IDs for end-to-end request tracing
- Child loggers for agents, workers, requests
- Automatic sensitive data redaction (passwords, tokens, API keys)
- Structured event logging (`logEvent`, `logError`, `logLLMInteraction`, `logAgentActivity`, `logQueueJob`)
- JSON format in production, pino-pretty in development

**Metrics (Prometheus):**

| Category | Metrics |
|----------|---------|
| **Agent** | `nexthello_agent_executions_total`, `nexthello_agent_execution_duration_seconds`, `nexthello_active_agents` |
| **LLM** | `nexthello_llm_calls_total`, `nexthello_llm_call_duration_seconds`, `nexthello_tokens_used_total`, `nexthello_llm_cost_usd_total` |
| **Queue** | `nexthello_queue_depth`, `nexthello_queue_active_jobs`, `nexthello_jobs_processed_total`, `nexthello_job_processing_duration_seconds` |
| **Message** | `nexthello_messages_received_total`, `nexthello_messages_sent_total`, `nexthello_message_processing_duration_seconds` |
| **Contact** | `nexthello_contacts_by_status`, `nexthello_contacts_by_qualification`, `nexthello_contacts_created_total` |
| **Database** | `nexthello_db_queries_total`, `nexthello_db_query_duration_seconds`, `nexthello_db_connection_pool` |
| **Redis** | `nexthello_redis_ops_total`, `nexthello_redis_op_duration_seconds`, `nexthello_redis_connected` |
| **HTTP** | `nexthello_http_requests_total`, `nexthello_http_request_duration_seconds` |
| **Integration** | `nexthello_integration_calls_total`, `nexthello_integration_call_duration_seconds`, `nexthello_circuit_breaker_state` |

**Activity Store (PostgreSQL):**
- Persists all agent activity to `agent_activity_log` table
- Tracks: agent type, action, duration, tokens used, errors
- Query by correlation ID or agent type
- Enables debugging and analytics

**Health Checks (`/health`):**
- Dependency status (Redis, PostgreSQL, Claude API)
- Returns: `healthy`, `degraded`, or `unhealthy`
- Latency measurements per dependency

## Data Flow

### Incoming Message Flow

```
WhatsApp Message
       │
       ▼
┌──────────────────┐
│  Message Queue   │
│ (incoming-messages)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ SwarmOrchestrator│
│                  │
│ 1. Load state    │
│ 2. Analyze intent│
│ 3. Route to agent│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ConversationAgent │
│                  │
│ 1. Build context │
│ 2. Call Claude   │
│ 3. Execute tools │
│ 4. Return response│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Send Response   │
│  Update State    │
│  Log Activity    │
└──────────────────┘
```

### Background Processing Flow

```
Contact Created/Updated
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│  Research Queue  │────▶│  ResearchAgent   │
└──────────────────┘     │                  │
                         │ • LinkedIn lookup│
                         │ • Company data   │
                         │ • Update contact │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │Qualification Queue│
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │QualificationAgent│
                         │                  │
                         │ • Score lead     │
                         │ • Assign tier    │
                         │ • Update contact │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   CRM Queue      │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │    CRMAgent      │
                         │                  │
                         │ • Sync to HubSpot│
                         └──────────────────┘
```

## Directory Structure

```
nexthello/
├── src/
│   ├── swarm/                      # AI Swarm System
│   │   ├── orchestrator.ts         # Central coordinator
│   │   ├── base-agent.ts           # Abstract agent class
│   │   ├── index.ts                # Swarm exports
│   │   ├── types.ts                # Type definitions
│   │   ├── agents/
│   │   │   ├── conversation.agent.ts
│   │   │   ├── research.agent.ts
│   │   │   ├── qualification.agent.ts
│   │   │   ├── voice.agent.ts      # ElevenLabs voice messages
│   │   │   ├── video.agent.ts
│   │   │   └── crm.agent.ts
│   │   ├── llm/
│   │   │   ├── client.ts           # Anthropic SDK wrapper
│   │   │   └── tool-executor.ts    # Tool registration & execution
│   │   └── state/
│   │       └── swarm-state.ts      # Redis state management
│   │
│   ├── queue/                      # Job Queue Management
│   │   └── client.ts               # BullMQ/Redis setup
│   │
│   ├── workers/                    # Background Job Processors
│   │   ├── message.worker.ts       # Incoming message processing
│   │   ├── research.worker.ts      # LinkedIn research jobs
│   │   ├── video.worker.ts         # HeyGen video generation
│   │   ├── video-poller.ts         # Video completion polling
│   │   └── crm.worker.ts           # CRM sync jobs
│   │
│   ├── history/                    # Conversation Context
│   │   ├── message-store.ts        # Message persistence (PostgreSQL)
│   │   └── context-builder.ts      # Context window management
│   │
│   ├── observability/              # Monitoring
│   │   ├── logger.ts               # Pino structured logging
│   │   ├── metrics.ts              # Prometheus metrics
│   │   ├── health.ts               # Health checks
│   │   └── activity-store.ts       # Agent activity logging
│   │
│   ├── resilience/                 # Fault Tolerance
│   │   ├── circuit-breaker.ts      # Circuit breaker pattern
│   │   ├── retry.ts                # Exponential backoff
│   │   └── rate-limiter.ts         # Rate limiting
│   │
│   ├── channels/whatsapp/          # WhatsApp Client (Baileys)
│   ├── handlers/                   # Message Routing
│   ├── contacts/                   # Contact Management
│   ├── database/                   # PostgreSQL client
│   ├── storage/                    # S3/file storage (FlyDrive)
│   ├── integrations/               # External APIs
│   │   ├── heygen/                 # Video generation
│   │   ├── elevenlabs/             # Voice message TTS
│   │   ├── calendly/               # Scheduling
│   │   ├── linkedin/               # Profile research (ProxyCurl)
│   │   ├── crm/                    # HubSpot integration
│   │   └── email/                  # SendGrid email
│   ├── webhooks/                   # Callback Handlers
│   ├── cli/                        # CLI Interface
│   ├── config/                     # Configuration (Zod validation)
│   ├── tests/                      # Test files
│   └── server.ts                   # HTTP Server
│
├── migrations/liquibase/           # Database Migrations
│   ├── changelog.xml               # Liquibase changelog
│   ├── changesets/                 # Changeset files
│   │   └── 003-message-types.xml
│   └── sql/
│       ├── 001_swarm_tables.sql    # Swarm tables
│       └── 002_message_types.sql   # Message types
│
├── monitoring/                     # Grafana & Prometheus configs
├── docker-compose.yml              # Container orchestration
└── .env                            # Environment variables
```

## Database Schema

### Core Tables

```sql
-- Contact information
CREATE TABLE networking_contacts (
    id UUID PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    company_name TEXT,
    job_title TEXT,
    linkedin_url TEXT,
    status TEXT,
    -- Swarm fields
    qualification_score NUMERIC(5,2),
    qualification_tier TEXT,  -- hot/warm/cold/unqualified
    research_status TEXT,     -- pending/in_progress/complete/failed
    research_data JSONB,
    total_turns INTEGER,
    swarm_metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

-- Conversation history
CREATE TABLE message_history (
    id UUID PRIMARY KEY,
    contact_id UUID REFERENCES networking_contacts(id),
    phone_number TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    direction TEXT NOT NULL,  -- inbound/outbound
    channel TEXT NOT NULL,    -- whatsapp/telegram/email
    content TEXT NOT NULL,
    agent_id TEXT,
    model_used TEXT,
    tokens_used INTEGER,
    tool_calls JSONB,
    created_at TIMESTAMPTZ
);

-- Agent activity tracking
CREATE TABLE agent_activity_log (
    id UUID PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    contact_id UUID,
    agent_type TEXT NOT NULL,
    action TEXT NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    status TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    error_message TEXT
);
```

## Configuration

### Environment Variables

```bash
# Database (PostgreSQL)
DATABASE_URL=postgres://user:pass@localhost:5432/nexthello
# OR individual params:
PGHOST=localhost
PGPORT=5432
PGUSER=nexthello
PGPASSWORD=...
PGDATABASE=nexthello

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=...

# Swarm
SWARM_ENABLED=true
SWARM_ROLLOUT_PERCENTAGE=100

# Integrations
HEYGEN_API_KEY=sk_...
ELEVENLABS_API_KEY=...
HUBSPOT_API_KEY=pat-...
PROXYCURL_API_KEY=...  # LinkedIn research
SENDGRID_API_KEY=...   # Email sending
```

### Swarm Configuration

```typescript
interface SwarmConfig {
  enabled: boolean;              // Enable AI swarm
  rolloutPercentage: number;     // 0-100 gradual rollout
  fallbackToRules: boolean;      // Fallback when AI fails
  maxConversationTurns: number;  // Max turns before handoff
  contextTokenBudget: number;    // Token limit for context
  defaultModel: string;          // claude-sonnet-4-20250514
}
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 |
| Language | TypeScript |
| LLM | Anthropic Claude (claude-sonnet-4-20250514) |
| LLM SDK | @anthropic-ai/sdk |
| Queue | BullMQ |
| Cache/State | Redis (ioredis) |
| Database | PostgreSQL (postgres library) |
| Migrations | Liquibase |
| Logging | Pino |
| Metrics | prom-client |
| Resilience | Cockatiel |
| WhatsApp | @whiskeysockets/baileys |
| Video | HeyGen API |
| Voice/TTS | ElevenLabs API |
| Scheduling | Calendly API |
| LinkedIn | ProxyCurl API |
| CRM | HubSpot API |
| Email | SendGrid API |
| Storage | FlyDrive + AWS S3 |
| Container | Docker |

## Deployment

### Docker Compose Services

| Service | Purpose |
|---------|---------|
| **nexthello** | Main application server (Node.js) |
| **postgres** | PostgreSQL database |
| **redis** | Redis cache/queues |
| **liquibase** | Database migrations |
| **grafana** | Metrics dashboard |
| **prometheus** | Metrics collection |
| **setup** | Interactive configuration |
| **connect** | WhatsApp QR code scanner |

### Volumes

- `nexthello-auth` - WhatsApp credentials
- `postgres-data` - Database files
- `redis-data` - Queue persistence

### Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    volumes: ["postgres-data:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]

  nexthello:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - SWARM_ENABLED=true
      - REDIS_HOST=redis
      - PGHOST=postgres
    ports: ["3000:3000"]
    volumes: ["nexthello-auth:/app/data/auth"]
```

### Commands

```bash
# Start with swarm enabled
docker compose up -d

# Run swarm test
npx tsx src/swarm/test-swarm.ts

# View logs
docker compose logs -f nexthello

# Check health
curl http://localhost:3000/health
```

## Key Design Decisions

1. **Orchestrator Pattern**: Central coordinator routes to specialized agents rather than peer-to-peer
2. **Tool-based Actions**: Agents use Claude's tool use for structured operations
3. **Redis State**: Conversation state persisted in Redis for scalability
4. **Async Processing**: Background queues for research, qualification, CRM sync
5. **Graceful Degradation**: Automatic fallback to rule-based when AI fails
6. **Circuit Breakers**: Per-integration protection against cascading failures
7. **Correlation IDs**: Full request tracing across agents and services

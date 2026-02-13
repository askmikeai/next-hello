# NextHello Architecture

> AI-powered networking swarm that converts event connections into booked meetings.

## System Overview

**Architecture Type:** Multi-agent swarm with orchestrator pattern
**Agent Model:** LLM-powered agents (Anthropic Claude) with tool use
**Infrastructure:** Redis (state/queues), Supabase (persistence), BullMQ (job processing)

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
│    │Conversa-│ │ Research │ │Qualifi- │ │Personal- │ │ Video  │ │  CRM   │ │
│    │  tion   │ │  Agent   │ │ cation  │ │ ization  │ │ Agent  │ │ Agent  │ │
│    │  Agent  │ │          │ │  Agent  │ │  Agent   │ │        │ │        │ │
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
│    │  │set_qualific- │get_engagement│update_research│    ...       │  │     │
│    │  │   ation      │    _data     │   _status    │               │  │     │
│    │  └──────────────┴──────────────┴──────────────┴───────────────┘  │     │
│    └──────────────────────────────────────────────────────────────────┘     │
│                                  │                                           │
│         ┌────────────────────────┼────────────────────────┐                 │
│         ▼                        ▼                        ▼                 │
│    ┌─────────┐            ┌─────────────┐          ┌──────────┐            │
│    │  Redis  │            │  Supabase   │          │  BullMQ  │            │
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

| Agent | Purpose | Tools |
|-------|---------|-------|
| **ConversationAgent** | Natural language dialog, field collection | `contact_lookup`, `contact_update`, `calendly_link` |
| **ResearchAgent** | LinkedIn/company research, profile enrichment | `linkedin_research`, `update_research_status` |
| **QualificationAgent** | Lead scoring (hot/warm/cold/unqualified) | `set_qualification`, `get_engagement_data` |
| **PersonalizationAgent** | Dynamic content generation | Template tools |
| **VideoAgent** | HeyGen video coordination | `generate_video`, `check_video_status` |
| **CRMAgent** | HubSpot synchronization | `sync_to_crm`, `update_crm_status` |

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
| `crm-sync` | Background CRM synchronization | Low |
| `lead-qualification` | Batch lead scoring | Low |

### Resilience

**Circuit Breakers** protect against cascading failures:
- Per-integration breakers (Claude, HeyGen, LinkedIn, HubSpot, Supabase, Redis)
- Configurable failure thresholds and recovery times
- Automatic state transitions: Closed → Open → Half-Open → Closed

**Retry Logic:**
- Exponential backoff with jitter
- Max 3 attempts per operation
- Configurable per-queue retry policies

### Observability

**Structured Logging (Pino):**
- Correlation IDs for request tracing
- Automatic sensitive data redaction
- JSON format in production, pretty-print in development

**Metrics (Prometheus):**
- Agent execution counts and durations
- LLM token usage and latency
- Queue depths and processing times
- Circuit breaker states

**Health Checks:**
- `/health` endpoint with dependency status
- Redis, Supabase, Claude API connectivity

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
│   │   │   ├── personalization.agent.ts
│   │   │   ├── video.agent.ts
│   │   │   └── crm.agent.ts
│   │   ├── llm/
│   │   │   ├── client.ts           # Anthropic SDK wrapper
│   │   │   └── tool-executor.ts    # Tool registration & execution
│   │   └── state/
│   │       └── swarm-state.ts      # Redis state management
│   │
│   ├── queue/                      # Job Processing
│   │   ├── client.ts               # BullMQ/Redis setup
│   │   └── workers/
│   │       ├── message.worker.ts
│   │       ├── research.worker.ts
│   │       ├── video.worker.ts
│   │       └── crm.worker.ts
│   │
│   ├── history/                    # Conversation Context
│   │   ├── message-store.ts        # Message persistence
│   │   └── context-builder.ts      # Context window management
│   │
│   ├── observability/              # Monitoring
│   │   ├── logger.ts               # Pino structured logging
│   │   ├── metrics.ts              # Prometheus metrics
│   │   └── health.ts               # Health checks
│   │
│   ├── resilience/                 # Fault Tolerance
│   │   ├── circuit-breaker.ts      # Circuit breaker pattern
│   │   ├── retry.ts                # Exponential backoff
│   │   └── rate-limiter.ts         # Rate limiting
│   │
│   ├── channels/whatsapp/          # WhatsApp Client
│   ├── handlers/                   # Message Routing
│   ├── contacts/                   # Contact Management
│   ├── integrations/               # External APIs
│   ├── webhooks/                   # Callback Handlers
│   ├── cli/                        # CLI Interface
│   ├── config/                     # Configuration
│   └── server.ts                   # HTTP Server
│
├── migrations/
│   ├── 000_base_contacts.sql       # Contact table
│   └── 001_swarm_tables.sql        # Swarm tables
│
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
# Database
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Swarm
SWARM_ENABLED=true
SWARM_ROLLOUT_PERCENTAGE=100

# Integrations
HEYGEN_API_KEY=sk_...
HUBSPOT_API_KEY=pat-...
# LINKEDIN_API_KEY=... (ProxyCurl shut down - needs alternative provider)
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
| Database | Supabase (PostgreSQL) |
| Logging | Pino |
| Metrics | prom-client |
| Resilience | Cockatiel |
| WhatsApp | @whiskeysockets/baileys |
| Video | HeyGen API |
| CRM | HubSpot API |
| Container | Docker |

## Deployment

### Docker Compose

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  nexthello:
    build: .
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - SWARM_ENABLED=true
      - REDIS_HOST=redis
    ports: ["3000:3000"]
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

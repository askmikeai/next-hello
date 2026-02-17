# NextHello Architecture

> AI-powered networking swarm that converts event connections into booked meetings.

## System Overview

**Architecture Type:** AI Orchestrator with specialized agents
**Agent Model:** Single LLM-powered orchestrator (Anthropic Claude) coordinating 6 specialized agents
**Infrastructure:** Redis (state/queues), PostgreSQL (persistence), BullMQ (job processing)

## Swarm Hierarchy (Corporate Structure)

```
                            ┌─────────────────────────────────────┐
                            │           ORCHESTRATOR              │
                            │         (CEO / AI Brain)            │
                            │                                     │
                            │  • Handles ALL conversations        │
                            │  • Makes routing decisions          │
                            │  • Coordinates all agents           │
                            │  • Triggers parallel execution      │
                            └──────────────────┬──────────────────┘
                                               │
        ┌──────────────┬──────────────┬────────┴────────┬──────────────┬──────────────┐
        │              │              │                 │              │              │
        ▼              ▼              ▼                 ▼              ▼              ▼
┌───────────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────┐ ┌───────────┐ ┌───────────┐
│   RESEARCH    │ │QUALIFICATION│ │    CRM    │ │PERSONTIC    │ │   VIDEO   │ │   VOICE   │
│    Agent      │ │   Agent    │ │   Agent   │ │   Agent     │ │   Agent   │ │   Agent   │
├───────────────┤ ├───────────┤ ├───────────┤ ├─────────────┤ ├───────────┤ ├───────────┤
│ Contact       │ │ Lead      │ │ HubSpot   │ │ Content     │ │ HeyGen    │ │ ElevenLabs│
│ enrichment    │ │ scoring   │ │ sync      │ │ generation  │ │ videos    │ │ TTS       │
│ via PDL API   │ │ (0-100)   │ │           │ │             │ │           │ │           │
└───────┬───────┘ └───────────┘ └─────┬─────┘ └─────────────┘ └─────┬─────┘ └─────┬─────┘
        │                             │                             │             │
        ▼                             ▼                             ▼             ▼
   ┌─────────┐                   ┌─────────┐                   ┌─────────┐   ┌──────────┐
   │   PDL   │                   │ HubSpot │                   │ HeyGen  │   │ElevenLabs│
   │   API   │                   │   API   │                   │   API   │   │   API    │
   └─────────┘                   └─────────┘                   └─────────┘   └──────────┘
```

### Reporting Structure

| Role | Reports To | Single Responsibility |
|------|------------|----------------------|
| **Orchestrator** | — | CEO - handles ALL conversations, coordinates agents |
| **Research Agent** | Orchestrator | Contact enrichment via People Data Labs API |
| **Qualification Agent** | Orchestrator | Lead scoring (0-100) & tier assignment (hot/warm/cold) |
| **CRM Agent** | Orchestrator | HubSpot synchronization |
| **Personalization Agent** | Orchestrator | Content generation (scripts, messages, emails) |
| **Video Agent** | Orchestrator | HeyGen video generation |
| **Voice Agent** | Orchestrator | ElevenLabs text-to-speech |

### Agent Dependencies

```
Independent (Fire-and-Forget):
  Orchestrator ──► Research
  Orchestrator ──► CRM
  Orchestrator ──► Video
  Orchestrator ──► Voice
  Orchestrator ──► Personalization

Pipeline (Wait-All with Dependencies):
  Orchestrator ──► Research ──► Qualification ──► CRM
```

All 6 agents report directly to the Orchestrator. The only dependency is that **Qualification waits for Research** to complete before scoring the lead.

## Orchestrator (The AI Brain)

The orchestrator is the central AI that:
- **Uses Claude directly** to analyze messages and decide responses
- **Generates responses** - handles all conversations itself
- **Triggers agents** via tools (video generation, research, CRM sync, voice)
- **Manages state** in Redis for conversation continuity
- **Runs parallel tasks** for non-blocking background operations

### Tools Available to Orchestrator

| Tool | Purpose | Triggers |
|------|---------|----------|
| `contact_lookup` | Look up contact by phone | Database query |
| `contact_update` | Save email, company, job title, LinkedIn | Database update |
| `get_calendly_link` | Get scheduling link to share | Config lookup |
| `send_video` | Send existing video to contact | Outbound queue |
| `generate_video` | Create personalized HeyGen video | Video Agent |
| `research_contact` | Background PDL/company research | Research Agent |
| `delete_contact` | GDPR data deletion | Database delete |
| `trigger_parallel_tasks` | Run multiple agents in parallel | ParallelTaskRunner |
| `set_voice_mode` | Enable/disable voice responses | Redis state |
| `send_voice_response` | Send TTS voice message | Voice Agent |

### System Prompt

The orchestrator receives a system prompt that includes:
- Event context (event name, owner name)
- Contact information (if known)
- Missing required fields
- Voice mode status
- Available actions and guidelines

```typescript
// Simplified orchestrator flow
async processMessage(phoneNumber, message) {
  const state = await loadOrCreateState(phoneNumber);
  const voiceModeEnabled = await checkVoiceMode(phoneNumber);
  const systemPrompt = buildSystemPrompt(context, state, voiceModeEnabled);

  const response = await llm.runWithTools({
    systemPrompt,
    messages: [{ role: "user", content: message }],
    tools: this.getTools(),
  }, async (toolCall) => {
    return await this.toolExecutor.executeTool(toolCall, context);
  });

  await saveState(state);
  return response.content;
}
```

## Parallel Agent Execution

The swarm supports parallel execution of independent operations, enabling research, CRM sync, and media generation to run concurrently without blocking conversations.

### Execution Strategies

| Strategy | Use Case | Behavior |
|----------|----------|----------|
| `fire-and-forget` | Video/voice generation, CRM sync | Queue all tasks, return immediately |
| `wait-all` | Research → Qualification pipeline | Execute in waves based on dependencies |
| `first-wins` | Redundant lookups | Return first successful result |

### Agent Parallel Configuration

| Agent | Can Run Parallel With | Depends On | Background | Priority | Timeout |
|-------|----------------------|------------|------------|----------|---------|
| orchestrator | - | - | No | 100 | 30s |
| research | crm, qualification, video, voice | - | Yes | 50 | 60s |
| crm | research, video, voice, qualification | - | Yes | 30 | 30s |
| qualification | crm, video, voice | research | No | 40 | 15s |
| personalization | video, voice | research, qualification | No | 35 | 20s |
| video | voice, crm, research | - | Yes | 20 | 5min |
| voice | video, crm, research | - | Yes | 25 | 60s |

### ParallelTaskBuilder API

```typescript
// Fire-and-forget background tasks
await orchestrator.triggerBackgroundTasks(phoneNumber, context, {
  research: true,
  crm: true,
  video: { firstName: "John" },
  voice: { text: "Hello John!" },
});

// Research pipeline with dependencies
const result = await orchestrator.runResearchPipeline(phoneNumber, context, {
  linkedinUrl: "https://linkedin.com/in/johndoe",
});
// result.mergedResult contains data from all agents
```

### Claude Triggering Parallel Tasks

```json
{
  "name": "trigger_parallel_tasks",
  "input": {
    "phoneNumber": "+14155551234",
    "tasks": ["research", "crm_sync", "video"],
    "firstName": "John"
  }
}
```

## Specialized Agents

### Research Agent
- **Responsibility:** Contact enrichment via People Data Labs API
- **Tools:** `pdl_enrich`, `update_research_status`
- **Next Agent:** Qualification (after research completes)

### Qualification Agent
- **Responsibility:** Lead scoring (0-100) and tier assignment
- **Tiers:** Hot (75-100), Warm (50-74), Cold (25-49), Unqualified (0-24)
- **Tools:** `set_qualification`, `get_engagement_data`
- **Depends On:** Research Agent

### CRM Agent
- **Responsibility:** HubSpot CRM synchronization
- **Tools:** `crm_sync`, `check_sync_status`, `generate_deal_name`

### Personalization Agent
- **Responsibility:** Content generation (scripts, messages, emails)
- **Tools:** `generate_welcome_message`, `generate_email`, `generate_video_script`

### Video Agent
- **Responsibility:** HeyGen video generation
- **Tools:** `generate_heygen_video`, `check_video_status`, `get_contact_video`

### Voice Agent
- **Responsibility:** ElevenLabs text-to-speech generation
- **Tools:** `generate_voice_message`, `list_available_voices`, `send_voice_message`

## Voice Mode

The system automatically matches the user's communication preference:

```
User sends VOICE message ──► Auto-enable voice mode ──► Respond with VOICE
User sends TEXT message  ──► Check voice mode state ──► Respond with TEXT (default)
User asks for "text"/"write to me" ──► Disable voice mode ──► Respond with TEXT
```

### Voice Mode Behavior
| User Input | System Response |
|------------|-----------------|
| Voice message | Auto-enable voice mode, respond with voice |
| Text message (voice mode on) | Respond with voice |
| Text message (voice mode off) | Respond with text |
| "Write to me" / "text please" | Disable voice mode, respond with text |

### Redis State
- Key: `voice_mode:{phoneNumber}`
- Value: `"true"` or `"false"`
- TTL: 24 hours

## Background Workers

Workers process jobs asynchronously, triggered by orchestrator tools:

| Worker | Queue | Purpose | Integration |
|--------|-------|---------|-------------|
| **MessageWorker** | `incoming-messages` | Process incoming messages | Orchestrator |
| **VideoWorker** | `video-generation` | Generate personalized videos | HeyGen API |
| **ResearchWorker** | `research-jobs` | PDL/company research | PDL API |
| **CRMWorker** | `crm-sync` | Sync contacts to CRM | HubSpot API |
| **VoiceWorker** | `voice-generation` | Generate voice messages | ElevenLabs API |
| **AgentTaskWorker** | `agent-tasks` | Execute parallel agent tasks | All Agents |

## Data Flow

### Incoming Message Flow

```
WhatsApp Message
       │
       ▼
┌──────────────────┐
│  Message Queue   │
│(incoming-messages)│
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│           SwarmOrchestrator              │
│                                          │
│  1. Load state from Redis                │
│  2. Check voice mode                     │
│  3. Build system prompt with context     │
│  4. Call Claude with tools               │
│  5. Execute any tool calls               │
│  6. Trigger parallel tasks if needed     │
│  7. Return response to user              │
│  8. Update state in Redis                │
└────────┬─────────────────────────────────┘
         │
         ├──────────────────────────────────┐
         │                                  │
         ▼                                  ▼
┌──────────────────┐              ┌──────────────────┐
│ Send Response    │              │ Parallel Tasks   │
│ (text or voice)  │              │ (research, video,│
└──────────────────┘              │  CRM, voice)     │
                                  └──────────────────┘
```

## Infrastructure

### Job Queues (BullMQ + Redis)

| Queue | Purpose | Concurrency |
|-------|---------|-------------|
| `incoming-messages` | WhatsApp messages | 5 |
| `outbound-messages` | Send messages/videos | 5 |
| `video-generation` | HeyGen video jobs | 2 |
| `research-jobs` | PDL research | 3 |
| `voice-generation` | ElevenLabs TTS | 2 |
| `crm-sync` | HubSpot sync | 3 |
| `agent-tasks` | Parallel agent tasks | 5 |

### Redis State

Swarm state stored per phone number:

```typescript
interface SwarmState {
  correlationId: string;
  phoneNumber: string;
  channel: "whatsapp" | "telegram";
  currentAgent: "orchestrator";
  conversationTurns: number;
  lastActivityAt: Date;
  taskQueue: AgentTask[];
  completedTasks: AgentTask[];
}
```

Key format: `swarm:state:{phoneNumber}`
Voice mode: `voice_mode:{phoneNumber}`
TTL: 24 hours

### Observability

**Structured Logging (Pino):**
- Correlation IDs for end-to-end tracing
- Agent activity logging
- Tool execution logging
- LLM interaction logging

**Metrics (Prometheus):**
- `nexthello_agent_executions_total` - Orchestrator/agent calls
- `nexthello_llm_calls_total` - Claude API calls
- `nexthello_tokens_used_total` - Token consumption
- `nexthello_jobs_processed_total` - Worker job counts
- `nexthello_parallel_tasks_total` - Parallel task execution
- `nexthello_parallel_task_duration_seconds` - Task duration

**Admin Dashboard (`/admin`):**
- Overview tab: Contacts, queues, health
- Swarm tab: Agent topology, active conversations, performance metrics

## Directory Structure

```
nexthello/
├── src/
│   ├── swarm/                      # AI Swarm System
│   │   ├── orchestrator.ts         # THE AI BRAIN - uses Claude
│   │   ├── base-agent.ts           # Base class for agents
│   │   ├── types.ts                # Type definitions
│   │   ├── index.ts                # Swarm exports
│   │   ├── agents/                 # Specialized agents (6 total)
│   │   │   ├── research.agent.ts   # PDL enrichment
│   │   │   ├── qualification.agent.ts # Lead scoring
│   │   │   ├── crm.agent.ts        # HubSpot sync
│   │   │   ├── personalization.agent.ts # Content generation
│   │   │   ├── video.agent.ts      # HeyGen videos
│   │   │   └── voice.agent.ts      # ElevenLabs TTS
│   │   ├── parallel/               # Parallel Execution System
│   │   │   ├── types.ts            # Parallel execution types
│   │   │   ├── task-runner.ts      # Core execution engine
│   │   │   ├── task-builder.ts     # Fluent API builder
│   │   │   ├── metrics.ts          # Prometheus metrics
│   │   │   └── index.ts            # Barrel export
│   │   └── llm/
│   │       ├── client.ts           # Anthropic SDK wrapper
│   │       └── tool-executor.ts    # Tool registration & execution
│   │
│   ├── queue/
│   │   ├── client.ts               # BullMQ/Redis setup
│   │   └── workers/
│   │       ├── message.worker.ts   # Incoming message processing
│   │       ├── video.worker.ts     # HeyGen video generation
│   │       ├── agent-task.worker.ts # Parallel agent tasks
│   │       ├── research.worker.ts  # PDL research
│   │       └── crm.worker.ts       # CRM sync
│   │
│   ├── admin/                      # Admin Dashboard
│   │   ├── routes.ts               # API endpoints
│   │   ├── api.ts                  # API functions
│   │   └── frontend/               # React frontend
│   │
│   ├── contacts/                   # Contact Management
│   ├── database/                   # PostgreSQL client
│   ├── channels/whatsapp/          # WhatsApp Client (Baileys)
│   ├── integrations/               # External APIs (HeyGen, PDL, etc.)
│   ├── observability/              # Logging, metrics, health
│   └── server.ts                   # HTTP Server + Worker startup
│
├── migrations/liquibase/           # Database Migrations
├── docker-compose.yml              # Container orchestration
└── ARCHITECTURE.md                 # This file
```

## Configuration

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
HEYGEN_MOCK_MODE=true  # Use mock mode for testing

# Voice Generation
ELEVENLABS_API_KEY=...

# Contact Enrichment
PDL_API_KEY=...

# CRM
HUBSPOT_API_KEY=pat-...
```

## Key Design Decisions

1. **Single Orchestrator**: One AI brain (Claude) handles all conversations
2. **6 Specialized Agents**: Each agent has ONE responsibility
3. **Corporate Hierarchy**: All agents report directly to Orchestrator
4. **Parallel Execution**: Non-blocking background tasks via ParallelTaskRunner
5. **Tool-based Actions**: Orchestrator uses tools to trigger agents
6. **Async Workers**: Heavy operations run in BullMQ queues
7. **Redis State**: Conversation context persisted per phone number
8. **Auto Voice Mode**: User sends voice → respond with voice; user asks for text → respond with text
9. **Admin Dashboard**: Real-time visibility into swarm activity

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Health check |
| `/metrics` | Prometheus metrics |
| `/admin` | Admin dashboard |
| `/admin/api/swarm/states` | Active conversations |
| `/admin/api/swarm/agents` | Agent performance |
| `/admin/api/swarm/activities` | Recent agent activities |

# NextHello Architecture

This document describes the architecture that exists in this repository today.

## System Overview

NextHello is a multi-service networking assistant built around:

- A Python `FastAPI` backend (`crewai/src/api.py`)
- A Redis Streams-based autonomous swarm (`crewai/src/swarm/*`)
- A Node.js Baileys WhatsApp connector (`crewai/whatsapp-bridge/*`)
- PostgreSQL persistence managed by Liquibase (`migrations/liquibase/*`)
- A legacy ARQ/CrewAI pipeline that still exists for non-swarm flows (`crewai/src/queue/*`, `crewai/src/orchestrator/*`)

At runtime (Docker), the primary path is:

1. `whatsapp` connector receives inbound WhatsApp events
2. connector POSTs to `api` at `/whatsapp/message`
3. `SwarmCoordinator` emits events to Redis streams
4. swarm agents consume/produce events autonomously
5. `MessagingAgent` sends outbound messages back through `api` -> connector

## Runtime Topology

```text
WhatsApp (user)
   |
   v
Baileys Connector (Node, :3000)
   |  POST /whatsapp/message
   v
FastAPI (Python, :8001)
   |                    \
   |                     \  admin + diagnostics APIs
   v                      \
SwarmCoordinator           Admin UI/API clients
   |
   v
Redis Streams Event Bus <------> Swarm Agents (research, qualification,
   |                               personalization, messaging, video, voice, crm)
   v
Blackboard (Redis cache + Postgres persistence)

Supporting services:
- PostgreSQL (contact + event + message persistence)
- Redis (streams, locks, cache, ARQ queues, legacy state)
- Liquibase (schema migrations)
- worker (legacy ARQ jobs)
- loki + vector agent-log-monitor (log aggregation)
```

## Repository Structure (Architecture-Relevant)

```text
.
├── docker-compose.yml
├── migrations/liquibase/
│   ├── changelog.xml
│   └── sql/*.sql
├── nexthello                         # root CLI wrapper for Docker workflows
└── crewai/
    ├── cli.py                        # local/dev CLI and test helpers
    ├── config/
    │   ├── agents.yaml               # CrewAI agent definitions (legacy + utility)
    │   └── tasks.yaml                # CrewAI task templates
    ├── src/
    │   ├── api.py                    # FastAPI app + admin APIs + connector ingress
    │   ├── swarm/
    │   │   ├── coordinator.py        # inbound router (not centralized orchestrator)
    │   │   ├── eventbus.py           # Redis Streams pub/sub + consumer groups
    │   │   ├── blackboard.py         # shared contact state + locks + DB persistence
    │   │   ├── agent_runner.py       # autonomous agent base class + lifecycle
    │   │   ├── events.py             # event taxonomy + stream mapping
    │   │   ├── runner.py             # standalone swarm service entrypoint
    │   │   └── agents/
    │   ├── queue/                    # ARQ queue + worker (legacy/aux path)
    │   ├── orchestrator/             # ConversationOrchestrator (legacy path)
    │   ├── crews/                    # CrewAI workflows
    │   ├── agents/                   # CrewAI agent factory
    │   ├── tools/                    # external integration tools
    │   ├── channels/whatsapp.py      # WhatsApp Cloud API client/webhook parser
    │   └── state/redis_state.py      # legacy Redis conversation state
    └── whatsapp-bridge/
        ├── index.js                  # Baileys connector + HTTP API
        └── pg-store.js               # session backup/restore in PostgreSQL
```

## Core Architectural Patterns

### 1) Event-Driven Swarm (Primary)

- The coordinator does lightweight routing only: parse inbound message, update contact state, emit events.
- Agents are autonomous and subscribe by event type via Redis consumer groups.
- Agents decide whether to act (`should_act`) using current contact state.
- Cross-agent coordination happens via emitted events, not direct calls.

Event model lives in `crewai/src/swarm/events.py` with streams:

- `swarm:events:contact`
- `swarm:events:message`
- `swarm:events:research`
- `swarm:events:qualification`
- `swarm:events:video`
- `swarm:events:voice`
- `swarm:events:crm`

### 2) Blackboard Shared State

`crewai/src/swarm/blackboard.py` implements shared state for all swarm agents:

- Redis cache for fast reads (`swarm:contact:*`)
- Postgres as source of persistence (`networking_contacts` and related tables)
- Per-contact distributed locking (`swarm:lock:*`)
- Agent activity and swarm event logging

### 3) Multi-Path Message Processing

There are two processing paths currently in code:

- **Swarm path (active in Docker WhatsApp flow):** `/whatsapp/message` -> `SwarmCoordinator` -> events -> swarm agents
- **Legacy ARQ path:** webhook endpoints enqueue `process_incoming_message` -> `ConversationOrchestrator`

Both paths share some primitives (Redis and CrewAI utilities) but are architecturally distinct.

## Swarm Agents and Responsibilities

Defined under `crewai/src/swarm/agents/`:

- `ResearchAgent`
  - Triggers on contact creation/updates and explicit research requests
  - Uses OpenClaw (if configured) and/or People Data Labs
  - Emits `research.completed` and `qualification.needed`

- `QualificationAgent`
  - Scores lead quality (`hot`/`warm`/`cold`/`unqualified`)
  - Emits `qualification.completed`
  - For strong leads, emits `video.requested` and `crm.sync_needed`

- `PersonalizationAgent`
  - Generates text responses and video scripts
  - Emits `message.send`, `video.script_ready`, and optional `voice.requested`

- `MessagingAgent`
  - Delivers outbound text/audio messages
  - Calls FastAPI admin send endpoints to route through Baileys connector
  - Emits `message.sent`

- `VideoAgent`
  - Starts HeyGen jobs for qualified contacts with scripts
  - Emits `video.started` and (on webhook callback path) `video.completed`

- `VoiceAgent`
  - Generates ElevenLabs audio
  - Emits `voice.completed` and `message.send` (audio)

- `CRMAgent`
  - Syncs contacts and optional deals/notes to HubSpot
  - Emits `crm.synced`

## API Layer

`crewai/src/api.py` contains:

- Service health/config endpoints (`/`, `/health`, `/config`)
- WhatsApp Cloud API webhook endpoints (`/webhook/whatsapp`)
- Baileys connector ingress endpoint (`POST /whatsapp/message`)
- Admin endpoints for contacts, messages, activities, swarm state snapshots/SSE, media, and connector status
- Manual outbound transport endpoints (`/admin/api/whatsapp/send`, `/admin/api/whatsapp/send-voice`)

The API is also the integration point between Python services and Node Baileys connector (`WHATSAPP_CONNECTOR_URL`).

## Data Model

Managed by Liquibase (`migrations/liquibase/changelog.xml`), including:

- `networking_contacts` - canonical contact profile + swarm status fields
- `message_history` - inbound/outbound channel history with media metadata
- `agent_activity_log` - per-agent execution lifecycle data
- `swarm_event_log` - event audit trail
- `swarm_agent_state` - per-agent per-contact state
- `media_files` - media tracking and retention metadata
- `pdl_person_enrichment` / `pdl_company_enrichment` - enrichment snapshots
- `luma_*` tables - event/guest association model
- `whatsapp_sessions` - Baileys auth backup store

## WhatsApp Connector Architecture

`crewai/whatsapp-bridge/index.js`:

- Uses Baileys multi-file auth in local `auth_state/session`
- Optionally backs up/restores auth state to Postgres via `pg-store.js`
- Exposes local HTTP endpoints (`/health`, `/qr`, `/send`, `/send-voice`, `/session/*`)
- Forwards inbound messages to Python API and can post immediate text replies from API responses
- Converts outbound audio to WhatsApp-compatible Opus/Ogg voice notes via `ffmpeg`

## Infrastructure and Deployment Model

`docker-compose.yml` defines service boundaries:

- `postgres`, `redis`, `liquibase`
- `api` (FastAPI)
- `worker` (ARQ)
- `swarm` (autonomous agent runtime)
- `whatsapp` + `whatsapp-connect` (Baileys runtime + QR tool)
- `loki` + `agent-log-monitor` (log pipeline)

The top-level `nexthello` shell script is the operational entrypoint for start/stop/logs/migrate/model switching/test helpers.

## Known Architectural Reality (Important)

- The repo contains both a newer event-driven swarm and an older ARQ/orchestrator path.
- Docker production-style flows primarily use the swarm + Baileys connector route.
- Some legacy endpoints and worker jobs remain and are still callable.
- Redis is used for multiple concerns: streams, cache, locks, ARQ queueing, and legacy state.

This dual-path state is intentional in current code and should be treated as the baseline architecture until consolidated.

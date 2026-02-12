# NextHello Architecture

> AI-powered networking automation platform that converts event connections into booked meetings.

## System Overview

**Architecture Type:** Multi-process, event-driven
**Agent Model:** Rule-based (pattern matching, not LLM agent)
**Processes:** 2 Docker containers

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXTHELLO SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐      ┌─────────────────────────────┐   │
│  │  nexthello-whatsapp │      │      nexthello (HTTP)       │   │
│  │    (Process 1)      │      │       (Process 2)           │   │
│  ├─────────────────────┤      ├─────────────────────────────┤   │
│  │ • WhatsApp Client   │      │ • Webhook Server (:3000)    │   │
│  │ • Message Handlers  │      │ • Health Checks             │   │
│  │ • HeyGen Trigger    │      │ • HeyGen Callbacks          │   │
│  │ • Response Sender   │      │ • Calendly Callbacks        │   │
│  └──────────┬──────────┘      └──────────────┬──────────────┘   │
│             │                                 │                  │
│             └────────────┬───────────────────┘                  │
│                          │                                       │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │      Supabase         │                          │
│              │   (Shared Database)   │                          │
│              └───────────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why Not an LLM Agent?

NextHello uses **rule-based message handling** instead of an LLM agent because:

1. **Speed** - Pattern matching is instant, no API latency
2. **Cost** - No per-message LLM costs
3. **Predictability** - Deterministic responses
4. **Simplicity** - Easier to debug and maintain

The "AI" in NextHello is:
- **HeyGen** - AI-generated personalized videos
- **Pattern Matching** - Regex extraction for emails, companies, etc.

## Process Architecture

### Process 1: WhatsApp Client (`nexthello-whatsapp`)

```
┌─────────────────────────────────────────────────────┐
│              WhatsApp Client Process                 │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Baileys WebSocket ──→ Message Event                │
│                              │                       │
│                              ▼                       │
│                    ┌─────────────────┐              │
│                    │  Route Message  │              │
│                    └────────┬────────┘              │
│                             │                        │
│              ┌──────────────┴──────────────┐        │
│              ▼                              ▼        │
│     ┌────────────────┐           ┌──────────────┐   │
│     │ First Contact  │           │  Follow-Up   │   │
│     │    Handler     │           │   Handler    │   │
│     └───────┬────────┘           └──────┬───────┘   │
│             │                           │            │
│             ▼                           ▼            │
│     • Create Contact            • Extract Fields    │
│     • Trigger HeyGen            • Update Contact    │
│     • Send Welcome              • Check Complete    │
│     • Send Video (async)        • Send Response     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Process 2: HTTP Server (`nexthello`)

```
┌─────────────────────────────────────────────────────┐
│                HTTP Server Process                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Port 3000                                          │
│                                                      │
│  Routes:                                            │
│  ├── GET  /health          → 200 OK                 │
│  ├── GET  /                 → System info           │
│  ├── POST /webhooks/heygen  → Video completion      │
│  └── POST /webhooks/calendly→ Meeting booked        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### New Contact Message Flow

```
Phone sends WhatsApp message
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              WhatsApp Client Process                 │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. Baileys receives message                        │
│  2. Extract: phone, name, text                      │
│  3. Check: is first contact?                        │
│  4. YES → First Contact Handler:                    │
│     a. Create contact in Supabase                   │
│     b. Call HeyGen API (async)                      │
│     c. Send welcome message                         │
│     d. Wait for HeyGen (poll or webhook)            │
│     e. Send video when ready                        │
│                                                      │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│                   Supabase                           │
├─────────────────────────────────────────────────────┤
│  Contact created:                                    │
│  • phone_number: "17544220907"                      │
│  • first_name: "Michael"                            │
│  • status: "active"                                 │
│  • sent_personalized_message: true                  │
└─────────────────────────────────────────────────────┘
```

### Follow-Up Message Flow

```
Contact replies with email
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              WhatsApp Client Process                 │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. Baileys receives message                        │
│  2. Lookup contact by phone                         │
│  3. Follow-Up Handler:                              │
│     a. Extract fields via regex:                    │
│        • Email: /[a-z0-9@.]+@[a-z]+\.[a-z]+/       │
│        • Company: "I work at X"                     │
│        • Title: "I'm a Y"                           │
│     b. Update contact in Supabase                   │
│     c. Check if all required fields collected       │
│     d. Send appropriate response                    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```
nexthello/
├── src/
│   ├── channels/whatsapp/      # WhatsApp client (Baileys)
│   │   ├── client.ts           # WebSocket connection, message handling
│   │   └── connect.ts          # CLI connect command
│   │
│   ├── handlers/               # Message routing logic
│   │   ├── first-contact.ts    # New contact workflow
│   │   └── follow-up.ts        # Conversation continuation
│   │
│   ├── contacts/               # Data layer
│   │   ├── supabase-repo.ts    # Database CRUD
│   │   ├── state-machine.ts    # Contact workflow states
│   │   └── field-validator.ts  # Email/company validation
│   │
│   ├── integrations/           # External APIs
│   │   ├── heygen/             # Video generation
│   │   ├── calendly/           # Scheduling
│   │   ├── linkedin/           # Profile enrichment
│   │   └── crm/                # HubSpot sync
│   │
│   ├── webhooks/               # Callback handlers
│   │   ├── heygen.ts           # Video ready notifications
│   │   └── calendly.ts         # Meeting booked notifications
│   │
│   ├── cli/                    # Command-line interface
│   │   └── commands/           # setup, connect, start
│   │
│   ├── config/                 # Configuration & types
│   │   ├── types.ts            # TypeScript interfaces
│   │   └── schema.ts           # Zod validation
│   │
│   └── server.ts               # HTTP server entry point
│
├── nexthello.config.json       # Runtime config
├── docker-compose.yml          # Container orchestration
├── Dockerfile                  # Build instructions
└── .env                        # Environment variables
```

## Configuration

### Environment Variables (`.env`)

```bash
# Database
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...

# Integrations
HEYGEN_API_KEY=sk_...
OPENAI_API_KEY=sk-...

# App
NEXTHELLO_OWNER_NAME=Michael Friedberg
NEXTHELLO_EVENT_NAME=Conference 2024
```

### Runtime Config (`nexthello.config.json`)

```json
{
  "enabled": true,
  "eventName": "Conference 2024",
  "ownerName": "Michael Friedberg",
  "requiredFields": ["email", "company_name", "job_title"],
  
  "heygen": {
    "avatarId": "a47b8b54...",
    "voiceId": "7d0a0fae...",
    "scriptTemplate": "Hey {name}! Great meeting you..."
  },
  
  "calendly": {
    "schedulingLink": "https://calendly.com/..."
  }
}
```

## Contact State Machine

```
┌─────────┐
│   new   │  Contact created, no message sent
└────┬────┘
     │ [welcome_sent]
     ▼
┌─────────┐
│welcomed │  Welcome message sent, waiting for reply
└────┬────┘
     │ [needs_fields]
     ▼
┌──────────┐
│collecting│  Gathering email, company, title
└────┬─────┘
     │ [all_fields]
     ▼
┌───────────────┐
│fields_complete│  All required info collected
└───────┬───────┘
        │ [crm_sync]
        ▼
   ┌────────┐
   │ synced │  Pushed to HubSpot
   └────┬───┘
        │ [meeting_booked]
        ▼
┌─────────────────┐
│meeting_scheduled│  Calendly booking confirmed
└────────┬────────┘
         │
         ▼
    ┌──────────┐
    │ complete │  Workflow finished
    └──────────┘
```

## External Integrations

| Service | Purpose | Trigger |
|---------|---------|---------|
| **Supabase** | Contact database | Every message |
| **HeyGen** | AI video generation | First contact |
| **Calendly** | Meeting scheduling | Link in welcome |
| **HubSpot** | CRM sync | Fields complete |
| **ProxyCurl** | LinkedIn data | After email collected |

## Deployment

### Docker Compose

```yaml
services:
  nexthello:
    image: nexthello:local
    ports: ["3000:3000"]
    command: ["node", "dist/src/server.js"]

  whatsapp:
    image: nexthello:local
    command: ["nexthello", "connect", "whatsapp"]
    volumes:
      - nexthello-auth:/app/data/auth
```

### Commands

```bash
# Start everything
docker compose --profile whatsapp up -d

# View WhatsApp logs
docker compose logs -f whatsapp

# Rebuild after code changes
docker compose --profile whatsapp up -d --build
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 |
| Language | TypeScript |
| WhatsApp | @whiskeysockets/baileys |
| Database | Supabase (PostgreSQL) |
| Validation | Zod |
| CLI | Commander.js |
| Video | HeyGen API |
| Container | Docker |

## Key Design Decisions

1. **Rule-based vs LLM Agent**: Pattern matching for speed and cost
2. **Multi-process**: Separate WhatsApp client from HTTP server for stability
3. **Async video generation**: Don't block welcome message on video creation
4. **Typing simulation**: 5-10 second delay to feel human
5. **Phone as primary key**: WhatsApp identity is phone number

# NextHello CrewAI

Multi-agent networking assistant powered by CrewAI and WhatsApp Cloud API.

## Features

- **Multi-LLM Support**: Switch between Anthropic Claude, OpenAI GPT-4, Google Gemini, and local Ollama models
- **CrewAI Agents**: Specialized agents for research, qualification, personalization, video, voice, and CRM
- **WhatsApp Integration**: Full WhatsApp Cloud API support for messaging
- **Redis State**: Conversation state and message history in Redis
- **Job Queue**: Background task processing with ARQ
- **External Integrations**: People Data Labs, HeyGen, ElevenLabs, HubSpot

## Quick Start

```bash
# Install dependencies
pip install -e .

# Copy environment file and configure
cp .env.example .env

# Start the API server
uvicorn src.api:app --host 0.0.0.0 --port 8001 --reload

# Start the background worker (in another terminal)
arq src.queue.worker.WorkerSettings
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WhatsApp Cloud API                        │
│                          │                                   │
│                          ▼                                   │
│                   ┌─────────────┐                           │
│                   │   FastAPI   │                           │
│                   │   Webhooks  │                           │
│                   └──────┬──────┘                           │
│                          │                                   │
│                          ▼                                   │
│                   ┌─────────────┐                           │
│                   │ Conversation│                           │
│                   │ Orchestrator│                           │
│                   └──────┬──────┘                           │
│                          │                                   │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Research │    │ Qualify  │    │  Video   │             │
│   │  Agent   │    │  Agent   │    │  Agent   │             │
│   └──────────┘    └──────────┘    └──────────┘             │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │  Voice   │    │   CRM    │    │ Personal │             │
│   │  Agent   │    │  Agent   │    │  Agent   │             │
│   └──────────┘    └──────────┘    └──────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

### WhatsApp
- `GET /webhook/whatsapp` - Webhook verification
- `POST /webhook/whatsapp` - Incoming messages
- `POST /send` - Send message (queued)
- `POST /send/immediate` - Send message (direct)

### Agents
- `POST /research` - Research a contact
- `POST /qualify` - Qualify a lead
- `POST /personalize/welcome` - Generate welcome message
- `POST /personalize/video-script` - Generate video script
- `POST /video/generate` - Generate HeyGen video
- `POST /voice/generate` - Generate ElevenLabs voice
- `POST /crm/sync` - Sync to HubSpot

### State
- `GET /state/{phone_number}` - Get conversation state
- `GET /state/{phone_number}/history` - Get message history
- `GET /conversations` - List active conversations

## Configuration

Set these environment variables (see `.env.example`):

```bash
# LLM Provider
LLM_PROVIDER=anthropic/claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...

# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...

# Redis
REDIS_URL=redis://localhost:6379

# External Services (optional)
PDL_API_KEY=...
HEYGEN_API_KEY=...
ELEVENLABS_API_KEY=...
HUBSPOT_API_KEY=...
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Lint
ruff check .
```

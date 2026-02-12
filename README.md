# NextHello

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/askmikeai/nexthello/main/docs/assets/nexthello-logo-text-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/askmikeai/nexthello/main/docs/assets/nexthello-logo-text.svg">
    <img src="https://raw.githubusercontent.com/askmikeai/nexthello/main/docs/assets/nexthello-logo-text.svg" alt="NextHello" width="450">
  </picture>
</p>

<p align="center">
  <strong>You met them. Now close them.</strong>
</p>

<p align="center">
  <a href="https://github.com/askmikeai/nexthello/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/askmikeai/nexthello/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://github.com/askmikeai/nexthello/releases"><img src="https://img.shields.io/github/v/release/askmikeai/nexthello?style=for-the-badge" alt="Release"></a>
  <a href="https://discord.gg/nexthello"><img src="https://img.shields.io/discord/000000000000000000?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#integrations">Integrations</a> ·
  <a href="#api">API</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="https://discord.gg/nexthello">Discord</a>
</p>

---

**NextHello** is an AI-powered networking assistant that turns event connections into booked meetings.

You meet 50 people at a conference. You collect their numbers. Then... nothing. Following up manually is tedious, and 80% of connections go cold within 48 hours.

NextHello fixes this. When someone texts you, they instantly get a personalized AI video, a scheduling link, and a natural conversation that collects their info — all while you're still at the event.

**The result:** More meetings booked. Zero manual follow-up. Your CRM stays updated automatically.

---

## Why NextHello?

| Before | After |
|--------|-------|
| Collect 50 contacts at an event | Same |
| Manually send 50 follow-up texts | **Automated instantly** |
| Copy-paste info into your CRM | **Auto-synced** |
| Forget to follow up, connections go cold | **AI keeps conversations warm** |
| 5% book a meeting | **40%+ book a meeting** |

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   "Hey, it was great meeting you at the conference!"                        │
│                                              — New contact texts you        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
        ┌─────────────────────────────────────────────────────────┐
        │                    NextHello Engine                      │
        │                                                          │
        │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
        │   │    Save      │  │   Generate   │  │   Research   │  │
        │   │   Contact    │  │  AI Video    │  │   LinkedIn   │  │
        │   │  to Supabase │  │   (HeyGen)   │  │  (ProxyCurl) │  │
        │   └──────────────┘  └──────────────┘  └──────────────┘  │
        │                                                          │
        └─────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   "Hi! Great meeting you too! Here's a quick video from me:                 │
│    [AI Video] — Let's find time to chat: calendly.com/you"                  │
│                                              — NextHello responds           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
        ┌─────────────────────────────────────────────────────────┐
        │                   AI Conversation                        │
        │                                                          │
        │   NextHello: "What's your email? I'll send over          │
        │               some resources we discussed."              │
        │                                                          │
        │   Contact:    "Sure! john@acme.com"                      │
        │                                                          │
        │   NextHello: "Perfect! And you're at Acme Corp           │
        │               as Head of Product, right?"                │
        │                                                          │
        │   Contact:    "Yep, that's me!"                          │
        │                                                          │
        │   ✓ Email captured    ✓ Company confirmed                │
        │   ✓ Title verified    ✓ Synced to HubSpot                │
        │                                                          │
        └─────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   📅  MEETING BOOKED                                                        │
│   John Smith · Head of Product @ Acme Corp                                  │
│   Tuesday 2:00 PM · "Discuss partnership opportunities"                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/askmikeai/nexthello
cd nexthello

# Install
npm install

# Configure
cp .env.example .env
# Add your API keys

# Database
npm run db:migrate

# Run
npm start
```

**That's it.** Connect your WhatsApp and start networking.

---

## Configuration

Create `nexthello.config.json`:

```json
{
  "eventName": "AI Summit 2024",
  "ownerName": "Your Name",
  "requiredFields": ["email", "company_name", "job_title"],

  "heygen": {
    "avatarId": "your-avatar-id",
    "voiceId": "your-voice-id"
  },

  "calendly": {
    "schedulingLink": "https://calendly.com/your-link"
  },

  "crm": {
    "provider": "hubspot"
  }
}
```

### Environment Variables

```bash
# Database (required)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your-service-role-key

# Integrations (optional but recommended)
HEYGEN_API_KEY=           # AI avatar videos
CALENDLY_API_KEY=         # Meeting scheduling
PROXYCURL_API_KEY=        # LinkedIn enrichment
HUBSPOT_API_KEY=          # CRM sync
SENDGRID_API_KEY=         # Email sending
```

---

## Contact Lifecycle

```
┌─────────┐     ┌───────────┐     ┌─────────────┐     ┌─────────────────┐
│   NEW   │────▶│  WELCOMED │────▶│ COLLECTING  │────▶│ FIELDS_COMPLETE │
└─────────┘     └───────────┘     └─────────────┘     └────────┬────────┘
                                         │                      │
                                         ▼                      ▼
                               ┌───────────────────┐    ┌──────────────┐
                               │ MEETING_SCHEDULED │───▶│    SYNCED    │
                               └───────────────────┘    └──────┬───────┘
                                                               │
                                                               ▼
                                                       ┌──────────────┐
                                                       │   COMPLETE   │
                                                       └──────────────┘
```

| State | What Happens |
|-------|--------------|
| `new` | Contact saved, video generation triggered |
| `welcomed` | Personalized video + Calendly link sent |
| `collecting` | AI chatbot gathering email, company, title |
| `fields_complete` | All required fields collected |
| `meeting_scheduled` | Calendly meeting booked |
| `synced` | Contact pushed to CRM |
| `complete` | Workflow finished |

---

## Integrations

<table>
<tr>
<td align="center" width="150">
<img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"><br>
<strong>Database</strong><br>
<sub>Contact storage</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/HeyGen-FF6B6B?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==&logoColor=white" alt="HeyGen"><br>
<strong>AI Videos</strong><br>
<sub>Personalized avatars</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/Calendly-006BFF?style=for-the-badge&logo=calendly&logoColor=white" alt="Calendly"><br>
<strong>Scheduling</strong><br>
<sub>Book meetings</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/HubSpot-FF7A59?style=for-the-badge&logo=hubspot&logoColor=white" alt="HubSpot"><br>
<strong>CRM</strong><br>
<sub>Auto-sync contacts</sub>
</td>
</tr>
<tr>
<td align="center" width="150">
<img src="https://img.shields.io/badge/ProxyCurl-4A90E2?style=for-the-badge&logo=linkedin&logoColor=white" alt="ProxyCurl"><br>
<strong>LinkedIn</strong><br>
<sub>Profile enrichment</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/SendGrid-1A82E2?style=for-the-badge&logo=sendgrid&logoColor=white" alt="SendGrid"><br>
<strong>Email</strong><br>
<sub>Notifications</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp"><br>
<strong>Messaging</strong><br>
<sub>Primary channel</sub>
</td>
<td align="center" width="150">
<img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI"><br>
<strong>AI</strong><br>
<sub>Conversation engine</sub>
</td>
</tr>
</table>

---

## Architecture

```
nexthello/
├── src/
│   ├── config/           # Configuration & validation
│   │   ├── schema.ts     # Zod schemas
│   │   └── types.ts      # TypeScript types
│   │
│   ├── contacts/         # Contact domain
│   │   ├── repository.ts # Database operations
│   │   └── state.ts      # State machine
│   │
│   ├── integrations/     # External services
│   │   ├── heygen/       # AI video generation
│   │   ├── calendly/     # Scheduling webhooks
│   │   ├── linkedin/     # Profile research
│   │   ├── email/        # SendGrid/Resend
│   │   └── crm/          # HubSpot/Salesforce
│   │
│   ├── agent/            # AI conversation
│   │   ├── tools.ts      # Agent tools
│   │   └── prompts.ts    # System prompts
│   │
│   ├── handlers/         # Message handlers
│   │   ├── first-contact.ts
│   │   └── follow-up.ts
│   │
│   └── webhooks/         # Webhook endpoints
│       ├── calendly.ts
│       └── heygen.ts
│
├── nexthello.config.json
└── package.json
```

---

## API

```typescript
import {
  handleFirstContact,
  handleFollowUp,
  findContactByPhone
} from 'nexthello';

// Incoming message handler
async function onMessage(phoneNumber: string, text: string, pushName: string) {
  const contact = await findContactByPhone(phoneNumber);

  if (!contact?.sent_personalized_message) {
    // First contact: send video + Calendly
    await handleFirstContact({
      phoneNumber,
      pushName,
      channel: "whatsapp",
      config,
      sendMessage: async (msg) => whatsapp.send(phoneNumber, msg),
    });
  } else {
    // Follow-up: AI conversation
    await handleFollowUp({
      phoneNumber,
      messageText: text,
      config,
      sendMessage: async (msg) => whatsapp.send(phoneNumber, msg),
    });
  }
}
```

---

## Webhooks

| Endpoint | Event | Action |
|----------|-------|--------|
| `POST /webhooks/heygen` | Video ready | Send video to contact |
| `POST /webhooks/calendly` | Meeting booked | Update contact status |
| `POST /webhooks/calendly` | Meeting canceled | Re-engage contact |

---

## Database Schema

```sql
CREATE TABLE contacts (
  id                    BIGSERIAL PRIMARY KEY,
  phone_number          TEXT UNIQUE NOT NULL,

  -- Profile
  email                 TEXT,
  first_name            TEXT,
  last_name             TEXT,
  company_name          TEXT,
  job_title             TEXT,
  linkedin_url          TEXT,

  -- Context
  event_name            TEXT,
  status                TEXT DEFAULT 'new',

  -- Integration IDs
  heygen_video_id       TEXT,
  heygen_video_url      TEXT,
  calendly_event_id     TEXT,
  calendly_scheduled_at TIMESTAMPTZ,
  crm_contact_id        TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_contacts_status ON contacts(status);
CREATE INDEX idx_contacts_event ON contacts(event_name);
CREATE INDEX idx_contacts_created ON contacts(created_at DESC);
```

---

## Roadmap

### Now
- [x] WhatsApp channel (Baileys)
- [x] HeyGen video generation
- [x] Calendly integration
- [x] AI data collection
- [x] HubSpot sync

### Next
- [ ] Telegram channel
- [ ] iMessage channel
- [ ] Salesforce integration
- [ ] Web dashboard
- [ ] Multi-language support

### Later
- [ ] LinkedIn DM channel
- [ ] Email channel
- [ ] Analytics & reporting
- [ ] Team/multi-user support
- [ ] Custom AI prompts

---

## Star History

<a href="https://star-history.com/#askmikeai/nexthello&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=askmikeai/nexthello&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=askmikeai/nexthello&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=askmikeai/nexthello&type=Date" />
 </picture>
</a>

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development
git clone https://github.com/askmikeai/nexthello
cd nexthello
npm install
npm run dev

# Run tests
npm test

# Build
npm run build
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Stop losing connections. Start closing deals.</strong>
</p>

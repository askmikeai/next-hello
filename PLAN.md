# NextHello Refactor Plan: Personal AI Networking Assistant

> Transform NextHello from an event follow-up tool into a full-featured personal AI assistant for professional networking.

## Vision

A personal AI agent that helps you build, maintain, and leverage your professional network across all messaging channels. Think of it as a networking co-pilot that:

- Remembers everyone you've met
- Follows up at the right time
- Researches contacts before meetings
- Suggests introductions
- Keeps your CRM in sync
- Works across WhatsApp, Telegram, iMessage, LinkedIn, and more

---

## Phase 1: Core Architecture Refactor

### 1.1 Adopt OpenClaw's Modular Structure

**Current:**
```
nexthello/
├── src/
│   ├── config/
│   ├── contacts/
│   ├── integrations/
│   ├── agent/
│   ├── handlers/
│   └── webhooks/
```

**Target:**
```
nexthello/
├── src/
│   ├── index.ts                  # CLI entry point
│   ├── entry.ts                  # Process initialization
│   │
│   ├── config/                   # Type-safe configuration (Zod)
│   │   ├── schema.ts             # Zod schema definitions
│   │   ├── types.ts              # TypeScript types
│   │   ├── io.ts                 # Config loading/saving
│   │   └── defaults.ts           # Default values
│   │
│   ├── gateway/                  # WebSocket control plane
│   │   ├── server.ts             # WS server
│   │   ├── protocol/             # Message protocol
│   │   └── rpc.ts                # RPC handlers
│   │
│   ├── channels/                 # Channel adapters (OpenClaw pattern)
│   │   ├── registry.ts           # Channel registry
│   │   ├── dock.ts               # Abstract dock interface
│   │   ├── whatsapp/             # WhatsApp (Baileys)
│   │   ├── telegram/             # Telegram (grammY)
│   │   ├── imessage/             # iMessage (applescript/shortcuts)
│   │   ├── linkedin/             # LinkedIn DMs
│   │   └── email/                # Email channel
│   │
│   ├── agent/                    # AI agent runtime
│   │   ├── runtime.ts            # Agent execution
│   │   ├── tools/                # Agent tools
│   │   │   ├── contacts.ts       # Contact management
│   │   │   ├── research.ts       # LinkedIn/web research
│   │   │   ├── calendar.ts       # Scheduling
│   │   │   ├── crm.ts            # CRM operations
│   │   │   ├── memory.ts         # Memory search
│   │   │   └── introductions.ts  # Suggest intros
│   │   ├── prompts/              # System prompts
│   │   └── skills/               # Reusable skills
│   │
│   ├── contacts/                 # Contact domain
│   │   ├── repository.ts         # Database operations
│   │   ├── state-machine.ts      # Contact lifecycle
│   │   ├── enrichment.ts         # Data enrichment
│   │   └── scoring.ts            # Relationship scoring
│   │
│   ├── memory/                   # Vector memory (OpenClaw pattern)
│   │   ├── index.ts              # Memory search
│   │   ├── embeddings.ts         # Embedding providers
│   │   ├── chunking.ts           # Text chunking
│   │   └── store.ts              # SQLite + vectors
│   │
│   ├── routing/                  # Message routing
│   │   ├── resolve-route.ts      # Route resolution
│   │   └── session-key.ts        # Session management
│   │
│   ├── integrations/             # External services
│   │   ├── heygen/
│   │   ├── calendly/
│   │   ├── proxycurl/
│   │   ├── hubspot/
│   │   ├── salesforce/
│   │   └── clay/
│   │
│   ├── cli/                      # CLI commands
│   │   ├── program.ts            # Commander setup
│   │   ├── commands/
│   │   │   ├── start.ts
│   │   │   ├── contacts.ts
│   │   │   ├── channels.ts
│   │   │   ├── agent.ts
│   │   │   └── doctor.ts
│   │   └── ui/                   # CLI UI components
│   │
│   ├── daemon/                   # Background service
│   │   ├── manager.ts
│   │   └── scheduled-jobs.ts
│   │
│   └── web/                      # Web dashboard (optional)
│       ├── server.ts
│       └── routes/
│
├── extensions/                   # Plugin system
├── docs/
└── package.json
```

### 1.2 Type-Safe Configuration System

Adopt OpenClaw's Zod-based config pattern:

```typescript
// src/config/schema.ts
import { z } from 'zod';

export const NextHelloConfigSchema = z.object({
  // Identity
  owner: z.object({
    name: z.string(),
    email: z.string().email(),
    timezone: z.string().default('America/New_York'),
  }),

  // Agent configuration
  agent: z.object({
    model: z.enum(['gpt-4o', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514']).default('gpt-4o'),
    personality: z.string().optional(),
    tools: z.array(z.string()).default(['contacts', 'research', 'calendar', 'crm']),
  }),

  // Channel configs
  channels: z.object({
    whatsapp: WhatsAppConfigSchema.optional(),
    telegram: TelegramConfigSchema.optional(),
    imessage: iMessageConfigSchema.optional(),
    linkedin: LinkedInConfigSchema.optional(),
    email: EmailConfigSchema.optional(),
  }),

  // Session management
  session: z.object({
    scope: z.enum(['per-contact', 'global']).default('per-contact'),
    resetAfterDays: z.number().default(30),
  }),

  // Memory configuration
  memory: z.object({
    provider: z.enum(['openai', 'voyage', 'local']).default('openai'),
    indexPaths: z.array(z.string()).default([]),
  }),

  // Integrations
  integrations: z.object({
    supabase: SupabaseConfigSchema,
    heygen: HeyGenConfigSchema.optional(),
    calendly: CalendlyConfigSchema.optional(),
    crm: CRMConfigSchema.optional(),
    research: ResearchConfigSchema.optional(),
  }),

  // Automation rules
  automations: z.object({
    autoWelcome: z.boolean().default(true),
    autoResearch: z.boolean().default(true),
    followUpReminders: z.boolean().default(true),
    birthdayReminders: z.boolean().default(false),
  }),
});
```

### 1.3 Channel Dock Interface

Implement OpenClaw's dock pattern for channel abstraction:

```typescript
// src/channels/dock.ts
export interface ChannelDock {
  id: string;
  name: string;

  // Capabilities
  capabilities: {
    streaming: boolean;
    media: ('image' | 'video' | 'audio' | 'document')[];
    reactions: boolean;
    threads: boolean;
    typing: boolean;
  };

  // Lifecycle
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Messaging
  sendMessage(to: string, message: OutboundMessage): Promise<MessageResult>;
  onMessage(handler: InboundMessageHandler): void;

  // Identity
  getMyId(): string;
  resolveContact(identifier: string): Promise<ResolvedContact | null>;
}
```

---

## Phase 2: Networking-Specific Features

### 2.1 Enhanced Contact Model

```typescript
interface NetworkContact {
  // Identity
  id: string;
  phone?: string;
  email?: string;
  linkedInUrl?: string;

  // Profile
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  jobTitle: string;
  location?: string;
  avatar?: string;

  // Relationship
  relationshipScore: number;        // 0-100
  connectionType: ConnectionType;   // 'met_at_event' | 'intro' | 'inbound' | 'outbound'
  firstContactDate: Date;
  lastContactDate: Date;
  contactFrequency: number;         // Messages per month

  // Context
  meetingContext?: string;          // "Met at AI Summit 2024"
  notes: string[];
  tags: string[];
  interests: string[];

  // Network graph
  introducedBy?: string;            // Contact ID
  introducedTo: string[];           // Contact IDs

  // Integrations
  channels: {
    [channelId: string]: {
      identifier: string;
      lastActive: Date;
      preferred: boolean;
    };
  };
  crmIds: {
    hubspot?: string;
    salesforce?: string;
    clay?: string;
  };

  // Workflow
  status: ContactStatus;
  nextAction?: ScheduledAction;
}

type ContactStatus =
  | 'new'
  | 'welcomed'
  | 'collecting_info'
  | 'active'
  | 'needs_followup'
  | 'meeting_scheduled'
  | 'dormant'
  | 'churned';
```

### 2.2 Relationship Intelligence

```typescript
// src/contacts/scoring.ts
export function calculateRelationshipScore(contact: NetworkContact): number {
  const factors = {
    recency: scoreRecency(contact.lastContactDate),           // 0-25
    frequency: scoreFrequency(contact.contactFrequency),      // 0-25
    depth: scoreConversationDepth(contact),                   // 0-25
    network: scoreNetworkValue(contact),                      // 0-25
  };
  return Object.values(factors).reduce((a, b) => a + b, 0);
}

// src/contacts/actions.ts
export function suggestNextAction(contact: NetworkContact): SuggestedAction {
  if (contact.status === 'new') {
    return { type: 'welcome', priority: 'high' };
  }
  if (daysSinceContact(contact) > 30 && contact.relationshipScore > 50) {
    return { type: 'followup', priority: 'medium', reason: 'Re-engage valuable contact' };
  }
  // ... more rules
}
```

### 2.3 AI Agent Tools for Networking

```typescript
// src/agent/tools/contacts.ts
export const contactTools = {
  findContact: {
    description: 'Search for a contact by name, company, or other attributes',
    parameters: z.object({
      query: z.string(),
      filters: z.object({
        company: z.string().optional(),
        tag: z.string().optional(),
        status: z.string().optional(),
      }).optional(),
    }),
    execute: async (params) => { /* ... */ },
  },

  updateContact: {
    description: 'Update contact information',
    parameters: z.object({
      contactId: z.string(),
      updates: z.record(z.unknown()),
    }),
    execute: async (params) => { /* ... */ },
  },

  logInteraction: {
    description: 'Log an interaction with a contact',
    parameters: z.object({
      contactId: z.string(),
      type: z.enum(['call', 'meeting', 'message', 'email']),
      notes: z.string().optional(),
    }),
    execute: async (params) => { /* ... */ },
  },

  suggestIntroduction: {
    description: 'Suggest contacts who should be introduced to each other',
    parameters: z.object({
      contactId: z.string().optional(),
      context: z.string().optional(),
    }),
    execute: async (params) => { /* ... */ },
  },
};

// src/agent/tools/research.ts
export const researchTools = {
  researchPerson: {
    description: 'Research a person using LinkedIn and web search',
    parameters: z.object({
      name: z.string(),
      company: z.string().optional(),
      linkedInUrl: z.string().optional(),
    }),
    execute: async (params) => { /* ... */ },
  },

  prepareForMeeting: {
    description: 'Generate a briefing document for an upcoming meeting',
    parameters: z.object({
      contactId: z.string(),
      meetingContext: z.string().optional(),
    }),
    execute: async (params) => { /* ... */ },
  },
};

// src/agent/tools/introductions.ts
export const introductionTools = {
  draftIntroEmail: {
    description: 'Draft a double opt-in introduction email',
    parameters: z.object({
      person1Id: z.string(),
      person2Id: z.string(),
      context: z.string(),
    }),
    execute: async (params) => { /* ... */ },
  },
};
```

### 2.4 Memory System for Networking Context

```typescript
// src/memory/networking.ts
export interface NetworkingMemory {
  // Index all conversations with contacts
  indexConversation(contactId: string, messages: Message[]): Promise<void>;

  // Index meeting notes
  indexMeetingNotes(contactId: string, notes: string): Promise<void>;

  // Search across all networking context
  search(query: string, options?: {
    contactId?: string;
    timeRange?: { start: Date; end: Date };
    type?: 'conversation' | 'notes' | 'all';
  }): Promise<MemorySearchResult[]>;

  // Get context for a contact
  getContactContext(contactId: string): Promise<string>;
}
```

---

## Phase 3: Multi-Channel Support

### 3.1 WhatsApp Channel (Priority 1)

Keep existing Baileys integration, refactor to dock pattern:

```typescript
// src/channels/whatsapp/dock.ts
export class WhatsAppDock implements ChannelDock {
  id = 'whatsapp';
  name = 'WhatsApp';

  capabilities = {
    streaming: false,
    media: ['image', 'video', 'audio', 'document'],
    reactions: true,
    threads: false,
    typing: true,
  };

  private sock: WASocket | null = null;

  async connect(config: WhatsAppConfig): Promise<void> {
    // Baileys connection logic
  }

  async sendMessage(to: string, message: OutboundMessage): Promise<MessageResult> {
    // Send via Baileys
  }

  onMessage(handler: InboundMessageHandler): void {
    // Listen for messages
  }
}
```

### 3.2 Telegram Channel (Priority 2)

```typescript
// src/channels/telegram/dock.ts
export class TelegramDock implements ChannelDock {
  id = 'telegram';
  name = 'Telegram';

  capabilities = {
    streaming: true,  // Can edit messages for streaming effect
    media: ['image', 'video', 'audio', 'document'],
    reactions: true,
    threads: true,
    typing: true,
  };

  private bot: Bot | null = null;

  async connect(config: TelegramConfig): Promise<void> {
    this.bot = new Bot(config.botToken);
    // grammY setup
  }
}
```

### 3.3 iMessage Channel (Priority 3)

```typescript
// src/channels/imessage/dock.ts
export class iMessageDock implements ChannelDock {
  id = 'imessage';
  name = 'iMessage';

  capabilities = {
    streaming: false,
    media: ['image', 'video'],
    reactions: true,
    threads: false,
    typing: false,
  };

  // Use AppleScript or Shortcuts for sending
  // Use chat.db for reading (with proper permissions)
}
```

### 3.4 LinkedIn Channel (Priority 4)

```typescript
// src/channels/linkedin/dock.ts
export class LinkedInDock implements ChannelDock {
  id = 'linkedin';
  name = 'LinkedIn';

  capabilities = {
    streaming: false,
    media: ['image', 'document'],
    reactions: true,
    threads: false,
    typing: false,
  };

  // Use unofficial API or browser automation
  // Rate-limited and careful to avoid bans
}
```

### 3.5 Email Channel (Priority 5)

```typescript
// src/channels/email/dock.ts
export class EmailDock implements ChannelDock {
  id = 'email';
  name = 'Email';

  capabilities = {
    streaming: false,
    media: ['image', 'document'],
    reactions: false,
    threads: true,
    typing: false,
  };

  // IMAP for reading, SMTP/SendGrid for sending
}
```

---

## Phase 4: CLI & User Interface

### 4.1 CLI Commands

```bash
# Core commands
nexthello start                    # Start the gateway
nexthello stop                     # Stop the gateway
nexthello status                   # Show status
nexthello doctor                   # Diagnose issues

# Contact management
nexthello contacts list            # List all contacts
nexthello contacts search "John"   # Search contacts
nexthello contacts show <id>       # Show contact details
nexthello contacts add             # Add a contact
nexthello contacts import <file>   # Import from CSV/JSON
nexthello contacts export          # Export contacts

# Channel management
nexthello channels list            # List channels
nexthello channels connect whatsapp  # Connect WhatsApp
nexthello channels disconnect telegram

# Agent interaction
nexthello agent chat               # Chat with your agent
nexthello agent "research John Smith at Acme Corp"

# Automation
nexthello followup list            # Pending follow-ups
nexthello followup send <id>       # Send follow-up
nexthello intros suggest           # Get intro suggestions

# Configuration
nexthello config show
nexthello config set agent.model claude-sonnet-4-20250514
```

### 4.2 Web Dashboard (Future)

Simple web UI for:
- Contact management
- Conversation history
- Analytics (network growth, response rates)
- Configuration

---

## Phase 5: Scheduled Automations

### 5.1 Cron Jobs

```typescript
// src/daemon/scheduled-jobs.ts
export const scheduledJobs = [
  {
    id: 'daily-followup-check',
    cron: '0 9 * * *',  // 9 AM daily
    handler: async () => {
      const needsFollowup = await getContactsNeedingFollowup();
      for (const contact of needsFollowup) {
        await sendFollowupReminder(contact);
      }
    },
  },

  {
    id: 'weekly-network-digest',
    cron: '0 8 * * 1',  // Monday 8 AM
    handler: async () => {
      const digest = await generateNetworkDigest();
      await sendDigestToOwner(digest);
    },
  },

  {
    id: 'contact-enrichment',
    cron: '0 2 * * *',  // 2 AM daily
    handler: async () => {
      const stale = await getContactsNeedingEnrichment();
      for (const contact of stale) {
        await enrichContact(contact);
      }
    },
  },
];
```

### 5.2 Event-Driven Automations

```typescript
// Triggers
type AutomationTrigger =
  | { type: 'new_contact' }
  | { type: 'contact_status_change'; from: Status; to: Status }
  | { type: 'meeting_scheduled'; contactId: string }
  | { type: 'days_since_contact'; days: number }
  | { type: 'incoming_message'; channel: string };

// Actions
type AutomationAction =
  | { type: 'send_message'; template: string }
  | { type: 'generate_video' }
  | { type: 'research_contact' }
  | { type: 'sync_to_crm' }
  | { type: 'notify_owner'; message: string }
  | { type: 'schedule_followup'; days: number };
```

---

## Implementation Roadmap

### Sprint 1: Foundation (Week 1-2)
- [ ] Set up new project structure
- [ ] Implement Zod config system
- [ ] Create channel dock interface
- [ ] Migrate WhatsApp to dock pattern
- [ ] Basic CLI framework

### Sprint 2: Contact Domain (Week 3-4)
- [ ] Enhanced contact model
- [ ] Contact repository with Supabase
- [ ] Relationship scoring
- [ ] Contact state machine

### Sprint 3: Agent Runtime (Week 5-6)
- [ ] Agent runtime setup
- [ ] Contact management tools
- [ ] Research tools (ProxyCurl)
- [ ] Calendar tools (Calendly)

### Sprint 4: Memory System (Week 7-8)
- [ ] Vector memory implementation
- [ ] Conversation indexing
- [ ] Memory search tools
- [ ] Contact context generation

### Sprint 5: Additional Channels (Week 9-10)
- [ ] Telegram channel
- [ ] Email channel
- [ ] Channel routing logic

### Sprint 6: Automations (Week 11-12)
- [ ] Scheduled jobs daemon
- [ ] Event-driven automations
- [ ] Follow-up system
- [ ] Network digest

### Sprint 7: Polish (Week 13-14)
- [ ] CLI completion
- [ ] Doctor/diagnostics
- [ ] Documentation
- [ ] Testing

---

## Key Differences from OpenClaw

| Aspect | OpenClaw | NextHello |
|--------|----------|-----------|
| **Focus** | Multi-channel AI gateway | Personal networking assistant |
| **Users** | Developers/businesses | Individual professionals |
| **Agent** | General-purpose | Networking-specialized |
| **Memory** | Document-based | Relationship-based |
| **Channels** | All messaging | Networking-relevant |
| **Automations** | Generic hooks | Networking workflows |

## Technology Stack

- **Runtime**: Node.js >= 22
- **Language**: TypeScript 5.x
- **Package Manager**: pnpm
- **Validation**: Zod
- **CLI**: Commander.js
- **Database**: Supabase (PostgreSQL)
- **Vector Store**: pgvector or SQLite + sqlite-vec
- **AI**: OpenAI / Anthropic APIs
- **Build**: tsup or tsdown

---

## Success Metrics

1. **Contact Coverage**: % of contacts with complete profiles
2. **Follow-up Rate**: % of contacts followed up within target window
3. **Response Time**: Average time to respond to inbound messages
4. **Relationship Score Growth**: Average score improvement over time
5. **Meeting Conversion**: % of contacts who book meetings
6. **CRM Sync**: % of contacts synced to CRM

---

## Open Questions

1. Should we support multiple "workspaces" (e.g., personal vs. work networking)?
2. How to handle shared contacts between channels (deduplication)?
3. Privacy: How much conversation data to store vs. summarize?
4. iMessage: Is AppleScript reliable enough, or need native app?
5. LinkedIn: Risk tolerance for unofficial API usage?

---

*This plan transforms NextHello from a single-purpose event follow-up tool into a comprehensive personal AI networking assistant, adopting OpenClaw's proven architectural patterns while focusing on relationship-building features.*
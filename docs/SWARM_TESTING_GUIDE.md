# Swarm Architecture Testing Guide

Best practices for testing the NextHello multi-agent swarm architecture.

## Testing Layers

### 1. Unit Tests (Individual Agents)

Test each agent in isolation before testing coordination. This ensures each agent handles inputs/outputs correctly.

```typescript
// Example: Test research agent in isolation
describe("ResearchAgent Unit Tests", () => {
  it("should call pdl_enrich tool with correct params", async () => {
    const agent = new ResearchAgent();
    const mockContext = createMockContext();

    const result = await agent.process(mockContext, "Research this contact");

    expect(result.toolsCalled).toContain("pdl_enrich");
  });
});
```

**Test each agent for:**
- Tool invocation correctness
- Response format compliance
- Error handling
- State transitions

### 2. Integration Tests (Agent Coordination)

Test agent handoffs and orchestration.

```typescript
describe("Agent Handoff Tests", () => {
  it("should hand off from conversation to research agent", async () => {
    const orchestrator = new SwarmOrchestrator(config);

    // Conversation agent should hand off when research needed
    const result = await orchestrator.processMessage(
      phoneNumber,
      "Can you look up my LinkedIn profile?",
      "whatsapp",
      contact
    );

    expect(result.nextAgent).toBe("research");
  });
});
```

### 3. End-to-End Tests (Full Conversation Flows)

Test complete multi-turn conversations.

```typescript
describe("Multi-Turn Conversation E2E", () => {
  it("should complete full networking flow", async () => {
    const messages = [
      "Hi, I'm Sarah from TechCorp",
      "My email is sarah@techcorp.com",
      "I'd like to schedule a call",
    ];

    for (const msg of messages) {
      const result = await orchestrator.processMessage(...);
      expect(result.success).toBe(true);
    }

    // Verify final state
    const contact = await findContactByPhone(phoneNumber);
    expect(contact.email).toBe("sarah@techcorp.com");
    expect(contact.status).toBe("meeting_scheduled");
  });
});
```

## Testing Best Practices

### 1. Test Failure Modes

Ensure the controller doesn't get stuck in retry loops or deadlocks:

```typescript
describe("Failure Handling", () => {
  it("should not loop infinitely on API errors", async () => {
    mockApiToFail();

    const result = await orchestrator.processMessage(...);

    expect(result.retryCount).toBeLessThan(5);
    expect(result.fallbackUsed).toBe(true);
  });

  it("should handle slow responses gracefully", async () => {
    mockSlowResponse(10000); // 10 second delay

    const result = await orchestrator.processMessage(...);

    expect(result.timedOut || result.success).toBe(true);
  });
});
```

### 2. Test Coordination Loops

Multi-agent systems can have runaway coordination. Set limits:

```typescript
describe("Coordination Limits", () => {
  it("should limit agent handoffs per conversation", async () => {
    const result = await orchestrator.processMessage(...);

    expect(result.agentHandoffCount).toBeLessThan(10);
  });

  it("should respect token budget", async () => {
    const result = await orchestrator.processMessage(...);

    expect(result.tokensUsed.total).toBeLessThan(MAX_TOKENS);
  });
});
```

### 3. Hallucination Tests

Verify agents don't invent information:

```typescript
describe("Hallucination Prevention", () => {
  it("should not fabricate contact details", async () => {
    const result = await orchestrator.processMessage(
      phoneNumber,
      "What's my email?",
      "whatsapp",
      { ...contact, email: undefined }
    );

    // Should not invent an email
    expect(result.response).not.toMatch(/\S+@\S+\.\S+/);
    expect(result.response).toMatch(/don't have|not sure|could you/i);
  });
});
```

### 4. Built-in Verification Patterns

Use critic/validator agents:

```typescript
// Validator agent checks constraints
describe("Response Validation", () => {
  it("should not include PII in logs", async () => {
    const result = await orchestrator.processMessage(...);

    // Check logs don't contain full phone/email
    expect(result.logs).not.toMatch(contact.email);
  });
});
```

### 5. Performance Testing

```typescript
describe("Performance", () => {
  it("should respond within 10 seconds average", async () => {
    const times = [];

    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await orchestrator.processMessage(...);
      times.push(Date.now() - start);
    }

    const avg = times.reduce((a, b) => a + b) / times.length;
    expect(avg).toBeLessThan(10000);
  });
});
```

## Test Organization

```
src/tests/
├── unit/
│   ├── pdl-client.test.ts       # PDL API client
│   ├── pdl-queue.test.ts        # Queue functions
│   ├── pdl-worker.test.ts       # Worker logic
│   ├── conversation-agent.test.ts
│   ├── research-agent.test.ts
│   └── qualification-agent.test.ts
├── integration/
│   ├── pdl-queue.test.ts        # Redis + PDL integration
│   ├── swarm-integration.test.ts # Full orchestrator
│   ├── multi-agent-e2e.test.ts  # E2E flows
│   └── agent-handoff.test.ts    # Agent transitions
└── quality/
    ├── hallucination.test.ts    # Anti-hallucination
    ├── tone.test.ts             # Professional tone
    └── response-quality.test.ts # Actionability
```

## Running Tests

```bash
# Unit tests only (fast, no external deps)
npm run test:unit

# Integration tests (requires Redis, DB)
npm run test:integration

# Full E2E with real APIs
npm run test:e2e

# With coverage
npm run test:coverage
```

## Coverage Goals

| Component | Target |
|-----------|--------|
| PDL Client | 80%+ |
| PDL Queue | 80%+ |
| PDL Worker | 75%+ |
| Orchestrator | 70%+ |
| Individual Agents | 75%+ |

## Mocking Strategy

### Unit Tests
- Mock all external APIs (PDL, Anthropic, etc.)
- Mock Redis/database
- Test pure logic only

### Integration Tests
- Real Redis, real database
- Mock external APIs or use test accounts
- Test coordination and state

### E2E Tests
- Real everything (with test API keys)
- Test actual behavior
- Rate limit aware (use queues)

## References

- [Benchmarking Multi-Agent Architectures](https://blog.langchain.com/benchmarking-multi-agent-architectures/)
- [Multi-Agent System Architecture Guide](https://www.clickittech.com/ai/multi-agent-system-architecture/)
- [OpenAI Swarm Framework Guide](https://galileo.ai/blog/openai-swarm-framework-multi-agents)
- [Choosing Multi Agent Architecture](https://docs.swarms.world/en/latest/swarms/concept/how_to_choose_swarms/)

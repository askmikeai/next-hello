/**
 * Agent Hallucination Detection Tests
 *
 * Tests for detecting AI hallucinations in agent-to-agent communication.
 *
 * Hallucination Detection Strategies:
 * 1. Ground Truth Comparison - Compare agent outputs against known inputs
 * 2. Fact Preservation - Verify agents don't add facts not in original data
 * 3. Schema Validation - Ensure outputs match expected structure
 * 4. Consistency Checking - Detect contradictions between agents
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  AgentContext,
  AgentResult,
  LLMResponse,
  ToolCall,
  AgentType,
} from "../../swarm/types.js";
import type { NetworkingContact, NetworkingEventConfig } from "../../config/types.js";
import type { Logger } from "pino";

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock all external dependencies
vi.mock("../../observability/logger.js", () => ({
  createAgentLogger: vi.fn(() => mockLogger),
  logAgentActivity: vi.fn(),
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock("../../observability/activity-store.js", () => ({
  getActivityStore: vi.fn(() => ({
    startActivity: vi.fn().mockResolvedValue("activity-123"),
    completeActivity: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../observability/metrics.js", () => ({
  recordAgentExecution: vi.fn(),
  activeAgents: {
    inc: vi.fn(),
    dec: vi.fn(),
  },
  recordLLMCall: vi.fn(),
}));

vi.mock("../../contacts/index.js", () => ({
  updateContactByPhone: vi.fn().mockResolvedValue(undefined),
  findContactByPhone: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../agent/tools/linkedin-research.js", () => ({
  linkedinResearch: vi.fn().mockResolvedValue({
    success: true,
    profile: { name: "Test User", title: "Engineer" },
  }),
}));

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  child: vi.fn(() => mockLogger),
} as unknown as Logger;

// ============================================================================
// HALLUCINATION DETECTION UTILITIES
// ============================================================================

/**
 * Ground truth data that agents should work with.
 * Any data not in this set appearing in agent outputs is a hallucination.
 */
interface GroundTruth {
  contact: Partial<NetworkingContact>;
  facts: Set<string>;
  allowedFields: Set<string>;
}

/**
 * Creates a ground truth object from contact data
 */
function createGroundTruth(contact: Partial<NetworkingContact>): GroundTruth {
  const facts = new Set<string>();

  // Extract all factual claims from the contact
  if (contact.first_name) facts.add(`first_name:${contact.first_name}`);
  if (contact.last_name) facts.add(`last_name:${contact.last_name}`);
  if (contact.email) facts.add(`email:${contact.email}`);
  if (contact.company_name) facts.add(`company:${contact.company_name}`);
  if (contact.job_title) facts.add(`job_title:${contact.job_title}`);
  if (contact.linkedin_url) facts.add(`linkedin:${contact.linkedin_url}`);
  if (contact.phone_number) facts.add(`phone:${contact.phone_number}`);

  return {
    contact,
    facts,
    allowedFields: new Set(Object.keys(contact)),
  };
}

/**
 * Detects potential hallucinations in an agent's response
 */
interface HallucinationReport {
  hasHallucinations: boolean;
  fabricatedFacts: string[];
  contradictions: string[];
  unexpectedFields: string[];
  confidence: number; // 0-1 confidence in detection
}

/**
 * Analyzes agent output for hallucinations against ground truth
 */
function detectHallucinations(
  response: string,
  data: Record<string, unknown> | undefined,
  groundTruth: GroundTruth
): HallucinationReport {
  const fabricatedFacts: string[] = [];
  const contradictions: string[] = [];
  const unexpectedFields: string[] = [];

  // Check for names that weren't in the input
  const namePatterns = [
    /(?:named?|called|is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /([A-Z][a-z]+)\s+(?:works|is working|employed)/g,
  ];

  for (const pattern of namePatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      const name = match[1];
      const isKnownName =
        name === groundTruth.contact.first_name ||
        name === groundTruth.contact.last_name ||
        `${groundTruth.contact.first_name} ${groundTruth.contact.last_name}` === name;

      if (!isKnownName && name.length > 2) {
        fabricatedFacts.push(`Unknown name mentioned: "${name}"`);
      }
    }
  }

  // Check for company names that weren't provided
  const companyPattern = /(?:at|works for|employed by|company)\s+([A-Z][a-zA-Z0-9\s]+?)(?:\.|,|$)/gi;
  const companyMatches = response.matchAll(companyPattern);
  for (const match of companyMatches) {
    const company = match[1].trim();
    if (
      groundTruth.contact.company_name &&
      !company.toLowerCase().includes(groundTruth.contact.company_name.toLowerCase()) &&
      !groundTruth.contact.company_name.toLowerCase().includes(company.toLowerCase())
    ) {
      fabricatedFacts.push(`Unknown company mentioned: "${company}"`);
    } else if (!groundTruth.contact.company_name && company.length > 2) {
      fabricatedFacts.push(`Company mentioned but none provided: "${company}"`);
    }
  }

  // Check for emails that weren't provided
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = response.matchAll(emailPattern);
  for (const match of emailMatches) {
    const email = match[0];
    if (groundTruth.contact.email !== email) {
      fabricatedFacts.push(`Unknown email mentioned: "${email}"`);
    }
  }

  // Check for phone numbers that weren't provided
  const phonePattern = /\+?[\d\s()-]{10,}/g;
  const phoneMatches = response.matchAll(phonePattern);
  for (const match of phoneMatches) {
    const phone = match[0].replace(/[\s()-]/g, "");
    const knownPhone = groundTruth.contact.phone_number?.replace(/[\s()-]/g, "");
    if (phone.length >= 10 && knownPhone !== phone) {
      fabricatedFacts.push(`Unknown phone number mentioned: "${phone}"`);
    }
  }

  // Check data object for unexpected fields
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (!groundTruth.allowedFields.has(key) && value !== undefined && value !== null) {
        // Check if this is a derived/computed field (allowed)
        const derivedFields = new Set([
          "qualificationScore",
          "qualificationTier",
          "researchStatus",
          "processedAt",
          "nextAgent",
          "success",
        ]);
        if (!derivedFields.has(key)) {
          unexpectedFields.push(`Unexpected field "${key}" with value: ${JSON.stringify(value)}`);
        }
      }
    }
  }

  // Check for contradictions with ground truth
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      const truthKey = key as keyof NetworkingContact;
      if (
        groundTruth.contact[truthKey] !== undefined &&
        value !== undefined &&
        groundTruth.contact[truthKey] !== value
      ) {
        contradictions.push(
          `Field "${key}" contradicts ground truth: expected "${groundTruth.contact[truthKey]}", got "${value}"`
        );
      }
    }
  }

  const hasHallucinations =
    fabricatedFacts.length > 0 || contradictions.length > 0 || unexpectedFields.length > 0;

  // Confidence is lower if we found ambiguous patterns
  const confidence = hasHallucinations ? 0.8 : 1.0;

  return {
    hasHallucinations,
    fabricatedFacts,
    contradictions,
    unexpectedFields,
    confidence,
  };
}

/**
 * Validates that data passed between agents maintains consistency
 */
function validateAgentHandoff(
  sourceResult: AgentResult,
  targetInput: Record<string, unknown>,
  groundTruth: GroundTruth
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check that no new facts were invented during handoff
  if (sourceResult.data) {
    for (const [key, value] of Object.entries(sourceResult.data)) {
      if (targetInput[key] !== undefined && targetInput[key] !== value) {
        issues.push(`Data mutation during handoff: "${key}" changed from "${value}" to "${targetInput[key]}"`);
      }
    }
  }

  // Verify ground truth is preserved
  for (const [key, value] of Object.entries(groundTruth.contact)) {
    if (targetInput[key] !== undefined && targetInput[key] !== value) {
      issues.push(`Ground truth violated: "${key}" should be "${value}", got "${targetInput[key]}"`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================================================
// MOCK LLM CLIENT
// ============================================================================

/**
 * Mock LLM Client that returns controlled responses for testing
 */
class MockLLMClient {
  private responses: Map<string, LLMResponse> = new Map();
  private callHistory: Array<{ prompt: string; response: LLMResponse }> = [];

  /**
   * Set a response for a given agent type/prompt pattern
   */
  setResponse(pattern: string, response: Partial<LLMResponse>): void {
    this.responses.set(pattern, {
      id: `mock-${Date.now()}`,
      content: response.content || "",
      stopReason: response.stopReason || "end_turn",
      toolCalls: response.toolCalls,
      usage: response.usage || { inputTokens: 100, outputTokens: 50 },
    });
  }

  /**
   * Simulated completion that returns controlled responses
   */
  async complete(systemPrompt: string): Promise<LLMResponse> {
    // Find matching response based on prompt content
    for (const [pattern, response] of this.responses.entries()) {
      if (systemPrompt.includes(pattern)) {
        this.callHistory.push({ prompt: systemPrompt, response });
        return response;
      }
    }

    // Default response if no pattern matches
    const defaultResponse: LLMResponse = {
      id: "mock-default",
      content: "I acknowledge the request.",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 20 },
    };

    this.callHistory.push({ prompt: systemPrompt, response: defaultResponse });
    return defaultResponse;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.complete(systemPrompt + "\n" + userMessage);
    return response.content;
  }

  async runWithTools(
    request: { systemPrompt: string },
    executeToolCall: (call: ToolCall) => Promise<string>
  ): Promise<LLMResponse> {
    const response = await this.complete(request.systemPrompt);

    // Execute any tool calls
    if (response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        await executeToolCall(toolCall);
      }
    }

    return response;
  }

  getCallHistory() {
    return this.callHistory;
  }

  clearHistory() {
    this.callHistory = [];
    this.responses.clear();
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createTestContext = (contact?: Partial<NetworkingContact>): AgentContext => ({
  correlationId: "test-correlation-123",
  config: {
    eventName: "Test Event",
    ownerName: "Test Owner",
    ownerPhone: "+1234567890",
    eventDate: "2025-01-01",
    greetingVideo: "https://example.com/video.mp4",
  } as NetworkingEventConfig,
  contact: contact as NetworkingContact | undefined,
  phoneNumber: contact?.phone_number || "+1987654321",
  channel: "whatsapp",
  logger: mockLogger,
  messageHistory: [],
});

const createTestContact = (): Partial<NetworkingContact> => ({
  id: "contact-123",
  phone_number: "+1987654321",
  first_name: "Alice",
  last_name: "Smith",
  email: "alice@example.com",
  company_name: "Acme Corp",
  job_title: "Software Engineer",
  linkedin_url: "https://linkedin.com/in/alicesmith",
});

// ============================================================================
// TESTS
// ============================================================================

describe("Agent Hallucination Detection", () => {
  let mockLLM: MockLLMClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLM = new MockLLMClient();
  });

  afterEach(() => {
    mockLLM.clearHistory();
  });

  describe("Ground Truth Verification", () => {
    it("should detect when agent fabricates a name not in the input", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      // Simulate agent response that makes up a name
      const fabricatedResponse =
        "I found that Bob Johnson works at the company and can help you.";

      const report = detectHallucinations(fabricatedResponse, undefined, groundTruth);

      expect(report.hasHallucinations).toBe(true);
      expect(report.fabricatedFacts.length).toBeGreaterThan(0);
      expect(report.fabricatedFacts.some((f) => f.includes("Bob"))).toBe(true);
    });

    it("should not flag legitimate contact information", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      // Response using only known information
      const legitimateResponse = `Alice Smith from Acme Corp is a Software Engineer.`;

      const report = detectHallucinations(legitimateResponse, undefined, groundTruth);

      expect(report.fabricatedFacts.filter((f) => f.includes("name"))).toHaveLength(0);
    });

    it("should detect fabricated company names", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const fabricatedResponse = "The contact works at Google and leads a team there.";

      const report = detectHallucinations(fabricatedResponse, undefined, groundTruth);

      expect(report.hasHallucinations).toBe(true);
      expect(report.fabricatedFacts.some((f) => f.includes("Google"))).toBe(true);
    });

    it("should detect fabricated email addresses", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const fabricatedResponse = "You can reach them at fake@company.com for follow-up.";

      const report = detectHallucinations(fabricatedResponse, undefined, groundTruth);

      expect(report.hasHallucinations).toBe(true);
      expect(report.fabricatedFacts.some((f) => f.includes("fake@company.com"))).toBe(true);
    });
  });

  describe("Data Consistency Through Handoffs", () => {
    it("should detect data mutations during agent handoff", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const sourceResult: AgentResult = {
        success: true,
        agentType: "research",
        data: {
          first_name: "Alice",
          company_name: "Acme Corp",
        },
      };

      // Simulate mutated data in handoff
      const targetInput = {
        first_name: "Alice",
        company_name: "Different Corp", // Changed!
      };

      const validation = validateAgentHandoff(sourceResult, targetInput, groundTruth);

      expect(validation.valid).toBe(false);
      expect(validation.issues.some((i) => i.includes("company_name"))).toBe(true);
    });

    it("should pass validation when data is preserved correctly", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const sourceResult: AgentResult = {
        success: true,
        agentType: "research",
        data: {
          first_name: "Alice",
          company_name: "Acme Corp",
        },
      };

      const targetInput = {
        first_name: "Alice",
        company_name: "Acme Corp",
      };

      const validation = validateAgentHandoff(sourceResult, targetInput, groundTruth);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe("Schema Validation", () => {
    it("should detect unexpected fields in agent output", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const agentData = {
        first_name: "Alice",
        invented_field: "This field was not in the input",
        random_data: 12345,
      };

      const report = detectHallucinations("", agentData, groundTruth);

      expect(report.unexpectedFields.length).toBeGreaterThan(0);
      expect(report.unexpectedFields.some((f) => f.includes("invented_field"))).toBe(true);
    });

    it("should allow derived/computed fields", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const agentData = {
        first_name: "Alice",
        qualificationScore: 85, // Derived field - allowed
        qualificationTier: "hot", // Derived field - allowed
        success: true, // Meta field - allowed
      };

      const report = detectHallucinations("", agentData, groundTruth);

      expect(report.unexpectedFields).toHaveLength(0);
    });
  });

  describe("Contradiction Detection", () => {
    it("should detect when agent contradicts ground truth", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const agentData = {
        first_name: "Bob", // Contradicts ground truth "Alice"
        company_name: "Acme Corp",
      };

      const report = detectHallucinations("", agentData, groundTruth);

      expect(report.contradictions.length).toBeGreaterThan(0);
      expect(report.contradictions[0]).toContain("first_name");
      expect(report.contradictions[0]).toContain("Alice");
      expect(report.contradictions[0]).toContain("Bob");
    });
  });

  describe("Mock LLM Integration", () => {
    it("should track LLM call history for auditing", async () => {
      mockLLM.setResponse("research", {
        content: "I will research the contact Alice Smith.",
        toolCalls: [
          {
            id: "call-1",
            name: "linkedin_research",
            input: { firstName: "Alice", lastName: "Smith" },
          },
        ],
      });

      await mockLLM.complete("You are a research agent");

      const history = mockLLM.getCallHistory();
      expect(history.length).toBe(1);
      expect(history[0].prompt).toContain("research");
    });

    it("should return controlled responses for deterministic testing", async () => {
      const expectedContent = "Found profile for Alice Smith at Acme Corp.";

      mockLLM.setResponse("research", {
        content: expectedContent,
      });

      const response = await mockLLM.complete("You are a research agent for networking");

      expect(response.content).toBe(expectedContent);
    });
  });

  describe("Agent Communication Flow", () => {
    it("should preserve contact data through simulated agent chain", async () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);
      const context = createTestContext(contact);

      // Simulate research agent result
      const researchResult: AgentResult = {
        success: true,
        agentType: "research",
        response: `Researched ${contact.first_name} ${contact.last_name} at ${contact.company_name}.`,
        data: {
          first_name: contact.first_name,
          last_name: contact.last_name,
          company_name: contact.company_name,
          researchStatus: "complete",
        },
        nextAgent: "qualification",
      };

      // Verify research agent didn't hallucinate
      const researchReport = detectHallucinations(
        researchResult.response || "",
        researchResult.data,
        groundTruth
      );
      expect(researchReport.hasHallucinations).toBe(false);

      // Simulate qualification agent result
      const qualificationResult: AgentResult = {
        success: true,
        agentType: "qualification",
        response: `Qualified ${contact.first_name} as a hot lead based on their role at ${contact.company_name}.`,
        data: {
          first_name: contact.first_name,
          company_name: contact.company_name,
          qualificationScore: 85,
          qualificationTier: "hot",
        },
        nextAgent: "crm",
      };

      // Verify qualification agent didn't hallucinate
      const qualificationReport = detectHallucinations(
        qualificationResult.response || "",
        qualificationResult.data,
        groundTruth
      );
      expect(qualificationReport.hasHallucinations).toBe(false);

      // Verify data consistency through the chain
      const handoffValidation = validateAgentHandoff(
        researchResult,
        qualificationResult.data || {},
        groundTruth
      );
      expect(handoffValidation.valid).toBe(true);
    });

    it("should detect hallucinations when agent invents information", async () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      // Simulate agent that hallucinates
      const hallucinatingResult: AgentResult = {
        success: true,
        agentType: "research",
        response: `Found that John Doe at TechCorp is interested. Email: john@techcorp.com`,
        data: {
          first_name: "John", // Wrong!
          last_name: "Doe", // Wrong!
          company_name: "TechCorp", // Wrong!
        },
      };

      const report = detectHallucinations(
        hallucinatingResult.response || "",
        hallucinatingResult.data,
        groundTruth
      );

      expect(report.hasHallucinations).toBe(true);
      expect(report.contradictions.length).toBeGreaterThan(0);
      expect(report.fabricatedFacts.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty contact gracefully", () => {
      const emptyContact: Partial<NetworkingContact> = {};
      const groundTruth = createGroundTruth(emptyContact);

      const response = "Processing your request.";
      const report = detectHallucinations(response, {}, groundTruth);

      expect(report.hasHallucinations).toBe(false);
    });

    it("should handle partial contact data", () => {
      const partialContact: Partial<NetworkingContact> = {
        first_name: "Alice",
        // No other fields
      };
      const groundTruth = createGroundTruth(partialContact);

      // Response mentions Alice but invents a company
      const response = "Alice works at SomeCompany.";
      const report = detectHallucinations(response, undefined, groundTruth);

      expect(report.hasHallucinations).toBe(true);
      expect(report.fabricatedFacts.some((f) => f.includes("SomeCompany"))).toBe(true);
    });

    it("should handle unicode names correctly", () => {
      const contact: Partial<NetworkingContact> = {
        first_name: "José",
        last_name: "García",
        company_name: "Café Corp",
      };
      const groundTruth = createGroundTruth(contact);

      const response = "José García from Café Corp confirmed.";
      const report = detectHallucinations(response, undefined, groundTruth);

      // Should not flag unicode names as hallucinations
      expect(report.fabricatedFacts.filter((f) => f.includes("José"))).toHaveLength(0);
    });
  });
});

describe("Hallucination Detection Utilities", () => {
  describe("createGroundTruth", () => {
    it("should extract all facts from contact", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      expect(groundTruth.facts.has(`first_name:${contact.first_name}`)).toBe(true);
      expect(groundTruth.facts.has(`email:${contact.email}`)).toBe(true);
      expect(groundTruth.facts.has(`company:${contact.company_name}`)).toBe(true);
    });

    it("should track allowed fields", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      expect(groundTruth.allowedFields.has("first_name")).toBe(true);
      expect(groundTruth.allowedFields.has("email")).toBe(true);
      expect(groundTruth.allowedFields.has("nonexistent_field")).toBe(false);
    });
  });

  describe("HallucinationReport", () => {
    it("should provide confidence score", () => {
      const contact = createTestContact();
      const groundTruth = createGroundTruth(contact);

      const cleanReport = detectHallucinations("Hello", {}, groundTruth);
      expect(cleanReport.confidence).toBe(1.0);

      const dirtyReport = detectHallucinations(
        "Bob works at FakeCorp",
        { invented: true },
        groundTruth
      );
      expect(dirtyReport.confidence).toBeLessThan(1.0);
    });
  });
});

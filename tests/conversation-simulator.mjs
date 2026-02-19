/**
 * Conversation Simulator - Tests AI for hallucinations
 *
 * Simulates a CEO meeting askmikeai at a networking event.
 * Tracks tool calls, analyzes conversation, and reports hallucinations.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

// Config
const TEST_PHONE = '15551234567'; // Simulated CEO phone
const CONVERSATION_DURATION_MS = 3 * 60 * 1000; // 3 minutes per conversation
const MESSAGE_INTERVAL_MS = 15 * 1000; // 15 seconds between messages
const TOTAL_ITERATIONS = 12;
const API_URL = 'http://localhost:3002/api/test/process';

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// CEO persona for simulation
const CEO_PERSONA = `You are Sarah Chen, CEO of TechVentures Inc, a B2B SaaS company with 200 employees.
You just met Mike at a networking event (Conference 2026) and he gave you his WhatsApp.
You're interested in potentially partnering or investing but want to learn more.

Your conversation style:
- Professional but friendly
- Ask about what Mike does, his company, potential synergies
- Eventually want to schedule a meeting
- Sometimes give short responses (just "yes", "sounds good", numbers to pick options)
- If asked for info, provide: email sarah@techventures.com, company TechVentures Inc, title CEO

IMPORTANT: Respond as Sarah would in a real WhatsApp conversation. Keep messages natural and concise.
Only output Sarah's next message - no explanations or meta-commentary.`;

// Track results
const results = {
  startTime: new Date().toISOString(),
  iterations: [],
  totalHallucinations: 0,
  toolCallCounts: {},
  promptAdjustments: []
};

/**
 * Send a message to the orchestrator via HTTP
 */
async function sendToOrchestrator(message) {
  // Clean message - remove special characters that might break JSON
  const cleanMessage = message.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumber: TEST_PHONE,
      message: cleanMessage,
      channel: 'whatsapp'
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Orchestrator error: ${response.status} - ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
  }
}

/**
 * Generate CEO's next message using Claude
 */
async function generateCEOMessage(conversationHistory) {
  const messages = [
    {
      role: 'user',
      content: `Here is the conversation so far:\n\n${conversationHistory}\n\nGenerate Sarah's (the CEO's) next message. Keep it natural and concise. Just output the message, nothing else.`
    }
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: CEO_PERSONA,
    messages
  });

  return response.content[0].text.trim();
}

/**
 * Run a single conversation iteration
 */
/**
 * Clear test data for fresh start
 */
async function clearTestData() {
  console.log(`\n🧹 Clearing test data for ${TEST_PHONE}...`);
  try {
    const response = await fetch(`http://localhost:3002/api/test/clear/${TEST_PHONE}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      console.log('✓ Test data cleared');
    } else {
      console.log(`⚠️ Clear failed: ${response.status}`);
    }
  } catch (err) {
    console.log(`⚠️ Clear error: ${err.message}`);
  }
}

async function runConversation(iterationNum) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 ITERATION ${iterationNum}/${TOTAL_ITERATIONS}`);
  console.log(`${'='.repeat(60)}`);

  // Clear test data from previous iteration
  await clearTestData();

  const startTime = Date.now();
  const endTime = startTime + CONVERSATION_DURATION_MS;
  const conversationLog = [];
  const toolCalls = [];
  let messageCount = 0;

  // Initial CEO message
  let ceoMessage = "Hey! Its Sarah from the conference. Great meeting you earlier!";

  while (Date.now() < endTime) {
    messageCount++;
    console.log(`\n[${messageCount}] 👤 CEO: ${ceoMessage}`);
    conversationLog.push({ role: 'user', content: ceoMessage, timestamp: new Date().toISOString() });

    // Send to orchestrator
    let aiResponse;
    let responseToolCalls = [];
    try {
      const result = await sendToOrchestrator(ceoMessage);
      aiResponse = result.response || result.content || 'No response';

      // Track tool calls
      if (result.toolCalls) {
        for (const tc of result.toolCalls) {
          toolCalls.push({ name: tc.name, input: tc.input });
          responseToolCalls.push(tc.name);
          results.toolCallCounts[tc.name] = (results.toolCallCounts[tc.name] || 0) + 1;
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      aiResponse = '[ERROR: ' + err.message + ']';
    }

    console.log(`[${messageCount}] 🤖 AI: ${aiResponse.substring(0, 200)}${aiResponse.length > 200 ? '...' : ''}`);
    if (responseToolCalls.length > 0) {
      console.log(`    📌 Tools: ${responseToolCalls.join(', ')}`);
    }
    conversationLog.push({ role: 'assistant', content: aiResponse, tools: responseToolCalls, timestamp: new Date().toISOString() });

    // Check if we should continue
    if (Date.now() >= endTime) break;

    // Wait before next message
    await new Promise(r => setTimeout(r, MESSAGE_INTERVAL_MS));

    // Generate CEO's response
    const history = conversationLog.map(m =>
      `${m.role === 'user' ? 'Sarah' : 'Mike'}: ${m.content}`
    ).join('\n');

    try {
      ceoMessage = await generateCEOMessage(history);
    } catch (err) {
      console.error(`❌ CEO generation error: ${err.message}`);
      ceoMessage = "That sounds interesting, tell me more.";
    }
  }

  // Analyze for hallucinations
  console.log(`\n🔍 Analyzing conversation for hallucinations...`);
  const hallucinations = await analyzeForHallucinations(conversationLog);

  const iterationResult = {
    iteration: iterationNum,
    messageCount: conversationLog.length,
    conversationLog,
    toolCalls,
    hallucinations,
    hallucinationCount: hallucinations.length
  };

  results.iterations.push(iterationResult);
  results.totalHallucinations += hallucinations.length;

  console.log(`\n📊 Iteration ${iterationNum} Results:`);
  console.log(`   Messages: ${conversationLog.length}`);
  console.log(`   Tool calls: ${toolCalls.map(t => t.name).join(', ') || 'none'}`);
  console.log(`   Hallucinations found: ${hallucinations.length}`);

  if (hallucinations.length > 0) {
    console.log(`\n⚠️  Hallucinations detected:`);
    for (const h of hallucinations) {
      console.log(`   - [${h.type}] ${h.description}`);
    }
  }

  return iterationResult;
}

/**
 * Analyze conversation for hallucinations using Claude
 */
async function analyzeForHallucinations(conversationLog) {
  const conversation = conversationLog.map((m, i) =>
    `[${i + 1}] ${m.role === 'user' ? 'USER (Sarah/CEO)' : 'AI (Mike)'}: ${m.content}`
  ).join('\n\n');

  const analysisPrompt = `Analyze this conversation for AI hallucinations. A hallucination is when the AI:

1. CONTEXT_LOSS: Forgets what was just discussed and starts fresh (e.g., "Hey! How can I help?" after an ongoing conversation)
2. WRONG_INFO: States incorrect facts about the user or conversation
3. IGNORES_SELECTION: User picks an option (like "1" or "2") but AI doesn't acknowledge the selection
4. REPEATS_QUESTION: Asks for info the user already provided
5. NON_SEQUITUR: Response doesn't logically follow from the previous message
6. OVER_EAGER: Tries to collect info when user is trying to complete a different action (like booking)
7. CONTRADICTS_SELF: Says something that contradicts what it said earlier

CONVERSATION:
${conversation}

Return a JSON array of hallucinations found. Each should have:
- type: one of the types above
- messageIndex: which AI message (1-indexed)
- description: brief explanation (under 100 chars)

If no hallucinations, return empty array: []

Return ONLY valid JSON, no other text or markdown.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    const text = response.content[0].text.trim();
    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = text;
    if (text.includes('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err) {
    console.error(`Analysis error: ${err.message}`);
    return [];
  }
}

/**
 * Generate prompt adjustment suggestions
 */
async function generatePromptSuggestions(allHallucinations) {
  if (allHallucinations.length === 0) return [];

  // Group by type
  const byType = {};
  for (const h of allHallucinations) {
    byType[h.type] = (byType[h.type] || 0) + 1;
  }

  const hallucinationSummary = Object.entries(byType)
    .map(([type, count]) => `- ${type}: ${count} occurrences`)
    .join('\n');

  const examples = allHallucinations.slice(0, 5).map(h =>
    `- ${h.type}: ${h.description}`
  ).join('\n');

  const prompt = `Based on these AI hallucination patterns, suggest specific prompt improvements:

PATTERN SUMMARY:
${hallucinationSummary}

EXAMPLE HALLUCINATIONS:
${examples}

The AI is a networking assistant for "Michael Friedberg" at "Conference 2026". It should:
- Remember conversation context
- Prioritize completing actions (like booking) over collecting more info
- Not reset/restart conversations mid-flow

Provide 3-5 specific, actionable prompt changes. Return as a JSON array of strings.
Return ONLY valid JSON, no markdown.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();
    let jsonStr = text;
    if (text.includes('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err) {
    console.error(`Suggestion error: ${err.message}`);
    return [];
  }
}

/**
 * Save results to file
 */
function saveResults() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tests/results/hallucination-test-${timestamp}.json`;

  // Ensure directory exists
  if (!fs.existsSync('tests/results')) {
    fs.mkdirSync('tests/results', { recursive: true });
  }

  results.endTime = new Date().toISOString();
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${filename}`);
  return filename;
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Starting Conversation Simulator');
  console.log(`   Iterations: ${TOTAL_ITERATIONS}`);
  console.log(`   Duration per conversation: ${CONVERSATION_DURATION_MS / 1000}s`);
  console.log(`   Message interval: ${MESSAGE_INTERVAL_MS / 1000}s`);
  console.log(`   API URL: ${API_URL}`);

  const overallStart = Date.now();

  for (let i = 1; i <= TOTAL_ITERATIONS; i++) {
    try {
      await runConversation(i);
    } catch (err) {
      console.error(`\n❌ Iteration ${i} failed: ${err.message}`);
      results.iterations.push({
        iteration: i,
        error: err.message,
        hallucinationCount: 0,
        hallucinations: []
      });
    }

    // After each iteration, collect all hallucinations so far
    const allHallucinations = results.iterations.flatMap(r => r.hallucinations || []);

    // Every 3 iterations, generate suggestions
    if (i % 3 === 0 && allHallucinations.length > 0) {
      console.log(`\n🔧 Generating prompt improvement suggestions...`);
      const suggestions = await generatePromptSuggestions(allHallucinations);
      if (suggestions.length > 0) {
        results.promptAdjustments.push({
          afterIteration: i,
          totalHallucinationsSoFar: allHallucinations.length,
          suggestions
        });
        console.log(`   Suggestions:`);
        for (const s of suggestions) {
          console.log(`   • ${s}`);
        }
      }
    }

    // Brief pause between iterations
    if (i < TOTAL_ITERATIONS) {
      console.log(`\n⏳ Waiting 5s before next iteration...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Final summary
  const totalTime = (Date.now() - overallStart) / 1000 / 60;

  console.log(`\n${'='.repeat(60)}`);
  console.log('📈 FINAL SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
  console.log(`Total iterations: ${TOTAL_ITERATIONS}`);
  console.log(`Total hallucinations: ${results.totalHallucinations}`);

  console.log(`\nTool call frequency:`);
  for (const [tool, count] of Object.entries(results.toolCallCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${tool}: ${count}`);
  }

  console.log(`\nHallucinations by iteration:`);
  for (const r of results.iterations) {
    const bar = '█'.repeat(r.hallucinationCount || 0) || '✓';
    console.log(`   Iteration ${r.iteration}: ${bar} (${r.hallucinationCount || 0})`);
  }

  // Hallucination types breakdown
  const typeBreakdown = {};
  for (const r of results.iterations) {
    for (const h of (r.hallucinations || [])) {
      typeBreakdown[h.type] = (typeBreakdown[h.type] || 0) + 1;
    }
  }
  if (Object.keys(typeBreakdown).length > 0) {
    console.log(`\nHallucination types:`);
    for (const [type, count] of Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${type}: ${count}`);
    }
  }

  const resultFile = saveResults();
  console.log(`\n✅ Test completed. Review results at: ${resultFile}`);
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

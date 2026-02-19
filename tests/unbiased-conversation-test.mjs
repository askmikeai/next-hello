/**
 * Unbiased Conversation Test
 *
 * Uses different AI providers to eliminate bias:
 * - OpenAI (GPT-4o) for CEO persona simulation
 * - Anthropic (Claude) for the AI assistant (via orchestrator)
 * - OpenAI (GPT-4o) for hallucination analysis
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import fs from 'fs';

// Config
const TEST_PHONE = '15559876543'; // Test phone number
const CONVERSATION_TURNS = 10; // Number of back-and-forth exchanges
const TOTAL_ITERATIONS = 6;
const API_URL = 'http://localhost:3002/api/test/process';

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CEO persona for simulation (run by OpenAI)
const CEO_SYSTEM_PROMPT = `You are Sarah Chen, CEO of TechVentures Inc, a B2B SaaS company with 200 employees.
You just met Mike at a networking event (Conference 2026) and he gave you his WhatsApp.
You're interested in potentially partnering or investing but want to learn more.

Your conversation style:
- Professional but friendly
- Ask about what Mike does, his company, potential synergies
- Eventually want to schedule a meeting
- Sometimes give short responses (just "yes", "sounds good", numbers to pick options)
- If asked for info, provide: email sarah@techventures.com, company TechVentures Inc, title CEO
- If shown numbered options and you want to pick one, just reply with the number (e.g., "2" or "3")

IMPORTANT:
- Respond as Sarah would in a real WhatsApp conversation
- Keep messages natural and concise (1-3 sentences max)
- Only output Sarah's message - no explanations or meta-commentary
- Don't include quotation marks around your message`;

// Results tracking
const results = {
  startTime: new Date().toISOString(),
  testConfig: {
    ceoModel: 'gpt-4o',
    assistantModel: 'claude (via orchestrator)',
    analysisModel: 'gpt-4o'
  },
  iterations: [],
  totalHallucinations: 0,
  toolCallCounts: {}
};

/**
 * Clear test data
 */
async function clearTestData() {
  try {
    await fetch(`http://localhost:3002/api/test/clear/${TEST_PHONE}`, { method: 'DELETE' });
    console.log('✓ Test data cleared');
  } catch (err) {
    console.log(`⚠️ Clear error: ${err.message}`);
  }
}

/**
 * Send message to orchestrator (Anthropic/Claude)
 */
async function sendToOrchestrator(message) {
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

  return JSON.parse(text);
}

/**
 * Generate CEO message using OpenAI GPT-4o
 */
async function generateCEOMessage(conversationHistory) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 150,
    temperature: 0.8,
    messages: [
      { role: 'system', content: CEO_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Conversation so far:\n\n${conversationHistory}\n\nGenerate Sarah's next message. Keep it natural and concise.`
      }
    ]
  });

  return response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
}

/**
 * Analyze conversation for hallucinations using OpenAI GPT-4o
 */
async function analyzeForHallucinations(conversationLog) {
  const conversation = conversationLog.map((m, i) =>
    `[${i + 1}] ${m.role === 'user' ? 'USER (Sarah/CEO)' : 'AI (Mike\'s assistant)'}: ${m.content}`
  ).join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You are an AI quality analyst. Analyze conversations for hallucinations and errors. Be objective and precise. Return only valid JSON.`
      },
      {
        role: 'user',
        content: `Analyze this conversation for AI hallucinations. A hallucination is when the AI:

1. CONTEXT_LOSS: Forgets what was discussed and restarts (e.g., "Hey! How can I help?" mid-conversation)
2. WRONG_INFO: States incorrect facts about the user or claims to have info it doesn't have
3. IGNORES_SELECTION: User picks an option (like "2") but AI doesn't acknowledge the specific selection
4. REPEATS_QUESTION: Asks for info the user already provided
5. NON_SEQUITUR: Response doesn't logically follow from the previous message
6. OVER_EAGER: Takes actions user explicitly declined or didn't ask for
7. CONTRADICTS_SELF: Says something contradicting what it said earlier

CONVERSATION:
${conversation}

Return a JSON array of hallucinations found. Each should have:
- type: one of the types above
- messageIndex: which AI message (number)
- description: brief explanation (under 80 chars)

If no hallucinations, return: []

Return ONLY the JSON array, no other text.`
      }
    ]
  });

  try {
    const text = response.choices[0].message.content.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err) {
    console.error(`Analysis parse error: ${err.message}`);
    return [];
  }
}

/**
 * Run a single conversation iteration
 */
async function runConversation(iterationNum) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 ITERATION ${iterationNum}/${TOTAL_ITERATIONS}`);
  console.log(`   CEO Model: GPT-4o (OpenAI)`);
  console.log(`   Assistant: Claude (Anthropic via orchestrator)`);
  console.log(`   Analyzer: GPT-4o (OpenAI)`);
  console.log(`${'='.repeat(60)}`);

  await clearTestData();

  const conversationLog = [];
  const toolCalls = [];

  // Initial CEO message
  let ceoMessage = "Hey! Its Sarah from the conference. Great meeting you earlier!";

  for (let turn = 1; turn <= CONVERSATION_TURNS; turn++) {
    console.log(`\n[${turn}] 👤 CEO (GPT-4o): ${ceoMessage}`);
    conversationLog.push({ role: 'user', content: ceoMessage });

    // Send to orchestrator (Claude)
    let aiResponse;
    try {
      const result = await sendToOrchestrator(ceoMessage);
      aiResponse = result.response || result.content || 'No response';

      // Track tool calls
      if (result.toolCalls) {
        for (const tc of result.toolCalls) {
          toolCalls.push({ name: tc.name, turn });
          results.toolCallCounts[tc.name] = (results.toolCallCounts[tc.name] || 0) + 1;
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      aiResponse = `[ERROR: ${err.message}]`;
    }

    const displayResponse = aiResponse.length > 180 ? aiResponse.substring(0, 180) + '...' : aiResponse;
    console.log(`[${turn}] 🤖 AI (Claude): ${displayResponse}`);
    conversationLog.push({ role: 'assistant', content: aiResponse });

    // Check for conversation-ending signals
    if (aiResponse.toLowerCase().includes('have a great') ||
        aiResponse.toLowerCase().includes('talk soon') ||
        turn >= CONVERSATION_TURNS) {
      break;
    }

    // Generate next CEO message using OpenAI
    const history = conversationLog.map(m =>
      `${m.role === 'user' ? 'Sarah' : 'Mike\'s AI'}: ${m.content}`
    ).join('\n');

    try {
      ceoMessage = await generateCEOMessage(history);
    } catch (err) {
      console.error(`❌ CEO generation error: ${err.message}`);
      ceoMessage = "Interesting, tell me more.";
    }

    // Small delay between turns
    await new Promise(r => setTimeout(r, 1000));
  }

  // Analyze for hallucinations using OpenAI
  console.log(`\n🔍 Analyzing with GPT-4o for hallucinations...`);
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
  console.log(`   Tool calls: ${toolCalls.map(t => t.name).join(', ') || 'none tracked'}`);
  console.log(`   Hallucinations: ${hallucinations.length}`);

  if (hallucinations.length > 0) {
    console.log(`\n⚠️  Issues found:`);
    for (const h of hallucinations) {
      console.log(`   - [${h.type}] ${h.description}`);
    }
  } else {
    console.log(`\n✅ No hallucinations detected!`);
  }

  return iterationResult;
}

/**
 * Save results
 */
function saveResults() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tests/results/unbiased-test-${timestamp}.json`;

  if (!fs.existsSync('tests/results')) {
    fs.mkdirSync('tests/results', { recursive: true });
  }

  results.endTime = new Date().toISOString();
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${filename}`);
  return filename;
}

/**
 * Main
 */
async function main() {
  console.log('🚀 Unbiased Conversation Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CEO Simulation: OpenAI GPT-4o');
  console.log('AI Assistant: Anthropic Claude (orchestrator)');
  console.log('Analysis: OpenAI GPT-4o');
  console.log(`Iterations: ${TOTAL_ITERATIONS}`);
  console.log(`Turns per conversation: ${CONVERSATION_TURNS}`);

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

    if (i < TOTAL_ITERATIONS) {
      console.log(`\n⏳ Waiting 3s before next iteration...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📈 FINAL SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total iterations: ${TOTAL_ITERATIONS}`);
  console.log(`Total hallucinations: ${results.totalHallucinations}`);
  console.log(`Average per conversation: ${(results.totalHallucinations / TOTAL_ITERATIONS).toFixed(1)}`);

  console.log(`\nHallucinations by iteration:`);
  for (const r of results.iterations) {
    const bar = '█'.repeat(r.hallucinationCount || 0) || '✓';
    console.log(`   ${r.iteration}: ${bar} (${r.hallucinationCount || 0})`);
  }

  // Type breakdown
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

  saveResults();
  console.log(`\n✅ Test completed!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

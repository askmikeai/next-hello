/**
 * Simple test script to verify swarm components work
 * Run with: npx tsx src/swarm/test-swarm.ts
 */

import { createLogger, logEvent } from "../observability/logger.js";
import { getRedisConnection, checkRedisHealth } from "../queue/client.js";
import { getCircuitBreaker } from "../resilience/circuit-breaker.js";
import { createAgent } from "./base-agent.js";

// Import agent registrations
import "./agents/research.agent.js";
import "./agents/qualification.agent.js";
import "./agents/crm.agent.js";
import "./agents/video.agent.js";
import "./agents/voice.agent.js";
import "./agents/personalization.agent.js";

const logger = createLogger({ component: "swarm-test" });

async function testRedisConnection(): Promise<boolean> {
  console.log("\n🔌 Testing Redis connection...");
  try {
    const health = await checkRedisHealth();
    if (health.connected) {
      console.log(`   ✅ Redis connected (latency: ${health.latencyMs}ms)`);
      return true;
    } else {
      console.log(`   ❌ Redis not connected: ${health.error}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Redis error: ${error}`);
    return false;
  }
}

function testCircuitBreaker(): boolean {
  console.log("\n🔒 Testing circuit breaker...");
  try {
    const breaker = getCircuitBreaker("test-breaker");
    const state = breaker.getState();
    console.log(`   ✅ Circuit breaker created: ${state.name}`);
    console.log(`   State: ${state.state}, Failures: ${state.failures}`);
    return true;
  } catch (error) {
    console.log(`   ❌ Circuit breaker error: ${error}`);
    return false;
  }
}

function testAgentRegistry(): boolean {
  console.log("\n🤖 Testing agent registry...");
  try {
    const agentTypes = ["research", "qualification", "crm", "video", "voice", "personalization"] as const;
    for (const type of agentTypes) {
      const agent = createAgent(type);
      console.log(`   ✅ Agent '${type}' created: ${agent.constructor.name}`);
    }
    return true;
  } catch (error) {
    console.log(`   ❌ Agent registry error: ${error}`);
    return false;
  }
}

function testLogger(): boolean {
  console.log("\n📝 Testing structured logger...");
  try {
    const testLogger = createLogger({ test: true, component: "test" });
    logEvent(testLogger, "test_event", { data: "test" });
    console.log("   ✅ Logger working");
    return true;
  } catch (error) {
    console.log(`   ❌ Logger error: ${error}`);
    return false;
  }
}

async function checkAnthropicApiKey(): Promise<boolean> {
  console.log("\n🔑 Checking Anthropic API key...");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-...") {
    console.log("   ⚠️  ANTHROPIC_API_KEY is not set or is a placeholder");
    console.log("   Set it in .env to enable AI conversations");
    return false;
  }
  console.log("   ✅ ANTHROPIC_API_KEY is set");
  return true;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("       NextHello Swarm Architecture - Test Suite       ");
  console.log("═══════════════════════════════════════════════════════");

  const results: Record<string, boolean> = {};

  results.logger = testLogger();
  results.circuitBreaker = testCircuitBreaker();
  results.agentRegistry = testAgentRegistry();
  results.redis = await testRedisConnection();
  results.anthropicKey = await checkAnthropicApiKey();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("                       Summary                          ");
  console.log("═══════════════════════════════════════════════════════");

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  for (const [test, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✅" : "❌"} ${test}`);
  }

  console.log(`\n  Total: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("\n  🎉 All systems ready! The swarm is operational.");
  } else {
    console.log("\n  ⚠️  Some components need attention.");
    if (!results.anthropicKey) {
      console.log("\n  Next steps:");
      console.log("  1. Set ANTHROPIC_API_KEY in .env with a valid key");
      console.log("  2. Run the database migration (migrations/001_swarm_tables.sql)");
    }
  }

  // Cleanup
  const redis = getRedisConnection();
  if (redis) {
    await redis.quit();
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);

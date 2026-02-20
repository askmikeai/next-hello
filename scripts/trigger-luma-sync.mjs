/**
 * Trigger Luma Sync Job
 * 
 * Usage: node scripts/trigger-luma-sync.mjs [type]
 * Types: full-sync (default), match-contacts
 */

import { Queue } from "bullmq";
import { randomUUID } from "crypto";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

async function main() {
  const type = process.argv[2] || "full-sync";
  const correlationId = randomUUID();

  console.log(`🚀 Triggering Luma ${type} job...`);
  console.log(`   Correlation ID: ${correlationId}`);

  const queue = new Queue("luma-sync", {
    connection: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      maxRetriesPerRequest: null,
    },
  });

  try {
    const job = await queue.add("luma-sync", {
      type,
      correlationId,
    });

    console.log(`✅ Job added to queue`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Type: ${type}`);
    console.log(`\nMonitor progress with: redis-cli MONITOR | grep luma`);
    
    await queue.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to add job:", error.message);
    await queue.close();
    process.exit(1);
  }
}

main();

import { generateVoiceMessage } from '../dist/integrations/elevenlabs/client.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Queue } from 'bullmq';

// Load config
const config = JSON.parse(readFileSync('./nexthello.config.json', 'utf-8'));

const phoneNumber = process.argv[2] || '13059271583';
const firstName = process.argv[3] || 'A';

console.log('Generating voice message for', firstName, 'at', phoneNumber, '...');

const result = await generateVoiceMessage(
  config.elevenlabs,
  config.elevenlabs.scriptTemplate,
  firstName
);

if (result.status !== 'completed' || !result.audioData) {
  console.error('Failed:', result.error);
  process.exit(1);
}

console.log('Generated audio:', result.audioData.length, 'bytes');

// Save file
const mediaDir = process.env.MEDIA_DIR || './data/media/voice';
await mkdir(mediaDir, { recursive: true });
const filename = 'voice_' + phoneNumber + '_' + Date.now() + '.ogg';
const audioPath = join(mediaDir, filename);
await writeFile(audioPath, result.audioData);
console.log('Saved to:', audioPath);

// Queue for sending
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const queue = new Queue('outbound-messages', {
  connection: { host: redisHost, port: parseInt(redisPort) }
});

await queue.add('voice-message', {
  correlationId: 'manual-' + Date.now(),
  phoneNumber: phoneNumber,
  channel: 'whatsapp',
  messageType: 'voice',
  content: audioPath,
});

console.log('✅ Voice message queued for', phoneNumber);
await queue.close();

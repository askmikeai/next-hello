/**
 * Send voice message to a contact
 * Usage: DATABASE_URL=your_url node send-voice-to-contact.mjs "A S"
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// Load config
const configPath = process.env.NEXTHELLO_CONFIG || './nexthello.config.json';
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

if (!config.elevenlabs?.voiceId) {
  console.error('ElevenLabs not configured in nexthello.config.json');
  process.exit(1);
}

const searchName = process.argv[2] || 'A S';
console.log('Searching for contact:', searchName);

const sql = postgres(process.env.DATABASE_URL);

// Find contact
const contacts = await sql`
  SELECT id, phone_number, first_name, last_name
  FROM networking_contacts
  WHERE (first_name || ' ' || last_name) ILIKE ${'%' + searchName + '%'}
  OR first_name ILIKE ${searchName.split(' ')[0] + '%'}
  LIMIT 5
`;

if (contacts.length === 0) {
  console.log('No contact found matching:', searchName);
  await sql.end();
  process.exit(1);
}

const contact = contacts[0];
console.log('Found:', contact.first_name, contact.last_name, '-', contact.phone_number);

// Generate voice message
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error('ELEVENLABS_API_KEY not set');
  await sql.end();
  process.exit(1);
}

const scriptTemplate = config.elevenlabs.scriptTemplate || 'Hey {name}! Just wanted to follow up.';
const script = scriptTemplate.replace(/\{name\}/g, contact.first_name || 'there');

console.log('Generating voice message...');
console.log('Script:', script);

const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${config.elevenlabs.voiceId}`, {
  method: 'POST',
  headers: {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'audio/mpeg',
  },
  body: JSON.stringify({
    text: script,
    model_id: config.elevenlabs.modelId || 'eleven_monolingual_v1',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  }),
});

if (!response.ok) {
  const error = await response.text();
  console.error('ElevenLabs error:', response.status, error);
  await sql.end();
  process.exit(1);
}

const audioBuffer = Buffer.from(await response.arrayBuffer());
console.log('Generated audio:', (audioBuffer.length / 1024).toFixed(2), 'KB');

// Save audio file
const mediaDir = './data/media/voice';
await mkdir(mediaDir, { recursive: true });

const phoneClean = contact.phone_number.replace(/[^0-9]/g, '');
const filename = `voice_${phoneClean}_${Date.now()}.mp3`;
const audioPath = join(mediaDir, filename);

await writeFile(audioPath, audioBuffer);
console.log('Saved to:', audioPath);

// Queue for sending (add to outbound-messages queue)
// This requires Redis to be running
try {
  const { Queue } = await import('bullmq');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const queue = new Queue('outbound-messages', {
    connection: { url: redisUrl },
  });

  await queue.add('voice-message', {
    correlationId: `manual-${Date.now()}`,
    phoneNumber: contact.phone_number,
    channel: 'whatsapp',
    messageType: 'voice',
    content: audioPath,
    metadata: {
      contactId: contact.id,
      manual: true,
    },
  });

  console.log('✅ Voice message queued for', contact.phone_number);
  await queue.close();
} catch (err) {
  console.log('Could not queue (Redis not available). Audio saved at:', audioPath);
  console.log('To send manually, use the WhatsApp client sendVoiceByPhone() method');
}

await sql.end();
console.log('Done!');

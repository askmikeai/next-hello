/**
 * WhatsApp Bridge - Connects via QR code and forwards messages to Python API
 * Uses whatsapp-web.js (Puppeteer-based) for more stable connections
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
const QR_OUTPUT_DIR = process.env.QR_OUTPUT_DIR || '/tmp';
const QR_FILE = path.join(QR_OUTPUT_DIR, 'whatsapp-qr.txt');

const logger = pino({ level: 'info' });

async function forwardToPython(endpoint, data) {
  try {
    const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await response.json();
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to forward to Python API');
    return null;
  }
}

// Initialize WhatsApp client with Puppeteer
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './auth_state'
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--single-process'
    ]
  }
});

// QR Code event
client.on('qr', (qr) => {
  console.log('\n');
  console.log('='.repeat(50));
  console.log('  Scan this QR code with WhatsApp:');
  console.log('='.repeat(50));

  qrcode.generate(qr, { small: true }, (qrText) => {
    console.log(qrText);

    // Write QR code to file for external access
    const output = [
      '='.repeat(50),
      '  Scan this QR code with WhatsApp',
      '  Generated: ' + new Date().toISOString(),
      '='.repeat(50),
      '',
      qrText,
      '',
      '='.repeat(50),
    ].join('\n');

    try {
      fs.writeFileSync(QR_FILE, output, 'utf8');
      console.log(`\n📱 QR code saved to: ${QR_FILE}\n`);
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to write QR code to file');
    }
  });

  console.log('='.repeat(50));
  console.log('\n');
});

// Ready event
client.on('ready', () => {
  logger.info('Connected to WhatsApp!');
  console.log('\n✅ WhatsApp connected! Listening for messages...\n');

  // Clean up QR file after successful connection
  try {
    if (fs.existsSync(QR_FILE)) {
      fs.unlinkSync(QR_FILE);
      logger.info('QR code file removed after successful connection');
    }
  } catch (err) {
    // Ignore cleanup errors
  }
});

// Authentication event
client.on('authenticated', () => {
  logger.info('WhatsApp authenticated');
});

// Authentication failure
client.on('auth_failure', (msg) => {
  logger.error({ msg }, 'Authentication failed');
  console.error('❌ Authentication failed:', msg);
});

// Disconnected event
client.on('disconnected', (reason) => {
  logger.info({ reason }, 'WhatsApp disconnected');
  console.log('Disconnected:', reason);
});

// Message event
client.on('message', async (msg) => {
  // Skip status broadcasts
  if (msg.from === 'status@broadcast') return;

  const phoneNumber = msg.from.replace('@c.us', '');
  const contact = await msg.getContact();
  const pushName = contact.pushname || contact.name || '';

  // Determine message type
  let messageType = 'text';
  let content = msg.body || '';

  if (msg.hasMedia) {
    if (msg.type === 'image') messageType = 'image';
    else if (msg.type === 'video') messageType = 'video';
    else if (msg.type === 'audio' || msg.type === 'ptt') messageType = 'audio';
    else if (msg.type === 'document') messageType = 'document';
  }

  logger.info({ phoneNumber, messageType, content: content?.slice(0, 50) }, 'Received message');

  // Forward to Python API
  const result = await forwardToPython('/bridge/message', {
    phone_number: phoneNumber,
    message_id: msg.id._serialized,
    message_type: messageType,
    content,
    push_name: pushName,
    media_id: null,
  });

  // Send response back if Python returned one
  if (result?.response) {
    try {
      await msg.reply(result.response);
      logger.info({ to: phoneNumber }, 'Message sent');
    } catch (error) {
      logger.error({ error: error.message, to: phoneNumber }, 'Failed to send message');
    }
  }
});

// Handle incoming calls (reject them)
client.on('call', async (call) => {
  logger.info({ from: call.from }, 'Rejecting incoming call');
  await call.reject();

  // Send a message explaining we don't take calls
  const phoneNumber = call.from.replace('@c.us', '');
  try {
    await client.sendMessage(call.from, "Sorry, I can't take calls right now. Please send me a text message instead!");
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to send call rejection message');
  }
});

// Start the client
console.log('Starting WhatsApp Bridge (whatsapp-web.js)...');
console.log(`Python API: ${PYTHON_API_URL}`);
console.log('Launching browser...');

client.initialize();

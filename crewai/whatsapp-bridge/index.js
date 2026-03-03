/**
 * WhatsApp Bridge - Connects via QR code and forwards messages to Python API
 * Uses whatsapp-web.js (Puppeteer-based) for more stable connections
 *
 * Session persistence:
 * - Local: Chromium profile in ./auth_state (Docker volume)
 * - Remote: PostgreSQL backup for cloud portability
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http';
import PostgresSessionStore from './pg-store.js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
const QR_OUTPUT_DIR = process.env.QR_OUTPUT_DIR || '/tmp';
const QR_FILE = path.join(QR_OUTPUT_DIR, 'whatsapp-qr.txt');
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'default';
const DATABASE_URL = process.env.DATABASE_URL;

const logger = pino({ level: 'info' });

// PostgreSQL session store (optional - only if DATABASE_URL is set)
let sessionStore = null;

async function initSessionStore() {
  if (!DATABASE_URL) {
    logger.info('DATABASE_URL not set - using local storage only');
    return;
  }

  sessionStore = new PostgresSessionStore({
    connectionString: DATABASE_URL,
    sessionId: SESSION_ID,
    localPath: './auth_state',
    logger,
  });

  await sessionStore.init();

  // If no local session, try to restore from PostgreSQL
  if (!sessionStore.hasLocalSession()) {
    logger.info('No local session found, checking PostgreSQL...');
    const hasRemote = await sessionStore.hasRemoteSession();
    if (hasRemote) {
      logger.info('Found remote session, restoring...');
      await sessionStore.restore();
    }
  }
}

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

// Realistic user agent (Chrome on macOS - matches WhatsApp Web expectations)
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Check if we should run headless (default: true in Docker, false locally)
const HEADLESS = process.env.HEADLESS !== 'false';

// Build puppeteer args
const puppeteerArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--start-maximized',
  `--user-agent=${USER_AGENT}`,
  '--lang=en-US,en',
];

// Add Docker-specific args only when running headless (in container)
if (HEADLESS) {
  puppeteerArgs.push(
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  );
}

// Initialize WhatsApp client with stealth Puppeteer
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './auth_state'
  }),
  puppeteer: {
    headless: HEADLESS ? 'new' : false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: puppeteerArgs,
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
client.on('ready', async () => {
  logger.info('Connected to WhatsApp!');
  console.log('\n✅ WhatsApp connected! Listening for messages...\n');

  // Mark as online so last seen updates
  await client.sendPresenceAvailable();

  // Clean up QR file after successful connection
  try {
    if (fs.existsSync(QR_FILE)) {
      fs.unlinkSync(QR_FILE);
      logger.info('QR code file removed after successful connection');
    }
  } catch (err) {
    // Ignore cleanup errors
  }

  // Backup session to PostgreSQL
  if (sessionStore) {
    logger.info('Backing up session to PostgreSQL...');
    await sessionStore.backup();
  }

  // Start HTTP server
  server.listen(HTTP_PORT, () => {
    console.log(`HTTP API listening on port ${HTTP_PORT}`);
    console.log(`Send messages: POST http://localhost:${HTTP_PORT}/send {"to": "+1234567890", "message": "Hello"}`);
  });
});

// Authentication event
client.on('authenticated', async () => {
  logger.info('WhatsApp authenticated');

  // Backup session to PostgreSQL after authentication
  if (sessionStore) {
    // Wait a bit for session files to be written
    setTimeout(async () => {
      await sessionStore.backup();
    }, 5000);
  }
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

  // Mark chat as seen — sends read receipts and updates last seen
  const chat = await msg.getChat();
  await chat.sendSeen();

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
  try {
    await client.sendMessage(call.from, "Sorry, I can't take calls right now. Please send me a text message instead!");
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to send call rejection message');
  }
});

// HTTP Server for sending messages and session management
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Send message endpoint
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, message } = JSON.parse(body);
        if (!to || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "to" or "message" field' }));
          return;
        }

        // Format phone number
        const chatId = to.replace(/[^0-9]/g, '') + '@c.us';

        await client.sendMessage(chatId, message);
        logger.info({ to: chatId }, 'Message sent via API');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, to: chatId }));
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to send message via API');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }
  // Send voice message endpoint
  else if (req.method === 'POST' && req.url === '/send-voice') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, audioPath, audioBase64, mimeType } = JSON.parse(body);
        if (!to || (!audioPath && !audioBase64)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "to" or audio data' }));
          return;
        }

        // Format phone number
        const chatId = to.replace(/[^0-9]/g, '') + '@c.us';

        // Create media from file path or base64
        let media;
        if (audioPath) {
          media = MessageMedia.fromFilePath(audioPath);
        } else {
          media = new MessageMedia(mimeType || 'audio/ogg; codecs=opus', audioBase64);
        }

        // Send as voice note (PTT)
        await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
        logger.info({ to: chatId }, 'Voice message sent via API');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, to: chatId }));
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to send voice message');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }
  // Health check endpoint
  else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connected: client.info ? true : false,
      sessionId: SESSION_ID,
      hasPostgres: !!sessionStore
    }));
  }
  // Backup session to PostgreSQL
  else if (req.method === 'POST' && req.url === '/session/backup') {
    if (!sessionStore) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PostgreSQL not configured' }));
      return;
    }
    const success = await sessionStore.backup();
    res.writeHead(success ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success }));
  }
  // Restore session from PostgreSQL
  else if (req.method === 'POST' && req.url === '/session/restore') {
    if (!sessionStore) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PostgreSQL not configured' }));
      return;
    }
    const success = await sessionStore.restore();
    res.writeHead(success ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, message: success ? 'Session restored. Restart container to use.' : 'No session to restore' }));
  }
  // Session status
  else if (req.method === 'GET' && req.url === '/session/status') {
    const status = {
      sessionId: SESSION_ID,
      hasLocal: sessionStore?.hasLocalSession() ?? fs.existsSync('./auth_state/session'),
      hasRemote: sessionStore ? await sessionStore.hasRemoteSession() : false,
      postgresConfigured: !!sessionStore
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }
  else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, backing up session...');
  if (sessionStore) {
    await sessionStore.backup();
    await sessionStore.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, backing up session...');
  if (sessionStore) {
    await sessionStore.backup();
    await sessionStore.close();
  }
  process.exit(0);
});

// Start the application
async function main() {
  console.log('Starting WhatsApp Bridge (whatsapp-web.js)...');
  console.log(`Python API: ${PYTHON_API_URL}`);
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`PostgreSQL: ${DATABASE_URL ? 'configured' : 'not configured'}`);

  // Initialize PostgreSQL session store
  await initSessionStore();

  console.log('Launching browser...');
  client.initialize();
}

main().catch(err => {
  logger.error({ error: err.message }, 'Failed to start');
  process.exit(1);
});

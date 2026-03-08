/**
 * WhatsApp connector powered by Baileys.
 *
 * - Connects using QR authentication
 * - Persists auth state in ./auth_state/session
 * - Optionally backs up/restores auth state to PostgreSQL
 * - Forwards inbound messages to the Python API
 */

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http';
import PostgresSessionStore from './pg-store.js';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
const QR_OUTPUT_DIR = process.env.QR_OUTPUT_DIR || '/tmp';
const QR_FILE = path.join(QR_OUTPUT_DIR, 'whatsapp-qr.txt');
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const SESSION_ID = process.env.SESSION_ID || 'default';
const DATABASE_URL = process.env.DATABASE_URL;
const AUTH_ROOT = './auth_state';
const AUTH_DIR = path.join(AUTH_ROOT, 'session');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let sessionStore = null;
let socket = null;
let isConnected = false;
let isStarting = false;
let backupTimer = null;

function serializeForLog(value, maxStringLength = 500) {
  const seen = new WeakSet();

  function walk(input) {
    if (input == null) return input;
    if (typeof input === 'string') {
      if (input.length <= maxStringLength) return input;
      return `${input.slice(0, maxStringLength)}...<truncated:${input.length}>`;
    }
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return input.toString();
    if (Buffer.isBuffer(input)) return `<Buffer length=${input.length}>`;
    if (Array.isArray(input)) return input.map((item) => walk(item));
    if (typeof input === 'object') {
      if (seen.has(input)) return '<circular>';
      seen.add(input);
      const out = {};
      for (const [k, v] of Object.entries(input)) {
        out[k] = walk(v);
      }
      return out;
    }
    return String(input);
  }

  return walk(value);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function toJid(phone) {
  return `${normalizePhone(phone)}@s.whatsapp.net`;
}

function fromJid(jid) {
  return String(jid || '').split('@')[0] || '';
}

function extractPhoneFromMessageKey(key = {}) {
  const candidates = [key.remoteJidAlt, key.remoteJid, key.participantAlt, key.participant]
    .filter(Boolean)
    .map((value) => fromJid(value))
    .map((value) => normalizePhone(value));

  for (const candidate of candidates) {
    if (candidate && candidate.length >= 7) {
      return candidate;
    }
  }

  return '';
}

function extractMessageDetails(message = {}) {
  if (message.conversation) {
    return { type: 'text', content: message.conversation };
  }

  if (message.extendedTextMessage?.text) {
    return { type: 'text', content: message.extendedTextMessage.text };
  }

  if (message.imageMessage) {
    return { type: 'image', content: message.imageMessage.caption || '' };
  }

  if (message.videoMessage) {
    return { type: 'video', content: message.videoMessage.caption || '' };
  }

  if (message.audioMessage) {
    return { type: 'audio', content: '' };
  }

  if (message.documentMessage) {
    return { type: 'document', content: message.documentMessage.caption || '' };
  }

  return { type: 'text', content: '' };
}

async function forwardToPython(endpoint, data) {
  try {
    const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.error(
        {
          endpoint,
          status: response.status,
          phoneNumber: data?.phone_number,
          messageId: data?.message_id,
          response: payload,
        },
        'Python API returned non-2xx response for inbound forward'
      );
    } else {
      logger.info(
        {
          endpoint,
          status: response.status,
          phoneNumber: data?.phone_number,
          messageId: data?.message_id,
          success: payload?.success,
        },
        'Forwarded inbound message to Python API'
      );
    }

    return payload;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to forward to Python API');
    return null;
  }
}

async function initSessionStore() {
  if (!DATABASE_URL) {
    logger.info('DATABASE_URL not set - using local auth state only');
    return;
  }

  sessionStore = new PostgresSessionStore({
    connectionString: DATABASE_URL,
    sessionId: SESSION_ID,
    localPath: AUTH_ROOT,
    logger,
  });

  await sessionStore.init();

  const remote = await sessionStore.getRemoteSessionInfo();
  if (remote.exists) {
    logger.info(
      { format: remote.format, updatedAt: remote.updatedAt },
      'Remote session found in PostgreSQL, attempting restore first'
    );
    const restored = await sessionStore.restore();
    if (!restored && !sessionStore.hasLocalSession()) {
      logger.info('Remote restore unavailable/incompatible and no local session; QR required');
    }
  } else if (!sessionStore.hasLocalSession()) {
    logger.info('No remote or local session found; QR authentication required');
  }
}

function writeQrFile(qrText) {
  const output = [
    '='.repeat(50),
    '  Scan this QR code with WhatsApp',
    `  Generated: ${new Date().toISOString()}`,
    '='.repeat(50),
    '',
    qrText,
    '',
    '='.repeat(50),
  ].join('\n');

  fs.mkdirSync(QR_OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(QR_FILE, output, 'utf8');
}

function cleanupQrFile() {
  try {
    if (fs.existsSync(QR_FILE)) {
      fs.unlinkSync(QR_FILE);
    }
  } catch (_) {
    // Ignore cleanup errors
  }
}

function scheduleBackup() {
  if (!sessionStore) {
    return;
  }

  if (backupTimer) {
    clearTimeout(backupTimer);
  }

  backupTimer = setTimeout(async () => {
    try {
      await sessionStore.backup();
    } catch (error) {
      logger.error({ error: error.message }, 'Session backup failed');
    }
  }, 3000);
}

async function ensureSocketConnected() {
  if (socket && isConnected) {
    return;
  }

  if (isStarting) {
    return;
  }

  isStarting = true;

  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS('Desktop'),
      printQRInTerminal: false,
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'trace' }),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    socket.ev.process(async (events) => {
      logger.info(
        {
          eventKeys: Object.keys(events || {}),
          events: serializeForLog(events || {}),
        },
        'Baileys event batch'
      );
    });

    socket.ev.on('messages.update', (updates = []) => {
      logger.info(
        {
          updates: serializeForLog(updates),
        },
        'Baileys messages.update'
      );
    });

    socket.ev.on('message-receipt.update', (updates = []) => {
      logger.info(
        {
          updates: serializeForLog(updates),
        },
        'Baileys message-receipt.update'
      );
    });

    socket.ev.on('creds.update', async () => {
      await saveCreds();
      scheduleBackup();
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n' + '='.repeat(50));
        console.log('  Scan this QR code with WhatsApp:');
        console.log('='.repeat(50));
        qrcode.generate(qr, { small: true }, (qrText) => {
          console.log(qrText);
          writeQrFile(qrText);
          console.log(`\nQR code saved to: ${QR_FILE}\n`);
        });
      }

      if (connection === 'open') {
        isConnected = true;
        cleanupQrFile();
        logger.info('Connected to WhatsApp via Baileys');
        scheduleBackup();
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ statusCode, shouldReconnect }, 'WhatsApp disconnected');

        if (shouldReconnect) {
          socket = null;
          setTimeout(() => {
            ensureSocketConnected().catch((error) => {
              logger.error({ error: error.message }, 'Reconnect failed');
            });
          }, 2000);
        }
      }
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !Array.isArray(messages)) {
        return;
      }

      for (const msg of messages) {
        if (!msg?.key || msg.key.fromMe) {
          continue;
        }

        const phoneNumber = extractPhoneFromMessageKey(msg.key);
        const remoteJid = msg.key.remoteJidAlt || msg.key.remoteJid;

        if (!phoneNumber) {
          logger.warn(
            {
              key: serializeForLog(msg.key),
            },
            'Skipping inbound message: unable to resolve phone number from key'
          );
          continue;
        }

        const { type: messageType, content } = extractMessageDetails(msg.message || {});
        let audioBase64 = null;
        let audioMimeType = null;

        if (messageType === 'audio') {
          try {
            const audioBuffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              {
                logger,
                reuploadRequest: socket.updateMediaMessage,
              }
            );

            if (audioBuffer) {
              audioBase64 = Buffer.from(audioBuffer).toString('base64');
              audioMimeType = msg.message?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
            }
          } catch (error) {
            logger.warn(
              {
                phoneNumber,
                messageId,
                error: error.message,
              },
              'Failed to download inbound audio for transcription'
            );
          }
        }
        const pushName = msg.pushName || null;
        const messageId = msg.key.id || `${Date.now()}`;

        try {
          await socket.readMessages([msg.key]);
          logger.info(
            {
              phoneNumber,
              messageId,
              remoteJid: msg.key.remoteJid,
            },
            'Marked inbound message as read'
          );
        } catch (error) {
          logger.warn(
            {
              phoneNumber,
              messageId,
              error: error.message,
            },
            'Failed to mark inbound message as read'
          );
        }

        logger.info(
          {
            phoneNumber,
            remoteJid: msg.key.remoteJid,
            remoteJidAlt: msg.key.remoteJidAlt,
            messageType,
            preview: content.slice(0, 60),
          },
          'Received incoming WhatsApp message'
        );

        const result = await forwardToPython('/whatsapp/message', {
          phone_number: phoneNumber,
          message_id: messageId,
          message_type: messageType,
          content,
          audio_base64: audioBase64,
          audio_mime_type: audioMimeType,
          push_name: pushName,
          media_id: null,
        });

        logger.info(
          {
            phoneNumber,
            messageId,
            forwarded: !!result,
            apiSuccess: !!result?.success,
          },
          'Inbound forward result'
        );

        if (result?.response && socket) {
          try {
            const replyJid = msg.key.remoteJid || msg.key.remoteJidAlt || toJid(phoneNumber);
            await socket.sendMessage(replyJid, { text: result.response }, { quoted: msg });
          } catch (error) {
            logger.error({ error: error.message }, 'Failed to send auto-reply');
          }
        }
      }
    });
  } finally {
    isStarting = false;
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      connected: isConnected,
      sessionId: SESSION_ID,
      hasPostgres: !!sessionStore,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/qr') {
    const hasQr = fs.existsSync(QR_FILE);
    sendJson(res, 200, {
      available: hasQr,
      connected: isConnected,
      qrText: hasQr ? fs.readFileSync(QR_FILE, 'utf8') : null,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    try {
      const { to, message } = await parseJsonBody(req);
      if (!to || !message) {
        sendJson(res, 400, { error: 'Missing "to" or "message" field' });
        return;
      }

      if (!socket || !isConnected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected' });
        return;
      }

      const jid = toJid(to);
      const sendResult = await socket.sendMessage(jid, { text: String(message) });
      const messageId = sendResult?.key?.id || null;

      logger.info(
        {
          to: jid,
          messageId,
          preview: String(message).slice(0, 120),
        },
        'Sent outbound WhatsApp message via Baileys'
      );

      sendJson(res, 200, {
        success: true,
        to: jid,
        messageId,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to send text message');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/send-voice') {
    try {
      const { to, audioPath, audioBase64, mimeType } = await parseJsonBody(req);
      if (!to || (!audioPath && !audioBase64)) {
        sendJson(res, 400, { error: 'Missing "to" or audio data' });
        return;
      }

      if (!socket || !isConnected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected' });
        return;
      }

      const jid = toJid(to);
      let audioBuffer;

      if (audioPath) {
        audioBuffer = fs.readFileSync(audioPath);
      } else {
        audioBuffer = Buffer.from(audioBase64, 'base64');
      }

      await socket.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: mimeType || 'audio/ogg; codecs=opus',
        ptt: true,
      });

      sendJson(res, 200, { success: true, to: jid });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to send voice message');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/session/backup') {
    if (!sessionStore) {
      sendJson(res, 400, { error: 'PostgreSQL not configured' });
      return;
    }
    const success = await sessionStore.backup();
    sendJson(res, success ? 200 : 500, { success });
    return;
  }

  if (req.method === 'POST' && req.url === '/session/restore') {
    if (!sessionStore) {
      sendJson(res, 400, { error: 'PostgreSQL not configured' });
      return;
    }
    const success = await sessionStore.restore();
    sendJson(res, success ? 200 : 500, {
      success,
      message: success ? 'Session restored. Restart container to use.' : 'No session to restore',
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/session/status') {
    const remote = sessionStore
      ? await sessionStore.getRemoteSessionInfo()
      : { exists: false, format: null };

    sendJson(res, 200, {
      sessionId: SESSION_ID,
      hasLocal: sessionStore?.hasLocalSession() ?? fs.existsSync(AUTH_DIR),
      hasRemote: remote.exists,
      remoteFormat: remote.format,
      postgresConfigured: !!sessionStore,
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

async function shutdown() {
  logger.info('Shutting down WhatsApp connector');

  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }

  if (sessionStore) {
    await sessionStore.backup();
    await sessionStore.close();
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function main() {
  console.log('Starting WhatsApp connector (Baileys)...');
  console.log(`Python API: ${PYTHON_API_URL}`);
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`PostgreSQL: ${DATABASE_URL ? 'configured' : 'not configured'}`);

  await initSessionStore();
  await ensureSocketConnected();

  server.listen(HTTP_PORT, () => {
    console.log(`HTTP API listening on port ${HTTP_PORT}`);
  });
}

main().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Failed to start');
  process.exit(1);
});

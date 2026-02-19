/**
 * WhatsApp Bridge - Connects via QR code and forwards messages to Python API
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
const AUTH_DIR = './auth_state';

const logger = pino({ level: 'info' });
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000; // Max 60 seconds between attempts

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

async function sendMessage(sock, to, text) {
  try {
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    logger.info({ to }, 'Message sent');
  } catch (error) {
    logger.error({ error: error.message, to }, 'Failed to send message');
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // Use built-in QR printing
    logger: pino({ level: 'debug' }), // Enable debug logging
    browser: ['NextHello', 'Chrome', '120.0.0'],
    syncFullHistory: false,
  });

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n');
      console.log('='.repeat(50));
      console.log('  Scan this QR code with WhatsApp:');
      console.log('='.repeat(50));
      qrcode.generate(qr, { small: true });
      console.log('='.repeat(50));
      console.log('\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.info({ statusCode, shouldReconnect }, 'Connection closed');

      if (shouldReconnect) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
        logger.info({ delay, attempt: reconnectAttempts }, 'Reconnecting after delay...');
        setTimeout(() => startWhatsApp(), delay);
      } else {
        logger.info('Logged out. Delete auth_state folder to re-authenticate.');
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0; // Reset on successful connection
      logger.info('Connected to WhatsApp!');
      console.log('\n✅ WhatsApp connected! Listening for messages...\n');
    }
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip outgoing messages and status updates
      if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

      const phoneNumber = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
      const pushName = msg.pushName;
      const messageId = msg.key.id;

      // Extract message content
      let content = '';
      let messageType = 'text';
      let mediaId = null;

      if (msg.message?.conversation) {
        content = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage?.text) {
        content = msg.message.extendedTextMessage.text;
      } else if (msg.message?.imageMessage) {
        messageType = 'image';
        content = msg.message.imageMessage.caption || '';
      } else if (msg.message?.audioMessage) {
        messageType = 'audio';
      } else if (msg.message?.videoMessage) {
        messageType = 'video';
        content = msg.message.videoMessage.caption || '';
      } else if (msg.message?.documentMessage) {
        messageType = 'document';
        content = msg.message.documentMessage.fileName || '';
      }

      logger.info({ phoneNumber, messageType, content: content?.slice(0, 50) }, 'Received message');

      // Forward to Python API
      const result = await forwardToPython('/bridge/message', {
        phone_number: phoneNumber,
        message_id: messageId,
        message_type: messageType,
        content,
        push_name: pushName,
        media_id: mediaId,
      });

      // Send response back if Python returned one
      if (result?.response) {
        await sendMessage(sock, phoneNumber, result.response);
      }
    }
  });

  // Handle call events (reject calls)
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        logger.info({ from: call.from }, 'Rejecting incoming call');
        await sock.rejectCall(call.id, call.from);

        // Send a message explaining we don't take calls
        const phoneNumber = call.from.replace('@s.whatsapp.net', '');
        await sendMessage(
          sock,
          phoneNumber,
          "Sorry, I can't take calls right now. Please send me a text message instead!"
        );
      }
    }
  });

  return sock;
}

// Start the bridge
console.log('Starting WhatsApp Bridge...');
console.log(`Python API: ${PYTHON_API_URL}`);
startWhatsApp();

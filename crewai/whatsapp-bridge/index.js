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
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import PostgresSessionStore from './pg-store.js';

const execFileAsync = promisify(execFile);

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
const QR_OUTPUT_DIR = process.env.QR_OUTPUT_DIR || '/tmp';
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const DEFAULT_OWNER_ID =
  process.env.NEXTHELLO_SYSTEM_OWNER_ID ||
  process.env.NEXTHELLO_DEFAULT_OWNER_ID ||
  'askmikeai@gmail.com';
const DEFAULT_SESSION_ID = process.env.SESSION_ID || normalizeOwnerId(DEFAULT_OWNER_ID);
const DATABASE_URL = process.env.DATABASE_URL;
const AUTH_ROOT = './auth_state';

const TYPING_MIN_DELAY_MS = Number(process.env.TYPING_MIN_DELAY_MS || 1400);
const TYPING_MAX_DELAY_MS = Number(process.env.TYPING_MAX_DELAY_MS || 5000);
const TYPING_MS_PER_CHAR = Number(process.env.TYPING_MS_PER_CHAR || 65);
const RECORDING_MIN_DELAY_MS = Number(process.env.RECORDING_MIN_DELAY_MS || 2500);
const RECORDING_MAX_DELAY_MS = Number(process.env.RECORDING_MAX_DELAY_MS || 8000);
const RECORDING_MS_PER_KB = Number(process.env.RECORDING_MS_PER_KB || 260);
const GROUP_METADATA_TTL_MS = Number(process.env.GROUP_METADATA_TTL_MS || 60000);
const GROUP_LIST_TTL_MS = Number(process.env.GROUP_LIST_TTL_MS || 30000);

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const sessions = new Map();

function normalizeOwnerId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return String(DEFAULT_OWNER_ID).trim().toLowerCase();
  return candidate.replace(/[^a-z0-9._-]/g, '-').slice(0, 120) || String(DEFAULT_OWNER_ID).trim().toLowerCase();
}

function sessionIdForOwner(ownerId) {
  const owner = normalizeOwnerId(ownerId);
  if (owner === normalizeOwnerId(DEFAULT_OWNER_ID)) {
    return DEFAULT_SESSION_ID;
  }
  return owner.replace(/[^a-z0-9._-]/g, '-').slice(0, 120) || 'default';
}

function parseOwnerFromUrl(reqUrl) {
  try {
    const url = new URL(reqUrl || '/', 'http://localhost');
    return normalizeOwnerId(url.searchParams.get('ownerId') || url.searchParams.get('owner'));
  } catch (_error) {
    return normalizeOwnerId(DEFAULT_OWNER_ID);
  }
}

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

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function fromJid(jid) {
  return String(jid || '').split('@')[0] || '';
}

function mentionLabelForParticipant(jid) {
  const phone = normalizePhone(fromJid(jid));
  return phone || fromJid(jid) || 'member';
}

function isPhoneJid(jid) {
  return typeof jid === 'string' && jid.includes('@s.whatsapp.net');
}

function extractPhoneFromMessageKey(key = {}) {
  const allJids = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt].filter(Boolean);

  for (const jid of allJids) {
    if (isPhoneJid(jid)) {
      const phone = normalizePhone(fromJid(jid));
      if (phone && phone.length >= 7) return phone;
    }
  }

  for (const jid of allJids) {
    const phone = normalizePhone(fromJid(jid));
    if (phone && phone.length >= 7) return phone;
  }

  return '';
}

function extractMessageDetails(message = {}) {
  if (message.conversation) return { type: 'text', content: message.conversation };
  if (message.extendedTextMessage?.text) return { type: 'text', content: message.extendedTextMessage.text };
  if (message.imageMessage) return { type: 'image', content: message.imageMessage.caption || '' };
  if (message.videoMessage) return { type: 'video', content: message.videoMessage.caption || '' };
  if (message.audioMessage) return { type: 'audio', content: '' };
  if (message.documentMessage) return { type: 'document', content: message.documentMessage.caption || '' };
  return { type: 'text', content: '' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionConnected(session, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (session?.isConnected && session?.socket) {
      return true;
    }

    if (!session?.socket && !session?.isStarting) {
      await ensureSocketConnected(session.ownerId);
    }

    await sleep(250);
  }

  return !!(session?.isConnected && session?.socket);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildQrText(qrPayload) {
  let rendered = '';
  qrcode.generate(qrPayload, { small: true }, (qrText) => {
    rendered = qrText;
  });
  return rendered;
}

function comparableJidValues(jid) {
  const value = String(jid || '').trim().toLowerCase();
  if (!value) return [];

  const [user = '', domain = ''] = value.split('@');
  const bareUser = user.split(':')[0];
  const values = new Set([value]);

  if (user) values.add(user);
  if (bareUser) values.add(bareUser);
  if (domain && bareUser) values.add(`${bareUser}@${domain}`);

  return Array.from(values).filter(Boolean);
}

function getSessionIdentitySet(session) {
  const values = new Set();
  const candidates = [
    session?.socket?.user?.id,
    session?.socket?.user?.lid,
    session?.socket?.authState?.creds?.me?.id,
    session?.socket?.authState?.creds?.me?.lid,
  ];

  for (const candidate of candidates) {
    for (const comparable of comparableJidValues(candidate)) {
      values.add(comparable);
    }
  }

  return values;
}

function isGroupAdminParticipant(participant = {}) {
  return participant?.admin === 'admin' || participant?.admin === 'superadmin' || participant?.isAdmin === true;
}

function isGroupSuperAdminParticipant(participant = {}) {
  return participant?.admin === 'superadmin' || participant?.isSuperAdmin === true;
}

function summarizeGroupParticipant(participant = {}) {
  const memberJid = String(participant?.id || participant?.jid || participant?.lid || '');
  const rawPhone = String(participant?.phoneNumber || participant?.pn || '');
  const memberDigits = normalizePhone(fromJid(memberJid));
  const normalizedPhone = normalizePhone(fromJid(rawPhone)) || null;
  const safePhone = memberJid.endsWith('@lid') && normalizedPhone === memberDigits ? null : normalizedPhone;
  return {
    jid: memberJid,
    phoneNumber: safePhone,
    isAdmin: isGroupAdminParticipant(participant),
    isSuperAdmin: isGroupSuperAdminParticipant(participant),
  };
}

async function resolveParticipantPhone(session, participant = {}) {
  const directPhone = normalizePhone(fromJid(participant?.phoneNumber || participant?.pn || ''));
  const memberJid = String(participant?.id || participant?.jid || participant?.lid || '');
  const memberDigits = normalizePhone(fromJid(memberJid));
  if (directPhone && !(memberJid.endsWith('@lid') && directPhone === memberDigits)) {
    return directPhone;
  }

  if (!memberJid || !memberJid.endsWith('@lid')) {
    return null;
  }

  try {
    const mapped = await session?.socket?.signalRepository?.lidMapping?.getPNForLID?.(memberJid);
    return normalizePhone(fromJid(mapped || '')) || null;
  } catch (error) {
    logger.warn({ ownerId: session?.ownerId, memberJid, error: error.message }, 'Failed to resolve LID participant phone');
    return null;
  }
}

async function hydrateGroupSummary(session, metadata, summary) {
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const members = await Promise.all(participants.map(async (participant) => {
    const base = summarizeGroupParticipant(participant);
    const resolvedPhone = await resolveParticipantPhone(session, participant);
    return {
      ...base,
      phoneNumber: resolvedPhone || base.phoneNumber,
    };
  }));

  return {
    ...summary,
    members,
  };
}

function buildGroupSummary(metadata, session) {
  const identities = getSessionIdentitySet(session);
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const botParticipant = participants.find((participant) => {
    const jid = participant?.id || participant?.jid || participant?.lid;
    return comparableJidValues(jid).some((value) => identities.has(value));
  });

  return {
    jid: String(metadata?.id || ''),
    subject: String(metadata?.subject || metadata?.name || metadata?.id || ''),
    participantCount: participants.length,
    botIsMember: !!botParticipant,
    botIsAdmin: !!botParticipant && isGroupAdminParticipant(botParticipant),
    members: participants.map((participant) => summarizeGroupParticipant(participant)),
  };
}

async function getGroupMetadata(session, groupJid, forceRefresh = false) {
  if (!session?.socket || !groupJid) return null;

  const cached = session.groupMetadataCache.get(groupJid);
  if (!forceRefresh && cached && Date.now() - cached.updatedAt < GROUP_METADATA_TTL_MS) {
    return cached.metadata;
  }

  try {
    const metadata = await session.socket.groupMetadata(groupJid);
    session.groupMetadataCache.set(groupJid, { metadata, updatedAt: Date.now() });
    return metadata;
  } catch (error) {
    logger.warn({ ownerId: session.ownerId, groupJid, error: error.message }, 'Failed to load WhatsApp group metadata');
    return cached?.metadata || null;
  }
}

async function listSessionGroups(session, forceRefresh = false) {
  if (!session?.socket || !session.isConnected) return [];

  if (!forceRefresh && session.groupsCache.groups.length && Date.now() - session.groupsCache.updatedAt < GROUP_LIST_TTL_MS) {
    return session.groupsCache.groups;
  }

  try {
    const rawGroups = await session.socket.groupFetchAllParticipating();
    const groups = await Promise.all(Object.values(rawGroups || {}).map(async (metadata) => {
      const summary = buildGroupSummary(metadata, session);
      return hydrateGroupSummary(session, metadata, summary);
    }));
    const sortedGroups = groups
      .filter((group) => group?.jid)
      .sort((a, b) => a.subject.localeCompare(b.subject));

    session.groupsCache = { groups: sortedGroups, updatedAt: Date.now() };
    for (const metadata of Object.values(rawGroups || {})) {
      if (metadata?.id) {
        session.knownGroupJids.add(metadata.id);
        session.groupMetadataCache.set(metadata.id, { metadata, updatedAt: Date.now() });
      }
    }

    if (sortedGroups.length) {
      return sortedGroups;
    }
  } catch (error) {
    logger.warn({ ownerId: session.ownerId, error: error.message }, 'Failed to fetch full WhatsApp group list');
  }

  const fallbackGroups = await Promise.all(
    Array.from(session.knownGroupJids).map(async (groupJid) => {
      const metadata = await getGroupMetadata(session, groupJid);
      if (!metadata) {
        return {
          jid: groupJid,
          subject: groupJid,
          participantCount: 0,
          botIsMember: true,
          botIsAdmin: false,
        };
      }

      const summary = buildGroupSummary(metadata, session);
      return hydrateGroupSummary(session, metadata, summary);
    })
  );

  const groups = fallbackGroups
    .filter((group) => group?.jid)
    .sort((a, b) => a.subject.localeCompare(b.subject));

  session.groupsCache = { groups, updatedAt: Date.now() };
  return groups;
}

async function getGroupContext(session, key = {}) {
  const remoteJid = key.remoteJid || key.remoteJidAlt || '';
  if (!isGroupJid(remoteJid)) {
    return {
      isGroup: false,
      groupJid: null,
      groupSubject: null,
      participantJid: key.participant || key.participantAlt || null,
      botIsAdmin: false,
    };
  }

  const metadata = await getGroupMetadata(session, remoteJid);
  const summary = metadata ? buildGroupSummary(metadata, session) : null;
  session.groupsCache.updatedAt = 0;

  return {
    isGroup: true,
    groupJid: remoteJid,
    groupSubject: summary?.subject || remoteJid,
    participantJid: key.participant || key.participantAlt || null,
    botIsAdmin: !!summary?.botIsAdmin,
  };
}

function rememberGroupJids(session, chats = []) {
  for (const chat of chats) {
    const groupJid = typeof chat === 'string' ? chat : chat?.id;
    if (!isGroupJid(groupJid)) continue;
    session.knownGroupJids.add(groupJid);
  }

  if (chats.length) {
    session.groupsCache.updatedAt = 0;
  }
}

function getOrCreateSession(ownerId) {
  const owner = normalizeOwnerId(ownerId);
  const existing = sessions.get(owner);
  if (existing) return existing;

  const sessionId = sessionIdForOwner(owner);
  const localPath = path.join(AUTH_ROOT, sessionId);
  const authDir = path.join(localPath, 'session');
  const qrFile = path.join(QR_OUTPUT_DIR, `whatsapp-qr-${sessionId}.txt`);

  const session = {
    ownerId: owner,
    sessionId,
    localPath,
    authDir,
    qrFile,
    socket: null,
    sessionStore: null,
    isConnected: false,
    isStarting: false,
    isResettingSession: false,
    backupTimer: null,
    latestQrPayload: null,
    groupMetadataCache: new Map(),
    groupsCache: { groups: [], updatedAt: 0 },
    knownGroupJids: new Set(),
  };

  sessions.set(owner, session);
  return session;
}

function cleanupQrFile(session) {
  try {
    session.latestQrPayload = null;
    if (fs.existsSync(session.qrFile)) {
      fs.unlinkSync(session.qrFile);
    }
  } catch (_error) {
    // ignore cleanup errors
  }
}

function writeQrFile(session, qrPayload) {
  const qrText = buildQrText(qrPayload);
  const output = [
    '='.repeat(50),
    '  Scan this QR code with WhatsApp',
    `  Session: ${session.sessionId}`,
    `  Owner: ${session.ownerId}`,
    `  Generated: ${new Date().toISOString()}`,
    '='.repeat(50),
    '',
    qrText,
    '',
    '='.repeat(50),
  ].join('\n');

  fs.mkdirSync(QR_OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(session.qrFile, output, 'utf8');
  session.latestQrPayload = qrPayload;

  console.log('\n' + '='.repeat(50));
  console.log(`  Scan this QR code with WhatsApp (${session.ownerId}):`);
  console.log('='.repeat(50));
  console.log(qrText);
  console.log(`\nQR code saved to: ${session.qrFile}\n`);
}

async function forwardToPython(endpoint, data, ownerId) {
  try {
    const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NextHello-User': ownerId,
      },
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
          ownerId,
          response: payload,
        },
        'Python API returned non-2xx response for inbound forward'
      );
    }

    return payload;
  } catch (error) {
    logger.error({ error: error.message, ownerId }, 'Failed to forward to Python API');
    return null;
  }
}

async function initSessionStore(session) {
  if (session.sessionStore) {
    await session.sessionStore.close();
    session.sessionStore = null;
  }

  if (!DATABASE_URL) {
    logger.info({ ownerId: session.ownerId }, 'DATABASE_URL not set - using local auth state only');
    return;
  }

  session.sessionStore = new PostgresSessionStore({
    connectionString: DATABASE_URL,
    sessionId: session.sessionId,
    ownerId: session.ownerId,
    localPath: session.localPath,
    logger,
  });

  await session.sessionStore.init();

  const remote = await session.sessionStore.getRemoteSessionInfo();
  if (remote.exists) {
    const restored = await session.sessionStore.restore();
    if (!restored && !session.sessionStore.hasLocalSession()) {
      logger.info({ ownerId: session.ownerId }, 'Remote restore unavailable and no local session; QR required');
    }
  } else if (!session.sessionStore.hasLocalSession()) {
    logger.info({ ownerId: session.ownerId }, 'No remote or local session found; QR required');
  }
}

function scheduleBackup(session) {
  if (!session.sessionStore) return;

  if (session.backupTimer) {
    clearTimeout(session.backupTimer);
  }

  session.backupTimer = setTimeout(async () => {
    try {
      await session.sessionStore.backup();
    } catch (error) {
      logger.error({ error: error.message, ownerId: session.ownerId }, 'Session backup failed');
    }
  }, 3000);
}

async function simulateTypingPresence(session, jid, text = '') {
  if (!session.socket || !session.isConnected) return;

  const estimated = Math.round(String(text || '').length * TYPING_MS_PER_CHAR);
  const delayMs = clamp(estimated, TYPING_MIN_DELAY_MS, TYPING_MAX_DELAY_MS);

  try {
    await session.socket.sendPresenceUpdate('composing', jid);
    await sleep(delayMs);
  } finally {
    try {
      await session.socket.sendPresenceUpdate('paused', jid);
    } catch (_error) {
      // ignore presence cleanup failure
    }
  }
}

async function simulateRecordingPresence(session, jid, audioBytes = 0) {
  if (!session.socket || !session.isConnected) return;

  const estimated = Math.round((audioBytes / 1024) * RECORDING_MS_PER_KB);
  const delayMs = clamp(estimated, RECORDING_MIN_DELAY_MS, RECORDING_MAX_DELAY_MS);

  try {
    await session.socket.sendPresenceUpdate('recording', jid);
    await sleep(delayMs);
  } finally {
    try {
      await session.socket.sendPresenceUpdate('paused', jid);
    } catch (_error) {
      // ignore presence cleanup failure
    }
  }
}

async function ensureSocketConnected(ownerId) {
  const session = getOrCreateSession(ownerId);

  if (session.socket && session.isConnected) {
    return session;
  }

  if (session.isStarting) {
    return session;
  }

  if (session.socket && !session.isConnected) {
    try {
      session.socket.ws?.close();
    } catch (_error) {
      // ignore close errors before reconnecting
    }
    session.socket = null;
  }

  session.isStarting = true;
  try {
    fs.mkdirSync(session.authDir, { recursive: true });
    await initSessionStore(session);

    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
    const { version } = await fetchLatestBaileysVersion();

    session.socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS('Desktop'),
      printQRInTerminal: false,
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'trace' }),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    session.socket.ev.process(async (events) => {
      logger.info(
        {
          ownerId: session.ownerId,
          eventKeys: Object.keys(events || {}),
          events: serializeForLog(events || {}),
        },
        'Baileys event batch'
      );
    });

    session.socket.ev.on('creds.update', async () => {
      await saveCreds();
      scheduleBackup(session);
    });

    session.socket.ev.on('chats.set', ({ chats }) => {
      rememberGroupJids(session, chats || []);
    });

    session.socket.ev.on('chats.upsert', (chats) => {
      rememberGroupJids(session, chats || []);
    });

    session.socket.ev.on('chats.update', (chats) => {
      rememberGroupJids(session, chats || []);
    });

    session.socket.ev.on('messages.update', (updates) => {
      rememberGroupJids(session, (updates || []).map((update) => ({ id: update?.key?.remoteJid })));
    });

    session.socket.ev.on('message-receipt.update', (updates) => {
      rememberGroupJids(session, (updates || []).map((update) => ({ id: update?.key?.remoteJid })));
    });

    session.socket.ev.on('groups.update', (groups) => {
      rememberGroupJids(session, groups || []);
    });

    session.socket.ev.on('group-participants.update', (update) => {
      rememberGroupJids(session, update?.id ? [{ id: update.id }] : []);
    });

    session.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        writeQrFile(session, qr);
      }

      if (connection === 'open') {
        session.isConnected = true;
        cleanupQrFile(session);
        logger.info({ ownerId: session.ownerId, sessionId: session.sessionId }, 'Connected to WhatsApp');
        scheduleBackup(session);
      }

      if (connection === 'close') {
        session.isConnected = false;
        session.knownGroupJids.clear();
        session.groupsCache = { groups: [], updatedAt: 0 };
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          { ownerId: session.ownerId, sessionId: session.sessionId, statusCode, shouldReconnect },
          'WhatsApp disconnected'
        );

        if (shouldReconnect && !session.isResettingSession) {
          session.socket = null;
          setTimeout(() => {
            ensureSocketConnected(session.ownerId).catch((error) => {
              logger.error({ error: error.message, ownerId: session.ownerId }, 'Reconnect failed');
            });
          }, 2000);
        }
      }
    });

    session.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !Array.isArray(messages)) return;

      for (const msg of messages) {
        if (!msg?.key || msg.key.fromMe) continue;

        const groupContext = await getGroupContext(session, msg.key);

        const phoneNumber = extractPhoneFromMessageKey(msg.key);
        if (!phoneNumber) {
          logger.warn({ ownerId: session.ownerId, key: serializeForLog(msg.key) }, 'Skipping inbound message with no phone number');
          continue;
        }

        if (groupContext.isGroup && !groupContext.botIsAdmin) {
          logger.info(
            {
              ownerId: session.ownerId,
              phoneNumber,
              groupJid: groupContext.groupJid,
              groupSubject: groupContext.groupSubject,
              participantJid: groupContext.participantJid,
            },
            'Inbound group message observed by non-admin session; forwarding for shared moderation handling'
          );
        }

        const { type: messageType, content } = extractMessageDetails(msg.message || {});
        const messageId = msg.key.id || `${Date.now()}`;
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
                reuploadRequest: session.socket.updateMediaMessage,
              }
            );

            if (audioBuffer) {
              audioBase64 = Buffer.from(audioBuffer).toString('base64');
              audioMimeType = msg.message?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
            }
          } catch (error) {
            logger.warn(
              {
                ownerId: session.ownerId,
                phoneNumber,
                messageId,
                error: error.message,
              },
              'Failed to download inbound audio for transcription'
            );
          }
        }

        try {
          await session.socket.readMessages([msg.key]);
        } catch (error) {
          logger.warn(
            {
              ownerId: session.ownerId,
              phoneNumber,
              messageId,
              error: error.message,
            },
            'Failed to mark inbound message as read'
          );
        }

        const result = await forwardToPython(
          '/whatsapp/message',
          {
            phone_number: phoneNumber,
            message_id: messageId,
            message_type: messageType,
            content,
            audio_base64: audioBase64,
            audio_mime_type: audioMimeType,
            push_name: msg.pushName || null,
            media_id: null,
            chat_jid: msg.key.remoteJid || msg.key.remoteJidAlt || null,
            is_group: groupContext.isGroup,
            group_jid: groupContext.groupJid,
            group_subject: groupContext.groupSubject,
            participant_jid: groupContext.participantJid,
            bot_is_group_admin: groupContext.botIsAdmin,
          },
          session.ownerId
        );

        if (result?.response && session.socket) {
          try {
            const replyJid = msg.key.remoteJid || msg.key.remoteJidAlt || toJid(phoneNumber);
            await simulateTypingPresence(session, replyJid, String(result.response));
            await session.socket.sendMessage(replyJid, { text: String(result.response) }, { quoted: msg });
          } catch (error) {
            logger.error({ error: error.message, ownerId: session.ownerId }, 'Failed to send auto-reply');
          }
        }
      }
    });
  } finally {
    session.isStarting = false;
  }

  return session;
}

async function resetSession(ownerId) {
  const session = getOrCreateSession(ownerId);
  session.isResettingSession = true;

  try {
    if (session.backupTimer) {
      clearTimeout(session.backupTimer);
      session.backupTimer = null;
    }

    try {
      session.socket?.ws?.close();
    } catch (_error) {
      // ignore close errors
    }

    session.socket = null;
    session.isConnected = false;
    session.knownGroupJids.clear();
    session.groupMetadataCache.clear();
    session.groupsCache = { groups: [], updatedAt: 0 };
    cleanupQrFile(session);

    if (session.sessionStore) {
      await session.sessionStore.delete();
      await session.sessionStore.close();
      session.sessionStore = null;
    }

    if (fs.existsSync(session.authDir)) {
      fs.rmSync(session.authDir, { recursive: true, force: true });
    }
    fs.mkdirSync(session.authDir, { recursive: true });

    await ensureSocketConnected(session.ownerId);
    return true;
  } catch (error) {
    logger.error({ error: error.message, ownerId: session.ownerId }, 'Failed to reset WhatsApp session');
    return false;
  } finally {
    session.isResettingSession = false;
  }
}

async function convertAudioToWhatsAppVoice(audioBuffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-voice-'));
  const inputPath = path.join(tempDir, 'input.bin');
  const outputPath = path.join(tempDir, 'output.ogg');

  try {
    fs.writeFileSync(inputPath, audioBuffer);

    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-c:a',
      'libopus',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-b:a',
      '32k',
      '-vbr',
      'on',
      '-application',
      'voip',
      outputPath,
    ]);

    return fs.readFileSync(outputPath);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_error) {
      // ignore cleanup errors
    }
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

function sessionStatus(session) {
  return {
    ownerId: session.ownerId,
    sessionId: session.sessionId,
    connected: session.isConnected,
    postgresConfigured: !!session.sessionStore,
    hasLocal: session.sessionStore?.hasLocalSession() ?? fs.existsSync(session.authDir),
    qrAvailable: fs.existsSync(session.qrFile),
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-NextHello-User');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const ownerFromUrl = parseOwnerFromUrl(req.url);

  if (req.method === 'GET' && req.url.startsWith('/health')) {
    const session = await ensureSocketConnected(ownerFromUrl);
    sendJson(res, 200, {
      status: 'ok',
      ...sessionStatus(session),
      activeSessions: Array.from(sessions.values()).filter((item) => item.isConnected).length,
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/qr')) {
    const session = await ensureSocketConnected(ownerFromUrl);
    const hasQr = fs.existsSync(session.qrFile);
    sendJson(res, 200, {
      ownerId: session.ownerId,
      sessionId: session.sessionId,
      available: hasQr,
      connected: session.isConnected,
      qrPayload: hasQr ? session.latestQrPayload : null,
      qrText: hasQr ? fs.readFileSync(session.qrFile, 'utf8') : null,
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/session/status')) {
    const session = await ensureSocketConnected(ownerFromUrl);
    const remote = session.sessionStore
      ? await session.sessionStore.getRemoteSessionInfo()
      : { exists: false, format: null };

    sendJson(res, 200, {
      ownerId: session.ownerId,
      sessionId: session.sessionId,
      hasLocal: session.sessionStore?.hasLocalSession() ?? fs.existsSync(session.authDir),
      hasRemote: remote.exists,
      remoteFormat: remote.format,
      postgresConfigured: !!session.sessionStore,
      connected: session.isConnected,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/session/reset') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const success = await resetSession(ownerId);
      sendJson(res, success ? 200 : 500, {
        success,
        ownerId,
        message: success ? 'Session reset; scan new QR to connect.' : 'Failed to reset session',
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/session/backup') {
    const body = await parseJsonBody(req).catch(() => ({}));
    const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
    const session = await ensureSocketConnected(ownerId);

    if (!session.sessionStore) {
      sendJson(res, 400, { error: 'PostgreSQL not configured' });
      return;
    }

    const success = await session.sessionStore.backup();
    sendJson(res, success ? 200 : 500, { success, ownerId });
    return;
  }

  if (req.method === 'POST' && req.url === '/session/restore') {
    const body = await parseJsonBody(req).catch(() => ({}));
    const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
    const session = await ensureSocketConnected(ownerId);

    if (!session.sessionStore) {
      sendJson(res, 400, { error: 'PostgreSQL not configured' });
      return;
    }

    const success = await session.sessionStore.restore();
    sendJson(res, success ? 200 : 500, {
      success,
      ownerId,
      message: success ? 'Session restored. Restart not required.' : 'No session to restore',
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/groups')) {
    const session = getOrCreateSession(ownerFromUrl);
    const groups = session.socket && session.isConnected
      ? await listSessionGroups(session)
      : session.groupsCache.groups;

    sendJson(res, 200, {
      ownerId: session.ownerId,
      count: groups.length,
      groups,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const to = body?.to;
      const message = body?.message;

      if (!to || !message) {
        sendJson(res, 400, { error: 'Missing "to" or "message" field' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      const connected = await waitForSessionConnected(session);
      if (!session.socket || !connected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      const jid = toJid(to);
      await simulateTypingPresence(session, jid, String(message));
      const sendResult = await session.socket.sendMessage(jid, { text: String(message) });
      const messageId = sendResult?.key?.id || null;

      sendJson(res, 200, {
        success: true,
        ownerId,
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
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const to = body?.to;
      const audioPath = body?.audioPath;
      const audioBase64 = body?.audioBase64;
      const mimeType = body?.mimeType;

      if (!to || (!audioPath && !audioBase64)) {
        sendJson(res, 400, { error: 'Missing "to" or audio data' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      const connected = await waitForSessionConnected(session);
      if (!session.socket || !connected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      const jid = toJid(to);
      const audioBuffer = audioPath ? fs.readFileSync(audioPath) : Buffer.from(audioBase64, 'base64');
      const voiceBuffer = await convertAudioToWhatsAppVoice(audioBuffer);

      await simulateRecordingPresence(session, jid, voiceBuffer.length);

      const sendResult = await session.socket.sendMessage(jid, {
        audio: voiceBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      });

      sendJson(res, 200, {
        success: true,
        ownerId,
        to: jid,
        messageId: sendResult?.key?.id || null,
        inputMimeType: mimeType || null,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to send voice message');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/delete') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const to = String(body?.to || '').trim();
      const messageId = String(body?.messageId || '').trim();

      if (!to || !messageId) {
        sendJson(res, 400, { error: 'Missing "to" or "messageId" field' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      const connected = await waitForSessionConnected(session);
      if (!session.socket || !connected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      const jid = to.includes('@') ? to : toJid(to);
      await session.socket.sendMessage(jid, {
        delete: {
          remoteJid: jid,
          fromMe: true,
          id: messageId,
        },
      });

      sendJson(res, 200, {
        success: true,
        ownerId,
        to: jid,
        messageId,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to delete message');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/group/delete') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const groupJid = String(body?.groupJid || '').trim();
      const participantJid = String(body?.participantJid || '').trim();
      const messageId = String(body?.messageId || '').trim();

      if (!groupJid || !participantJid || !messageId) {
        sendJson(res, 400, { error: 'Missing "groupJid", "participantJid", or "messageId" field' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      const connected = await waitForSessionConnected(session);
      if (!session.socket || !connected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      await session.socket.sendMessage(groupJid, {
        delete: {
          remoteJid: groupJid,
          fromMe: false,
          id: messageId,
          participant: participantJid,
        },
      });

      sendJson(res, 200, {
        success: true,
        ownerId,
        groupJid,
        participantJid,
        messageId,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to delete group message');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/group/warn') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const groupJid = String(body?.groupJid || '').trim();
      const participantJid = String(body?.participantJid || '').trim();
      const warningText = String(body?.warningText || '').trim();

      if (!groupJid || !participantJid || !warningText) {
        sendJson(res, 400, { error: 'Missing "groupJid", "participantJid", or "warningText" field' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      const connected = await waitForSessionConnected(session);
      if (!session.socket || !connected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      const mentionLabel = mentionLabelForParticipant(participantJid);
      const normalizedText = warningText.includes(`@${mentionLabel}`)
        ? warningText
        : `@${mentionLabel} ${warningText}`;

      const sendResult = await session.socket.sendMessage(groupJid, {
        text: normalizedText,
        mentions: [participantJid],
      });

      sendJson(res, 200, {
        success: true,
        ownerId,
        groupJid,
        participantJid,
        messageId: sendResult?.key?.id || null,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to warn group participant');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/group/remove') {
    try {
      const body = await parseJsonBody(req);
      const ownerId = normalizeOwnerId(body?.ownerId || ownerFromUrl);
      const groupJid = String(body?.groupJid || '').trim();
      const participantJid = String(body?.participantJid || '').trim();

      if (!groupJid || !participantJid) {
        sendJson(res, 400, { error: 'Missing "groupJid" or "participantJid" field' });
        return;
      }

      const session = await ensureSocketConnected(ownerId);
      if (!session.socket || !session.isConnected) {
        sendJson(res, 503, { error: 'WhatsApp is not connected', ownerId });
        return;
      }

      await session.socket.groupParticipantsUpdate(groupJid, [participantJid], 'remove');

      sendJson(res, 200, {
        success: true,
        ownerId,
        groupJid,
        participantJid,
        via: 'baileys',
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to remove group participant');
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

async function shutdown() {
  logger.info('Shutting down WhatsApp connector');

  for (const session of sessions.values()) {
    if (session.backupTimer) {
      clearTimeout(session.backupTimer);
      session.backupTimer = null;
    }

    if (session.sessionStore) {
      await session.sessionStore.backup();
      await session.sessionStore.close();
      session.sessionStore = null;
    }
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function main() {
  console.log('Starting WhatsApp connector (Baileys)...');
  console.log(`Python API: ${PYTHON_API_URL}`);
  console.log(`Default Session ID: ${DEFAULT_SESSION_ID}`);
  console.log(`Default Owner: ${normalizeOwnerId(DEFAULT_OWNER_ID)}`);
  console.log(`PostgreSQL: ${DATABASE_URL ? 'configured' : 'not configured'}`);

  await ensureSocketConnected(DEFAULT_OWNER_ID);

  server.listen(HTTP_PORT, () => {
    console.log(`HTTP API listening on port ${HTTP_PORT}`);
  });
}

main().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Failed to start');
  process.exit(1);
});

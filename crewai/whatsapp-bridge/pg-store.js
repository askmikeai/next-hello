/**
 * PostgreSQL Session Store for Baileys auth state
 *
 * Backs up and restores WhatsApp sessions to/from PostgreSQL.
 * Works with multi-file auth state under ./auth_state/session.
 * Backs up after credential updates and restores on startup.
 *
 * Benefits:
 * - Works in cloud environments
 * - Sessions survive container rebuilds
 * - Portable across environments
 * - Standard database backup/restore
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const { Pool } = pg;

function normalizeOwnerId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return 'askmikeai-gmail.com';
  return candidate.replace(/[^a-z0-9._-]/g, '-').slice(0, 80) || 'askmikeai-gmail.com';
}

export class PostgresSessionStore {
  constructor(options = {}) {
    this.pool = new Pool({
      connectionString: options.connectionString || process.env.DATABASE_URL,
      ssl: options.ssl !== undefined ? options.ssl :
           (process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false),
    });
    this.sessionId = options.sessionId || 'default';
    this.ownerId = normalizeOwnerId(
      options.ownerId || process.env.NEXTHELLO_SYSTEM_OWNER_ID || process.env.NEXTHELLO_DEFAULT_OWNER_ID
    );
    this.localPath = options.localPath || './auth_state';
    this.sessionFormat = 'baileys-multifile-v1';
    this.logger = options.logger || console;
  }

  /**
   * Initialize - ensure table exists
   */
  async init() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
          owner_id TEXT NOT NULL,
          session_id TEXT PRIMARY KEY,
          session_data TEXT NOT NULL,
          session_format TEXT DEFAULT 'unknown',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        ALTER TABLE whatsapp_sessions
        ADD COLUMN IF NOT EXISTS owner_id TEXT
      `);

      await client.query(
        `UPDATE whatsapp_sessions SET owner_id = $1 WHERE owner_id IS NULL OR owner_id = ''`,
        [this.ownerId]
      );

      await client.query(`
        ALTER TABLE whatsapp_sessions
        ALTER COLUMN owner_id SET NOT NULL
      `);

      await client.query(`
        ALTER TABLE whatsapp_sessions
        ADD COLUMN IF NOT EXISTS session_format TEXT DEFAULT 'unknown'
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_owner_session
        ON whatsapp_sessions(owner_id, session_id)
      `);

      this.logger.info({ sessionId: this.sessionId }, 'PostgreSQL session store initialized');
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to initialize session store');
    } finally {
      client.release();
    }
  }

  /**
   * Check if session exists in database
   */
  async hasRemoteSession() {
    try {
      const result = await this.pool.query(
        'SELECT 1 FROM whatsapp_sessions WHERE owner_id = $1 AND session_id = $2',
        [this.ownerId, this.sessionId]
      );
      return result.rows.length > 0;
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to check remote session');
      return false;
    }
  }

  /**
   * Get remote session metadata
   */
  async getRemoteSessionInfo() {
    try {
      const result = await this.pool.query(
        'SELECT session_format, updated_at FROM whatsapp_sessions WHERE owner_id = $1 AND session_id = $2',
        [this.ownerId, this.sessionId]
      );

      if (result.rows.length === 0) {
        return { exists: false, format: null, updatedAt: null };
      }

      return {
        exists: true,
        format: result.rows[0].session_format || 'unknown',
        updatedAt: result.rows[0].updated_at,
      };
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to fetch remote session metadata');
      return { exists: false, format: null, updatedAt: null };
    }
  }

  /**
   * Check if local session exists
   */
  hasLocalSession() {
    const sessionPath = path.join(this.localPath, 'session');
    const credsPath = path.join(sessionPath, 'creds.json');
    return fs.existsSync(sessionPath) && fs.existsSync(credsPath);
  }

  /**
   * Backup local session to PostgreSQL
   * Compresses the session directory and stores as base64
   */
  async backup() {
    const sessionPath = path.join(this.localPath, 'session');
    const credsPath = path.join(sessionPath, 'creds.json');

    if (!fs.existsSync(sessionPath) || !fs.existsSync(credsPath)) {
      this.logger.warn('No valid Baileys session to backup (missing creds.json)');
      return false;
    }

    try {
      // Create tarball of session directory
      const tarFile = '/tmp/wa-session.tar.gz';
      execSync(`tar -czf ${tarFile} -C ${this.localPath} session`, { stdio: 'pipe' });

      // Read and encode
      const tarData = fs.readFileSync(tarFile);
      const base64Data = tarData.toString('base64');

      // Store in PostgreSQL
      await this.pool.query(`
        INSERT INTO whatsapp_sessions (owner_id, session_id, session_data, session_format, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (session_id)
        DO UPDATE SET owner_id = EXCLUDED.owner_id, session_data = EXCLUDED.session_data, session_format = EXCLUDED.session_format, updated_at = NOW()
      `, [this.ownerId, this.sessionId, base64Data, this.sessionFormat]);

      // Cleanup
      fs.unlinkSync(tarFile);

      this.logger.info({
        sessionId: this.sessionId,
        format: this.sessionFormat,
        size: `${(base64Data.length / 1024 / 1024).toFixed(2)}MB`
      }, 'Session backed up to PostgreSQL');

      return true;
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to backup session');
      return false;
    }
  }

  /**
   * Restore session from PostgreSQL to local filesystem
   */
  async restore() {
    try {
      const result = await this.pool.query(
        'SELECT session_data, session_format, updated_at FROM whatsapp_sessions WHERE owner_id = $1 AND session_id = $2',
        [this.ownerId, this.sessionId]
      );

      if (result.rows.length === 0) {
        this.logger.info('No remote session to restore');
        return false;
      }

      const { session_data, session_format, updated_at } = result.rows[0];

      if (session_format !== this.sessionFormat) {
        this.logger.warn(
          { expected: this.sessionFormat, actual: session_format || 'unknown' },
          'Remote session format is incompatible with Baileys'
        );
        return false;
      }

      // Decode and extract
      const tarData = Buffer.from(session_data, 'base64');
      const tarFile = '/tmp/wa-session.tar.gz';
      fs.writeFileSync(tarFile, tarData);

      // Ensure local path exists
      if (!fs.existsSync(this.localPath)) {
        fs.mkdirSync(this.localPath, { recursive: true });
      }

      // Extract tarball
      execSync(`tar -xzf ${tarFile} -C ${this.localPath}`, { stdio: 'pipe' });

      // Cleanup
      fs.unlinkSync(tarFile);

      this.logger.info({
        sessionId: this.sessionId,
        format: session_format,
        restoredFrom: updated_at
      }, 'Session restored from PostgreSQL');

      return true;
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to restore session');
      return false;
    }
  }

  /**
   * Delete session from PostgreSQL
   */
  async delete() {
    try {
      await this.pool.query(
        'DELETE FROM whatsapp_sessions WHERE owner_id = $1 AND session_id = $2',
        [this.ownerId, this.sessionId]
      );
      this.logger.info({ sessionId: this.sessionId }, 'Session deleted from PostgreSQL');
      return true;
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to delete session');
      return false;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

export default PostgresSessionStore;

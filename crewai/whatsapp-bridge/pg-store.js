/**
 * PostgreSQL Session Store for whatsapp-web.js
 *
 * Backs up and restores WhatsApp sessions to/from PostgreSQL.
 * Works alongside LocalAuth - backs up after authentication,
 * restores on startup if local session is missing.
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

export class PostgresSessionStore {
  constructor(options = {}) {
    this.pool = new Pool({
      connectionString: options.connectionString || process.env.DATABASE_URL,
      ssl: options.ssl !== undefined ? options.ssl :
           (process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false),
    });
    this.sessionId = options.sessionId || 'default';
    this.localPath = options.localPath || './auth_state';
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
          session_id TEXT PRIMARY KEY,
          session_data TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
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
        'SELECT 1 FROM whatsapp_sessions WHERE session_id = $1',
        [this.sessionId]
      );
      return result.rows.length > 0;
    } catch (err) {
      this.logger.error({ error: err.message }, 'Failed to check remote session');
      return false;
    }
  }

  /**
   * Check if local session exists
   */
  hasLocalSession() {
    const sessionPath = path.join(this.localPath, 'session');
    return fs.existsSync(sessionPath);
  }

  /**
   * Backup local session to PostgreSQL
   * Compresses the session directory and stores as base64
   */
  async backup() {
    const sessionPath = path.join(this.localPath, 'session');

    if (!fs.existsSync(sessionPath)) {
      this.logger.warn('No local session to backup');
      return false;
    }

    try {
      // Remove lock files before backup
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lock of lockFiles) {
        const lockPath = path.join(sessionPath, lock);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      }

      // Create tarball of session directory
      const tarFile = '/tmp/wa-session.tar.gz';
      execSync(`tar -czf ${tarFile} -C ${this.localPath} session`, { stdio: 'pipe' });

      // Read and encode
      const tarData = fs.readFileSync(tarFile);
      const base64Data = tarData.toString('base64');

      // Store in PostgreSQL
      await this.pool.query(`
        INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (session_id)
        DO UPDATE SET session_data = $2, updated_at = NOW()
      `, [this.sessionId, base64Data]);

      // Cleanup
      fs.unlinkSync(tarFile);

      this.logger.info({
        sessionId: this.sessionId,
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
        'SELECT session_data, updated_at FROM whatsapp_sessions WHERE session_id = $1',
        [this.sessionId]
      );

      if (result.rows.length === 0) {
        this.logger.info('No remote session to restore');
        return false;
      }

      const { session_data, updated_at } = result.rows[0];

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

      // Remove lock files after restore
      const sessionPath = path.join(this.localPath, 'session');
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lock of lockFiles) {
        const lockPath = path.join(sessionPath, lock);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      }

      // Cleanup
      fs.unlinkSync(tarFile);

      this.logger.info({
        sessionId: this.sessionId,
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
        'DELETE FROM whatsapp_sessions WHERE session_id = $1',
        [this.sessionId]
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

import { Router } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Receives client-side logs from the Mini App (which has no DevTools/F12).
 * The frontend batches console output, network calls and runtime errors into a
 * ring buffer and POSTs them here; we re-emit each entry into the server log
 * stream (correlated by sessionId) so they show up in Render/log drains, and
 * keep a small server-side buffer retrievable by admins for on-demand triage.
 *
 * Mounted WITHOUT auth so it works even during a pre-login crash. The admin
 * view of the buffer lives under the authenticated /api/debug routes.
 */

const LEVEL_MAP: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

const CLIENT_LOG_MAX = 2000;
const MAX_DATA_SIZE = 1024;

// Server-side ring buffer of the most recent client log entries.
const clientLogBuffer: Array<{
  t: number;
  level: string;
  sessionId: string;
  userId: string;
  msg: string;
  data?: unknown;
}> = [];

export function getClientLogBuffer() {
  return clientLogBuffer.slice();
}

// Strip HTML-breaking characters to prevent stored XSS when admins view
// client log entries via the debug UI.
function sanitizeString(value: unknown): string {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .slice(0, 2000);
}

// Truncate data payload to prevent memory exhaustion.
function sanitizeData(data: unknown): unknown {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return data.slice(0, MAX_DATA_SIZE);
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  try {
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_DATA_SIZE) {
      return JSON.parse(serialized.slice(0, MAX_DATA_SIZE) + '{}');
    }
    return data;
  } catch {
    return '[unserializable]';
  }
}

const router = Router();

router.post('/log', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = sanitizeString(body.sessionId || 'unknown');
    const userId = sanitizeString(body.userId || 'unknown');
    const appVersion = sanitizeString(body.appVersion || 'unknown');
    const entries = Array.isArray(body.entries) ? body.entries : [];

    for (const e of entries) {
      const level = LEVEL_MAP[e?.level] || 'info';
      const msg = `[client ${sessionId} u:${userId} v:${appVersion}] ${sanitizeString(e?.scope || '?')}: ${sanitizeString(e?.msg || '')}`;
      const data = sanitizeData(e?.data);
      // Mirror into the server log stream.
      logger[level]({ clientSession: sessionId, clientUser: userId }, msg, data);
      clientLogBuffer.push({ t: e?.t || Date.now(), level, sessionId, userId, msg, data });
    }
    if (clientLogBuffer.length > CLIENT_LOG_MAX) {
      clientLogBuffer.splice(0, clientLogBuffer.length - CLIENT_LOG_MAX);
    }
    res.json({ ok: true });
  } catch {
    // Never let a bad log payload break the app.
    res.status(400).json({ ok: false, error: 'bad payload' });
  }
});

export default router;

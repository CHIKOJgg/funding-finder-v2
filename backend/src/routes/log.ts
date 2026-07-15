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

// Server-side ring buffer of the most recent client log entries.
const clientLogBuffer: any[] = [];
const CLIENT_LOG_MAX = 2000;

export function getClientLogBuffer() {
  return clientLogBuffer.slice();
}

const router = Router();

router.post('/log', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : 'unknown';
    const userId = body.userId || 'unknown';
    const appVersion = body.appVersion || 'unknown';
    const entries = Array.isArray(body.entries) ? body.entries : [];

    for (const e of entries) {
      const level = LEVEL_MAP[e?.level] || 'info';
      const msg = `[client ${sessionId} u:${userId} v:${appVersion}] ${e?.scope || '?'}: ${e?.msg || ''}`;
      const data = e?.data;
      // Mirror into the server log stream.
      logger[level]({ clientSession: sessionId, clientUser: userId }, msg, data);
      clientLogBuffer.push({ t: e?.t || Date.now(), level, sessionId, userId, msg, data });
    }
    if (clientLogBuffer.length > CLIENT_LOG_MAX) {
      clientLogBuffer.splice(0, clientLogBuffer.length - CLIENT_LOG_MAX);
    }
    res.json({ ok: true });
  } catch (err) {
    // Never let a bad log payload break the app.
    res.status(400).json({ ok: false, error: 'bad payload' });
  }
});

export default router;

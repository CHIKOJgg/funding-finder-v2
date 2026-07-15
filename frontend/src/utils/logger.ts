/**
 * Client-side logger for environments without DevTools (Telegram Mini App).
 *
 * - Buffers everything in memory + localStorage (ring buffer) so it survives
 *   reloads and can be read on-device via the DebugLog overlay (?debug=1).
 * - Forwards batched logs to the backend (/api/log) where they land in the
 *   server logs / Sentry, correlated by a stable session id.
 * - Wraps console.* and captures window errors / unhandled rejections so that
 *   any "invisible" failure becomes visible.
 *
 * Best-effort everywhere: a failed flush or missing storage never throws.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  t: number;
  level: Level;
  scope: string;
  msg: string;
  data?: unknown;
}

const STORAGE_KEY = 'ff_log_buffer';
const SESSION_KEY = 'ff_session';
const MAX = 400;

function loadBuffer(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LogEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function apiBase(): string {
  const v = import.meta.env.VITE_API_URL as string | undefined;
  return v ? `${v.replace(/\/$/, '')}/api` : '/api';
}

let buffer: LogEntry[] = loadBuffer();
let sessionId =
  localStorage.getItem(SESSION_KEY) || Math.random().toString(36).slice(2, 10);
localStorage.setItem(SESSION_KEY, sessionId);

let userId: string | null = null;
const appVersion =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || 'dev';

const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sentIndex = 0;
let consoleWrapped = false;

function safe(data: unknown): unknown {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(
      JSON.stringify(data, (_k, v) => (typeof v === 'function' ? undefined : v))
    );
  } catch {
    return String(data);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    /* ignore quota errors */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function push(level: Level, scope: string, msg: string, data?: unknown) {
  const entry: LogEntry = { t: Date.now(), level, scope, msg, data: safe(data) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  persist();
  emit();
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 1500);
}

async function flush() {
  flushTimer = null;
  if (sentIndex > buffer.length) sentIndex = 0;
  const unsent = buffer.slice(sentIndex);
  if (unsent.length === 0) return;
  const payload = { sessionId, userId, appVersion, entries: unsent };
  try {
    if (typeof fetch !== 'function') return;
    await fetch(`${apiBase()}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    sentIndex = buffer.length;
  } catch {
    // Keep unsent; next scheduled flush will retry.
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(safe(a));
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

export const logger = {
  setUser(id: string | null) {
    userId = id;
  },
  debug(scope: string, msg: string, data?: unknown) {
    push('debug', scope, msg, data);
  },
  info(scope: string, msg: string, data?: unknown) {
    push('info', scope, msg, data);
  },
  warn(scope: string, msg: string, data?: unknown) {
    push('warn', scope, msg, data);
  },
  error(scope: string, msg: string, data?: unknown) {
    push('error', scope, msg, data);
  },
  /** Mark a lifecycle moment with a high-resolution timestamp (perf tracing). */
  mark(scope: string, msg: string, data?: unknown) {
    push('info', scope, msg, data);
  },
  getBuffer(): LogEntry[] {
    return buffer.slice();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  clear() {
    buffer = [];
    sentIndex = 0;
    persist();
    emit();
  },
  flush,
};

function installGlobalLogging() {
  if (consoleWrapped || typeof window === 'undefined') return;
  consoleWrapped = true;
  const orig = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  const wrap =
    (level: Level, origFn: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      origFn(...args);
      push(level, 'console', formatArgs(args));
    };
  console.log = wrap('debug', orig.log);
  console.info = wrap('debug', orig.info);
  console.debug = wrap('debug', orig.debug);
  console.warn = wrap('warn', orig.warn);
  console.error = wrap('error', orig.error);

  window.addEventListener('error', (e) =>
    push('error', 'window', e.message, {
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack,
    })
  );
  window.addEventListener('unhandledrejection', (e) =>
    push('error', 'promise', 'Unhandled rejection', e.reason)
  );
}

// Activate global capture as soon as this module is imported.
installGlobalLogging();

export default logger;

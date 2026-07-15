import { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { logger } from '../utils/logger';

/**
 * On-device log viewer for the Telegram Mini App (no DevTools / F12 there).
 *
 * Reads the in-memory + localStorage ring buffer maintained by
 * `utils/logger.ts`, which already captures console.*, window errors and
 * unhandled rejections. This component just makes that buffer visible and
 * lets you copy it or push it to the backend (/api/log) for server-side
 * correlation.
 *
 * Open it with `?debug=1` in the URL, or by long-pressing the floating
 * bug button. In a Telegram mini app, open the bot/deep-link with
 * `?debug=1` appended.
 */
export function DebugLog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState(() => logger.getBuffer());
  const [autoscroll, setAutoscroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setEntries(logger.getBuffer());
    const unsub = logger.subscribe(() => setEntries(logger.getBuffer()));
    return unsub;
  }, [open]);

  useEffect(() => {
    if (autoscroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoscroll]);

  const copy = useCallback(async () => {
    const text = entries
      .map((e) => `${new Date(e.t).toISOString()} [${e.level}] ${e.scope} ${e.msg}` +
        (e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be blocked in some webviews; ignore */
    }
  }, [entries]);

  const send = useCallback(async () => {
    await logger.flush();
  }, []);

  if (!open) return null;

  const colors: Record<string, string> = {
    debug: '#888',
    info: '#4ade80',
    warn: '#fbbf24',
    error: '#f87171',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        color: '#e5e7eb',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'monospace',
        fontSize: 11,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #333', alignItems: 'center' }}>
        <strong style={{ color: '#60a5fa' }}>Debug Log ({entries.length})</strong>
        <button style={btn} onClick={copy}>Copy</button>
        <button style={btn} onClick={send}>Send↗</button>
        <button style={btn} onClick={() => logger.clear()}>Clear</button>
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          auto
        </label>
        <button style={{ ...btn, color: '#f87171' }} onClick={onClose}>✕</button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entries.length === 0 && <div style={{ color: '#666' }}>No logs yet.</div>}
        {entries.map((e, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            <span style={{ color: '#666' }}>{new Date(e.t).toLocaleTimeString()}</span>{' '}
            <span style={{ color: colors[e.level] || '#ccc' }}>[{e.level}]</span>{' '}
            <span style={{ color: '#93c5fd' }}>{e.scope}</span>{' '}
            <span>{e.msg}</span>
            {e.data !== undefined && (
              <span style={{ color: '#9ca3af' }}> {JSON.stringify(e.data)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  background: '#1f2937',
  color: '#e5e7eb',
  border: '1px solid #374151',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

/** Small floating toggle so the overlay can be opened from inside a mini app. */
export function DebugToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      aria-label="Open debug log"
      onClick={onOpen}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 70,
        zIndex: 9998,
        width: 34,
        height: 34,
        borderRadius: '50%',
        background: 'rgba(31,41,55,0.85)',
        color: '#fbbf24',
        border: '1px solid #374151',
        fontSize: 16,
        cursor: 'pointer',
      }}
    >
      🐞
    </button>
  );
}

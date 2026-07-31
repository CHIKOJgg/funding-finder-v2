import { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { logger } from '../utils/logger';
import { IconBug, IconX } from './icons';

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
    debug: 'var(--text3)',
    info: 'var(--green)',
    warn: 'var(--amber)',
    error: 'var(--red)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--text)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'monospace',
        fontSize: 11,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <strong style={{ color: 'var(--cobalt-text)' }}>Debug Log ({entries.length})</strong>
        <button style={btn} onClick={copy}>Copy</button>
        <button style={btn} onClick={send}>Send</button>
        <button style={btn} onClick={() => logger.clear()}>Clear</button>
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} style={{ accentColor: 'var(--cobalt)' }} />
          auto
        </label>
        <button style={{ ...btn, color: 'var(--red)', padding: 4 }} onClick={onClose} aria-label="Close debug log">
          <IconX size={12} />
        </button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entries.length === 0 && <div style={{ color: 'var(--text3)' }}>No logs yet.</div>}
        {entries.map((e, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            <span style={{ color: 'var(--text3)' }}>{new Date(e.t).toLocaleTimeString()}</span>{' '}
            <span style={{ color: colors[e.level] || 'var(--text2)' }}>[{e.level}]</span>{' '}
            <span style={{ color: 'var(--cobalt-text)' }}>{e.scope}</span>{' '}
            <span>{e.msg}</span>
            {e.data !== undefined && (
              <span style={{ color: 'var(--text2)' }}> {JSON.stringify(e.data)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  background: 'var(--card)',
  color: 'var(--text)',
  border: '1px solid var(--border-2)',
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
        background: 'var(--bg1)',
        color: 'var(--amber)',
        border: '1px solid var(--border-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <IconBug size={18} />
    </button>
  );
}

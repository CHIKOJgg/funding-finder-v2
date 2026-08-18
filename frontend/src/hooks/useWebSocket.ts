import { useEffect, useRef, useCallback } from 'react';

type MessageHandler = (data: any) => void;

/**
 * Resolve the WebSocket base URL.
 * Must be a secure (wss://) URL when the page itself is served over HTTPS,
 * otherwise the browser throws a SecurityError (mixed content) when
 * constructing the WebSocket. We derive it from VITE_WS_URL, then VITE_API_URL,
 * then finally the current origin.
 */
function resolveWsBase(): string {
  const ensureWsPath = (base: string): string => {
    const trimmed = base.replace(/^http/, 'ws').replace(/\/$/, '');
    return trimmed.endsWith('/ws') ? trimmed : `${trimmed}/ws`;
  };

  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return ensureWsPath(explicit);

  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) return ensureWsPath(apiUrl);

  const secure = window.location.protocol === 'https:';
  const proto = secure ? 'wss:' : 'ws:';
  // Same-origin fallback; the backend WebSocket server listens on `/ws`.
  return `${proto}//${window.location.host}/ws`;
}

const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 30000;

export function useWebSocket(auth: { initData?: string | null; token?: string | null } | null, handlers?: {
  onScan?: MessageHandler;
  onAlertTriggered?: MessageHandler;
  onNewSpread?: MessageHandler;
  onLiveFunding?: MessageHandler;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const handlersRef = useRef(handlers);
  const authRef = useRef(auth);
  const mountedRef = useRef(true);
  const backoffRef = useRef(0);

  // Keep latest handlers without forcing reconnects on every render.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // Track the latest auth credentials so a reconnect after a token refresh
  // picks them up without re-creating the effect.
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const { initData, token } = authRef.current || {};
    if (!initData && !token) return;

    // Never stack sockets: the mount effect and the auth-change effect can
    // both fire connect() for the same credentials.
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    let ws: WebSocket;
    try {
      const wsBase = resolveWsBase();
      // Connect without auth tokens in URL to prevent leakage via server
      // logs, Referer headers, or browser history. Auth is sent as the
      // first message after the connection opens.
      ws = new WebSocket(wsBase);
    } catch (err) {
      // Constructing a WebSocket can throw synchronously (e.g. insecure ws://
      // from an https page). Never let this crash the app — just retry later.
      console.warn('[WS] Failed to open connection:', err);
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, backoffRef.current), MAX_RECONNECT_DELAY_MS);
      backoffRef.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
      return;
    }

    ws.onopen = () => {
      backoffRef.current = 0;
      // Authenticate via the first message instead of URL query params.
      try {
        if (initData) {
          ws.send(JSON.stringify({ type: 'auth', initData }));
        } else if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        } else {
          // Dev mode: send empty auth (server falls back to dev_ws_ id)
          ws.send(JSON.stringify({ type: 'auth' }));
        }
      } catch {
        // If sending auth fails, the server will close with 4001.
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'broadcast' && msg.channel === 'scan') {
          handlersRef.current?.onScan?.(msg.data);
        } else if (msg.type === 'alert_triggered') {
          handlersRef.current?.onAlertTriggered?.(msg.data);
        } else if (msg.type === 'new_spread') {
          handlersRef.current?.onNewSpread?.(msg.data);
        } else if (msg.type === 'broadcast' && msg.channel === 'funding') {
          handlersRef.current?.onLiveFunding?.(msg.data);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      if (wsRef.current !== ws) return; // a newer socket already owns the slot
      // 4001 = auth rejected. There is no refresh-token flow, so retrying
      // with the same stale credentials just burns connections forever — stop.
      if (event.code === 4001) return;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, backoffRef.current), MAX_RECONNECT_DELAY_MS);
      backoffRef.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [connect]);

  // Reconnect when the auth credentials CHANGE. The connect effect above runs
  // once at mount, when a web user is not yet authenticated — without this,
  // the socket would never open after a fresh web login (Google/wallet/email).
  const authKey = auth?.initData || auth?.token || '';
  useEffect(() => {
    if (authKey) {
      connect();
    } else {
      // Logged out: drop any stale socket and stop reconnect attempts.
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
        wsRef.current = null;
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey]);

  return wsRef;
}

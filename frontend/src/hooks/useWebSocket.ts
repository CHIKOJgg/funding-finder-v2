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
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit.replace(/^http/, 'ws');

  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) {
    // https://host -> wss://host, http://host -> ws://host
    return apiUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  }

  const secure = window.location.protocol === 'https:';
  const proto = secure ? 'wss:' : 'ws:';
  // Same-origin fallback (no explicit port; assumes reverse-proxied /ws)
  return `${proto}//${window.location.host}`;
}

export function useWebSocket(initData: string | null, handlers?: {
  onScan?: MessageHandler;
  onAlertTriggered?: MessageHandler;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const handlersRef = useRef(handlers);

  // Keep latest handlers without forcing reconnects on every render.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const connect = useCallback(() => {
    if (!initData) return;

    let ws: WebSocket;
    try {
      const wsUrl = `${resolveWsBase()}/ws?initData=${encodeURIComponent(initData)}`;
      ws = new WebSocket(wsUrl);
    } catch (err) {
      // Constructing a WebSocket can throw synchronously (e.g. insecure ws://
      // from an https page). Never let this crash the app — just retry later.
      console.warn('[WS] Failed to open connection:', err);
      reconnectTimer.current = setTimeout(connect, 10000);
      return;
    }

    ws.onopen = () => {
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'broadcast' && msg.channel === 'scan') {
          handlersRef.current?.onScan?.(msg.data);
        } else if (msg.type === 'alert_triggered') {
          handlersRef.current?.onAlertTriggered?.(msg.data);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 5s...');
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    wsRef.current = ws;
  }, [initData]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [connect]);

  return wsRef;
}

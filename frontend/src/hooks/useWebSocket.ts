import { useEffect, useRef, useCallback } from 'react';

type MessageHandler = (data: any) => void;

const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3000`;

export function useWebSocket(initData: string | null, handlers?: {
  onScan?: MessageHandler;
  onAlertTriggered?: MessageHandler;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (!initData) return;
    const wsUrl = `${WS_BASE}/ws?initData=${encodeURIComponent(initData)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'broadcast' && msg.channel === 'scan') {
          handlers?.onScan?.(msg.data);
        } else if (msg.type === 'alert_triggered') {
          handlers?.onAlertTriggered?.(msg.data);
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
      ws.close();
    };

    wsRef.current = ws;
  }, [initData, handlers]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}

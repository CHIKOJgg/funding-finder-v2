import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { validateTelegramInitDataSync } from '../middleware/auth.js';
import { verifyAuthToken } from '../services/authService.js';
import { logger } from '../utils/logger.js';

export interface WSClient {
  ws: WebSocket;
  userId: string;
  subscriptions: Set<string>;
  lastPong: number;
}

const VALID_CHANNELS = new Set(['scan', 'alerts', 'funding']);

// New connections must authenticate within this window.
const AUTH_TIMEOUT_MS = 5_000;

// DoS guards: cap total live sockets and per-IP connections.
const MAX_TOTAL_CONNECTIONS = 500;
const MAX_PER_IP = 20;

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WSClient>();
  private byIp = new Map<string, Set<WebSocket>>();
  private wsIp = new WeakMap<WebSocket, string>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  init(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Heartbeat to detect stale connections. The server must actively send
    // protocol-level pings: browsers auto-answer with pong frames, which is
    // what updates lastPong. Without the ping() call every connection would
    // be force-terminated after 60s (the old behaviour — clients never sent
    // app-level {type:'ping'} messages).
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, userId) => {
        try {
          if (client.ws.readyState !== WebSocket.OPEN) return;
          client.ws.ping();
        } catch {
          // socket already closing — let the timeout sweep it
        }
        if (Date.now() - client.lastPong > 60_000) {
          logger.debug(`WebSocket heartbeat timeout for ${userId}`);
          try { client.ws.terminate(); } catch { /* already gone */ }
          this.removeClient(userId, client.ws);
        }
      });
    }, 30_000);

    logger.info('WebSocket server initialized');
  }

  private connectionIp(req: IncomingMessage): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  private removeClient(userId: string, ws: WebSocket): void {
    // Only remove the map entry if it still points at THIS socket — the old
    // socket's close handler must never delete the replacement connection
    // registered by a duplicate-login reconnect.
    const current = this.clients.get(userId);
    if (current && current.ws === ws) {
      this.clients.delete(userId);
    }
  }

  private untrackIp(ip: string, ws: WebSocket): void {
    const set = this.byIp.get(ip);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.byIp.delete(ip);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = this.connectionIp(req);
    const perIp = this.byIp.get(ip) || new Set<WebSocket>();
    if (this.clients.size >= MAX_TOTAL_CONNECTIONS || perIp.size >= MAX_PER_IP) {
      ws.close(1013, 'Too many connections');
      return;
    }
    perIp.add(ws);
    this.byIp.set(ip, perIp);
    this.wsIp.set(ws, ip);
    ws.on('error', () => { /* prevent unhandled 'error' crash */ });

    try {
      let authenticated = false;
      let userId: string | null = null;

      // Message-based auth only. The legacy ?initData=/?token= query path was
      // removed — it echoed bearer secrets into server access logs, and no
      // current client uses it.

      // Message-based auth: client sends { type: "auth", initData: "..." } or
      // { type: "auth", token: "..." } as the first message within AUTH_TIMEOUT_MS.
      const authTimer = setTimeout(() => {
        if (!authenticated) {
          ws.close(4001, 'Authentication timeout');
        }
      }, AUTH_TIMEOUT_MS);

      const onFirstMessage = (data: Buffer) => {
        ws.removeListener('message', onFirstMessage);
        clearTimeout(authTimer);

        try {
          const msg = JSON.parse(data.toString());
          if (msg.type !== 'auth') {
            ws.close(4001, 'Expected auth message');
            return;
          }

          if (msg.initData) {
            const validated = validateTelegramInitDataSync(msg.initData);
            if (!validated) {
              ws.close(4001, 'Invalid authentication');
              return;
            }
            userId = validated.userId;
          } else if (msg.token) {
            const payload = verifyAuthToken(msg.token);
            if (!payload) {
              ws.close(4001, 'Invalid authentication');
              return;
            }
            userId = payload.sub;
          } else if (process.env.NODE_ENV === 'development') {
            // Dev mode fallback
            userId = `dev_ws_${Date.now()}`;
          } else {
            ws.close(4001, 'Authentication required');
            return;
          }

          authenticated = true;
          this.registerClient(ws, userId);
        } catch {
          ws.close(4001, 'Invalid auth message');
        }
      };

      ws.on('message', onFirstMessage);
    } catch (err) {
      logger.error({ err }, 'WebSocket connection error');
      ws.close(4002, 'Connection error');
    }
  }

  private registerClient(ws: WebSocket, userId: string): void {
    const client: WSClient = {
      ws,
      userId,
      subscriptions: new Set(['scan', 'alerts', 'funding']),
      lastPong: Date.now(),
    };

    // Close existing connection for same user before replacing
    const existing = this.clients.get(userId);
    if (existing) {
      logger.debug(`WebSocket replacing existing connection for ${userId}`);
      try { existing.ws.terminate(); } catch { /* already gone */ }
    }

    this.clients.set(userId, client);

    ws.on('pong', () => {
      client.lastPong = Date.now();
    });

    ws.on('message', (data) => {
      this.handleMessage(client, data.toString());
    });

    ws.on('close', () => {
      this.removeClient(userId, ws);
      const ipOf = this.wsIp.get(ws);
      if (ipOf) this.untrackIp(ipOf, ws);
      logger.debug(`WebSocket disconnected: ${userId}`);
    });

    ws.on('error', (err) => {
      logger.error({ err, userId }, 'WebSocket error');
      this.removeClient(userId, ws);
      const ipOf = this.wsIp.get(ws);
      if (ipOf) this.untrackIp(ipOf, ws);
    });

    this.send(ws, {
      type: 'connected',
      userId,
      subscriptions: Array.from(client.subscriptions),
    });

    logger.info(`WebSocket connected: ${userId}`);
  }

  private handleMessage(client: WSClient, raw: string): void {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case 'subscribe':
          if (msg.channel && typeof msg.channel === 'string' && VALID_CHANNELS.has(msg.channel)) {
            client.subscriptions.add(msg.channel);
            this.send(client.ws, { type: 'subscribed', channel: msg.channel });
          } else if (msg.channel) {
            this.send(client.ws, { type: 'error', message: `Invalid channel: ${msg.channel}` });
          }
          break;

        case 'unsubscribe':
          if (msg.channel) {
            client.subscriptions.delete(msg.channel);
            this.send(client.ws, { type: 'unsubscribed', channel: msg.channel });
          }
          break;

        case 'ping':
          client.lastPong = Date.now();
          this.send(client.ws, { type: 'pong', timestamp: Date.now() });
          break;

        default:
          this.send(client.ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    } catch {
      this.send(client.ws, { type: 'error', message: 'Invalid message format' });
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Broadcast to all subscribed clients
  broadcast(channel: string, data: any): void {
    const message = JSON.stringify({ type: 'broadcast', channel, data, timestamp: Date.now() });
    this.clients.forEach((client) => {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        // A socket that died mid-send must never take down the caller (scan
        // routes broadcast outside try/catch).
        try {
          client.ws.send(message);
        } catch {
          // skip dead socket; heartbeat will sweep it
        }
      }
    });
  }

  // Send to specific user
  sendToUser(userId: string, data: any): void {
    const client = this.clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        this.send(client.ws, data);
      } catch {
        /* skip dead socket */
      }
    }
  }

  // Get connected user count
  get connectedCount(): number {
    return this.clients.size;
  }

  // Get stats
  getStats(): { connected: number; channels: Record<string, number> } {
    const channels: Record<string, number> = {};
    this.clients.forEach((client) => {
      client.subscriptions.forEach((ch) => {
        channels[ch] = (channels[ch] || 0) + 1;
      });
    });
    return { connected: this.clients.size, channels };
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client) => client.ws.terminate());
    this.clients.clear();
    this.wss?.close();
  }
}

export const wsManager = new WebSocketManager();

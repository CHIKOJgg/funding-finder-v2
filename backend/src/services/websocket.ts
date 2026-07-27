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

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WSClient>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  init(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Heartbeat to detect stale connections
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, userId) => {
        if (Date.now() - client.lastPong > 60_000) {
          logger.debug(`WebSocket heartbeat timeout for ${userId}`);
          client.ws.terminate();
          this.clients.delete(userId);
        }
      });
    }, 30_000);

    logger.info('WebSocket server initialized');
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    try {
      let authenticated = false;
      let userId: string | null = null;

      // Legacy path: allow auth via URL query params (backward compat with
      // older clients). New clients should use message-based auth.
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const initData = url.searchParams.get('initData');
        const token = url.searchParams.get('token');

        if (initData) {
          const validated = validateTelegramInitDataSync(initData);
          if (validated) {
            authenticated = true;
            userId = validated.userId;
          }
        } else if (token) {
          const payload = verifyAuthToken(token);
          if (payload) {
            authenticated = true;
            userId = payload.sub;
          }
        }
      } catch { /* URL parsing failed — proceed to message-based auth */ }

      if (authenticated && userId) {
        this.registerClient(ws, userId);
        return;
      }

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
      existing.ws.terminate();
    }

    this.clients.set(userId, client);

    ws.on('pong', () => {
      client.lastPong = Date.now();
    });

    ws.on('message', (data) => {
      this.handleMessage(client, data.toString());
    });

    ws.on('close', () => {
      this.clients.delete(userId);
      logger.debug(`WebSocket disconnected: ${userId}`);
    });

    ws.on('error', (err) => {
      logger.error({ err, userId }, 'WebSocket error');
      this.clients.delete(userId);
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
        client.ws.send(message);
      }
    });
  }

  // Send to specific user
  sendToUser(userId: string, data: any): void {
    const client = this.clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      this.send(client.ws, data);
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

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { logger } from '../utils/logger.js';

// Create a Registry
export const register = new Registry();

// Collect default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const scanRequestsTotal = new Counter({
  name: 'scan_requests_total',
  help: 'Total number of scan requests',
  labelNames: ['exchange', 'status'],
  registers: [register],
});

export const scanDuration = new Histogram({
  name: 'scan_duration_seconds',
  help: 'Duration of scan operations in seconds',
  labelNames: ['exchange'],
  buckets: [1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

export const alertsTriggered = new Counter({
  name: 'alerts_triggered_total',
  help: 'Total number of alerts triggered',
  labelNames: ['type', 'exchange'],
  registers: [register],
});

export const activeWebSocketConnections = new Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

export const activeUsers = new Gauge({
  name: 'active_users_total',
  help: 'Number of active users',
  registers: [register],
});

export const exchangeDataAge = new Gauge({
  name: 'exchange_data_age_seconds',
  help: 'Age of exchange data in seconds',
  labelNames: ['exchange'],
  registers: [register],
});

// Middleware to track HTTP metrics
export function metricsMiddleware(req: any, res: any, next: any) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status: res.statusCode.toString(),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
}

// Get metrics as text
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

// Get metrics as JSON
export async function getMetricsJSON(): Promise<any> {
  return register.getMetricsAsJSON();
}

// Content type for Prometheus
export function metricsContentType(): string {
  return register.contentType;
}

logger.info('Prometheus metrics initialized');

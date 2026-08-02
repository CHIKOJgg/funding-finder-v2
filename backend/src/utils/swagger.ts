import swaggerUi from 'swagger-ui-express';
import { Express, Request, Response } from 'express';

// swagger-jsdoc pulls in vulnerable transitive deps (brace-expansion, fast-uri,
// js-yaml) and is only needed to GENERATE the spec from JSDoc comments. It is a
// devDependency: with NODE_ENV=production npm install skips devDependencies, so
// in production the spec is missing and the docs routes are skipped (docs are
// dev tooling and shouldn't be exposed publicly anyway). Types for both
// packages live in the ambient shim src/types/swagger-shim.d.ts.

type GenerateFn = (options: Record<string, unknown>) => Record<string, unknown>;

export async function setupSwagger(app: Express): Promise<void> {
  let generate: GenerateFn | undefined;
  try {
    // Dynamic require: absent in production installs (devDependency).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    generate = require('swagger-jsdoc') as GenerateFn;
  } catch {
    // Production install — no swagger-jsdoc, skip docs.
    return;
  }

  const options: Record<string, unknown> = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Funding Finder API',
        version: '2.0.0',
        description: 'API for cryptocurrency funding rate scanning, arbitrage detection, and alerts',
        contact: {
          name: 'Funding Finder',
          url: 'https://t.me/fundinganalyzerbot',
        },
      },
      servers: [
        {
          url: '/api/v1',
          description: 'Stable public API (v1) — recommended for integrators and the Telegram bot',
        },
        {
          url: '/api',
          description: 'Internal Mini App API',
        },
      ],
      components: {
        securitySchemes: {
          telegramAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-telegram-init-data',
            description: 'Telegram WebApp initData for authentication',
          },
        },
        schemas: {
          ExchangeResult: {
            type: 'object',
            properties: {
              exchange: { type: 'string', example: 'binance' },
              contract: { type: 'string', example: 'BTC-USDT' },
              currentFunding: { type: 'number', example: 0.0001 },
              funding_rate_per_hour: { type: 'number', example: 0.0000125 },
              funding_rate_per_day: { type: 'number', example: 0.0003 },
              annualized_rate: { type: 'number', example: 0.1095 },
              funding_interval_seconds: { type: 'number', example: 28800 },
              volume_24h_settle: { type: 'number', example: 1500000 },
              mark_price: { type: 'number', example: 45000 },
            },
          },
          ScanResult: {
            type: 'object',
            properties: {
              highYield: { type: 'array', items: { $ref: '#/components/schemas/ExchangeResult' } },
              mediumYield: { type: 'array', items: { $ref: '#/components/schemas/ExchangeResult' } },
              lowYield: { type: 'array', items: { $ref: '#/components/schemas/ExchangeResult' } },
              scanned: { type: 'number', example: 500 },
              metrics: { type: 'object' },
            },
          },
          GeneralAlert: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              pair: { type: 'string', example: 'BTC-USDT' },
              exchange: { type: 'string', example: 'binance' },
              condition: { type: 'string', enum: ['above', 'below'] },
              threshold: { type: 'number' },
              isActive: { type: 'boolean' },
              cooldown: { type: 'number' },
              lastTriggered: { type: 'string', format: 'date-time' },
              triggerCount: { type: 'number' },
            },
          },
          UserSettings: {
            type: 'object',
            properties: {
              telegramNotifications: { type: 'boolean' },
              emailNotifications: { type: 'boolean' },
              dailySummary: { type: 'boolean' },
              defaultExchanges: { type: 'array', items: { type: 'string' } },
              theme: { type: 'string', enum: ['auto', 'light', 'dark'] },
              language: { type: 'string' },
              timezone: { type: 'string' },
            },
          },
        },
      },
      tags: [
        { name: 'Scan', description: 'Exchange scanning operations' },
        { name: 'Alerts', description: 'Alert management' },
        { name: 'Analytics', description: 'Historical analytics and trends' },
        { name: 'Settings', description: 'User settings and preferences' },
        { name: 'Export', description: 'Data export operations' },
        { name: 'Arbitrage', description: 'Cross-exchange arbitrage detection and public snapshots' },
        { name: 'A/B Testing', description: 'A/B headline testing and variant promotion' },
        { name: 'Lead Capture', description: 'Waitlist and lead magnet endpoints' },
        { name: 'Health', description: 'Health check and keep-alive endpoints' },
        { name: 'B2B Webhooks', description: 'Webhook subscription management for B2B integrations' },
      ],
    },
    apis: ['./src/routes/*.ts'],
  };

  const swaggerSpec = generate(options);

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Funding Finder API Docs',
  }));

  app.get('/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Stable, versioned OpenAPI contract for external integrators (Block B2).
  // Served from the same URL space as the public API so it can be referenced
  // directly from client configs / codegen tooling.
  app.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

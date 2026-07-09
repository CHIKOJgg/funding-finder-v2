import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Funding Finder API',
      version: '2.0.0',
      description: 'API for cryptocurrency funding rate scanning, arbitrage detection, and alerts',
      contact: {
        name: 'Funding Finder',
        url: 'https://t.me/FundingFinderBot',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API server',
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
    ],
  },
  apis: ['./src/routes/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Funding Finder API Docs',
  }));

  app.get('/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

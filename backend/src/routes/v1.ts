import { Router } from 'express';

// Stable, versioned public API contract (Block B2). Re-mounts the
// consumer-facing routers under /api/v1 so external integrators and the
// standalone Telegram bot (Block B3) get a frozen, documented contract,
// decoupled from the Mini App's internal /api surface.
//
// The route handlers are the SAME instances already served at /api — only the
// URL prefix changes, so behaviour is identical. Auth is intentionally NOT
// included here: it is mounted separately at /api/v1/auth (establishing a
// session must not sit behind the global `authenticate` middleware), mirroring
// the existing /api mount pattern in index.ts.
import scanRoutes from './scan.js';
import aiRoutes from './ai.js';
import alertsRoutes from './alerts.js';
import arbitrageRoutes from './arbitrage.js';
import fundingRoutes from './funding.js';
import analyticsRoutes from './analytics.js';
import historyRoutes from './history.js';
import watchlistRoutes from './watchlist.js';
import portfolioRoutes from './portfolio.js';
import exportRoutes from './export.js';
import profileRoutes from './profile.js';
import settingsRoutes from './settings.js';
import referralsRoutes from './referrals.js';
import b2bWebhookRoutes from './b2bWebhooks.js';

const v1 = Router();

v1.use('/', scanRoutes);
v1.use('/', aiRoutes);
v1.use('/', alertsRoutes);
v1.use('/', arbitrageRoutes);
v1.use('/', fundingRoutes);
v1.use('/', analyticsRoutes);
v1.use('/', historyRoutes);
v1.use('/', watchlistRoutes);
v1.use('/', portfolioRoutes);
v1.use('/', exportRoutes);
v1.use('/', profileRoutes);
v1.use('/', settingsRoutes);
v1.use('/', referralsRoutes);
v1.use('/', b2bWebhookRoutes);

export default v1;

#!/usr/bin/env node
// Zero-cost keep-alive pinger for Render's free tier (which "sleeps" after
// inactivity and drops new users on cold start). Run this on a free external
// cron (e.g. cron-job.org, every 5–10 min) so the service stays warm.
//
//   node scripts/keepalive.js
//
// Reads the target from KEEPALIVE_URL (falls back to the deployed Render URL).
// Exits non-zero on failure so the cron provider can alert you.

const TARGET = process.env.KEEPALIVE_URL || 'https://funding-finder-backend.onrender.com';

async function ping() {
  const url = `${TARGET.replace(/\/$/, '')}/api/health`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`[keepalive] ${url} -> HTTP ${res.status}`);
      process.exit(1);
    }
    console.log(`[keepalive] ${url} -> ${res.status} OK`);
    process.exit(0);
  } catch (err) {
    console.error(`[keepalive] ${url} -> ERROR: ${(err && err.message) || err}`);
    process.exit(1);
  }
}

ping();

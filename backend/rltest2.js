const express = require('express');
const erl = require('express-rate-limit');
const rateLimit = erl.default || erl;
const request = require('supertest');

class MyStore {
  constructor() { this.hits = {}; }
  init() {}
  incr(key) {
    this.hits[key] = (this.hits[key] || 0) + 1;
    console.log('INCR', key, this.hits[key]);
    return Promise.resolve([this.hits[key], Date.now() + 1000]);
  }
  decrement(key) { this.hits[key] = Math.max(0, (this.hits[key] || 0) - 1); }
  reset() { this.hits = {}; }
  resetKey(key) { delete this.hits[key]; }
}

const app = express();
const lim = rateLimit({
  windowMs: 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MyStore(),
  keyGenerator: (req) => req.userId || 'ip',
});
app.get('/x', lim, (req, res) => res.json({ ok: true }));

(async () => {
  for (let i = 0; i < 5; i++) {
    const r = await request(app).get('/x').set('x-user', 'u1');
    console.log('iter', i, 'status', r.status);
  }
  console.log('DONE');
})();

/**
 * Tests for src/services/aiService.ts
 *
 * Mocks axios entirely; exercises every branch via the two public exports
 * (askAI / askAIForTop3): free-model discovery (cache hit/miss/failure/
 * :free filtering), model resolution ordering + dedupe, and the chat
 * completion fallback chain (success / empty content / error / 429).
 */
import { installMockAxios, prismaMock } from './testkit';

jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));
jest.mock('../utils/logger.js');

let axiosMock = installMockAxios();

// aiService caches free models in a module-level singleton. Re-require the
// module under test in each test (after resetModules) so the cache starts cold
// and config overrides are picked up fresh. resetModules also gives aiService a
// FRESH `axios` instance, so after re-installing the mock we rebind its
// `get`/`post` onto that fresh axios — otherwise the tests would configure a
// stale mock that aiService no longer references.
function loadAi() {
  jest.resetModules();
  const fresh = installMockAxios();
  // aiService does `import axios from 'axios'`, i.e. the DEFAULT export; its
  // `axios.post`/`axios.get` are `module.exports.default.*`. After resetModules
  // that default is a fresh instance, so bind our mock fns onto it.
  const ax = require('axios');
  // Bind onto whatever surface aiService's `import axios from 'axios'` resolves
  // to (it varies with the __esModule interop: either `ax` or `ax.default`).
  for (const surf of [ax, ax.default].filter(Boolean)) {
    surf.get = fresh.get;
    surf.post = fresh.post;
  }
  axiosMock = fresh;
  const ai = require('../services/aiService.js');
  const cfg = require('../config/index.js').config;
  return { ai, cfg };
}

describe('aiService', () => {
  it('askAI returns a config note when no API key is set', async () => {
    const { ai, cfg } = loadAi();
    const saved = cfg.ai.openrouterApiKey;
    cfg.ai.openrouterApiKey = '';
    try {
      const res = await ai.askAI([{ role: 'user', content: 'hi' }]);
      expect(res.text).toBeNull();
      expect(res.note).toMatch(/OPENROUTER_API_KEY/);
    } finally {
      cfg.ai.openrouterApiKey = saved;
    }
  });

  it('askAI returns text from the first working model (discovery + cache)', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = [];
    axiosMock.get.mockImplementation(async () => ({
      data: { data: [{ id: 'discovered:free', pricing: { prompt: '0', completion: '0', request: '0' } }] },
    }));
    axiosMock.post.mockImplementation(async () => ({
      data: { choices: [{ message: { content: 'AI says buy' } }] },
    }));
    const res = await ai.askAI([{ role: 'user', content: 'analyze' }]);
    expect(res.text).toBe('AI says buy');
    expect(res.model).toBe('discovered:free');
    expect(res.note).toBeUndefined();
  });

  it('askAI keeps only :free-suffixed ids and drops paid tiers', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['cfgpaid/model'];
    axiosMock.get.mockImplementation(async () => ({
      data: {
        data: [
          { id: 'free/model:free', pricing: { prompt: '0', completion: '0', request: '0' } },
          { id: 'paid/model', pricing: { prompt: '0.001', completion: '0', request: '0' } },
          { id: 'weird:free', pricing: null },
        ],
      },
    }));
    axiosMock.post.mockImplementation(async () => ({
      data: { choices: [{ message: { content: 'ok' } }] },
    }));
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(['free/model:free', 'weird:free']).toContain(res.model);
  });

  it('askAI trusts configured :free models when discovery fails', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['cfg/model:free'];
    axiosMock.rejectGet(new Error('network down'));
    axiosMock.post.mockImplementation(async () => ({
      data: { choices: [{ message: { content: 'cfg answer' } }] },
    }));
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.text).toBe('cfg answer');
    expect(res.model).toBe('cfg/model:free');
  });

  it('askAI orders preferred-free before discovered and dedupes', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['preferred/model:free'];
    axiosMock.get.mockImplementation(async () => ({
      data: {
        data: [
          { id: 'preferred/model:free', pricing: { prompt: '0', completion: '0', request: '0' } },
          { id: 'discovered/model:free', pricing: { prompt: '0', completion: '0', request: '0' } },
        ],
      },
    }));
    axiosMock.post.mockImplementation(async () => ({
      data: { choices: [{ message: { content: 'ordered' } }] },
    }));
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.model).toBe('preferred/model:free');
    expect(res.text).toBe('ordered');
  });

  it('askAI returns null on empty content from callModel', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['empty:free'];
    axiosMock.post.mockImplementation(async () => ({ data: { choices: [{ message: { content: '' } }] } }));
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.text).toBeNull();
  });

  it('askAI returns null when choices/message is missing', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['broken:free'];
    axiosMock.post.mockImplementation(async () => ({ data: {} }));
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.text).toBeNull();
  });

  it('askAI falls back through models and reports when all fail', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = [];
    axiosMock.get.mockImplementation(async () => ({
      data: { data: [{ id: 'a:free' }, { id: 'b:free' }, { id: 'c:free' }, { id: 'd:free' }] },
    }));
    axiosMock.post.mockImplementation(async () => { throw new Error('429 rate limit'); });
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.text).toBeNull();
    expect(res.note).toMatch(/недоступны/);
  });

  it('askAI tries the next model when one returns empty content', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = [];
    axiosMock.get.mockImplementation(async () => ({
      data: { data: [{ id: 'empty:free' }, { id: 'ok:free' }] },
    }));
    let call = 0;
    axiosMock.post.mockImplementation(async () => {
      call++;
      if (call === 1) return { data: { choices: [{ message: { content: '   ' } }] } };
      return { data: { choices: [{ message: { content: 'real answer' } }] } };
    });
    const res = await ai.askAI([{ role: 'user', content: 'x' }]);
    expect(res.text).toBe('real answer');
    expect(call).toBe(2);
  });

  it('askAIForTop3 builds the trader prompt and returns the model text', async () => {
    const { ai, cfg } = loadAi();
    cfg.ai.openrouterApiKey = 'test-key';
    cfg.ai.models = ['top:free'];
    axiosMock.post.mockImplementation(async (_url: any, body: any) => {
      const msgs = body.messages;
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].content).toContain('монет');
      return { data: { choices: [{ message: { content: 'BTC, ETH, SOL' } }] } };
    });
    const res = await ai.askAIForTop3('BTC USDT');
    expect(res.text).toBe('BTC, ETH, SOL');
  });
});

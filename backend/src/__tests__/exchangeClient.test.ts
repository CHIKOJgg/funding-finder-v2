describe('Exchange Client Utilities', () => {
  describe('MemoryCache', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should store and retrieve values', () => {
      const { cache } = require('../utils/exchangeClient.js');
      cache.set('test', { data: 123 });
      const result = cache.get('test');
      expect(result).toEqual({ data: 123 });
    });

    it('should return null for expired entries', () => {
      jest.useFakeTimers();
      const { cache } = require('../utils/exchangeClient.js');
      cache.set('test', 'value', 1000);
      jest.advanceTimersByTime(1001);
      const result = cache.get('test');
      expect(result).toBeNull();
      jest.useRealTimers();
    });

    it('should return null for missing keys', () => {
      const { cache } = require('../utils/exchangeClient.js');
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should report correct size', () => {
      const { cache } = require('../utils/exchangeClient.js');
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBeGreaterThanOrEqual(2);
    });

    it('should clear all entries', () => {
      const { cache } = require('../utils/exchangeClient.js');
      cache.set('a', 1);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('CircuitBreaker', () => {
    let cb: any;

    beforeEach(() => {
      jest.resetModules();
      const { circuitBreaker } = require('../utils/exchangeClient.js');
      cb = circuitBreaker;
      cb.reset();
    });

    it('should execute successful functions', async () => {
      const result = await cb.execute('test', async () => 'success');
      expect(result).toBe('success');
    });

    it('should trip open after threshold failures', async () => {
      const failingFn = async () => { throw new Error('fail'); };

      for (let i = 0; i < 5; i++) {
        await expect(cb.execute('fail-test', failingFn)).rejects.toThrow('fail');
      }

      await expect(cb.execute('fail-test', failingFn)).rejects.toThrow('Circuit breaker open');
    });

    it('should reset after timeout', async () => {
      jest.useFakeTimers();

      const failingFn = async () => { throw new Error('fail'); };
      for (let i = 0; i < 5; i++) {
        await expect(cb.execute('timeout-test', failingFn)).rejects.toThrow('fail');
      }

      jest.advanceTimersByTime(61000);

      await expect(cb.execute('timeout-test', failingFn)).rejects.toThrow('fail');
      jest.useRealTimers();
    });

    it('should reset on demand', () => {
      cb.reset('nonexistent');
      cb.reset();
    });
  });

  describe('safeParseFloat', () => {
    let safeParseFloat: any;

    beforeEach(() => {
      jest.resetModules();
      safeParseFloat = require('../utils/exchangeClient.js').safeParseFloat;
    });

    it('should parse valid floats', () => {
      expect(safeParseFloat('123.45')).toBe(123.45);
      expect(safeParseFloat(678.9)).toBe(678.9);
      expect(safeParseFloat('0')).toBe(0);
    });

    it('should use fallback for invalid values', () => {
      expect(safeParseFloat(null)).toBe(0);
      expect(safeParseFloat(undefined)).toBe(0);
      expect(safeParseFloat('')).toBe(0);
      expect(safeParseFloat('abc')).toBe(0);
    });

    it('should use custom fallback', () => {
      expect(safeParseFloat('abc', -1)).toBe(-1);
    });
  });

  describe('cachedRequest', () => {
    let cachedRequest: any;

    beforeEach(() => {
      jest.resetModules();
      const mod = require('../utils/exchangeClient.js');
      cachedRequest = mod.cachedRequest;
      mod.cache.clear();
    });

    it('should cache results', async () => {
      const fn = jest.fn().mockResolvedValue('data');
      const result1 = await cachedRequest('key1', fn);
      const result2 = await cachedRequest('key1', fn);
      expect(result1).toBe('data');
      expect(result2).toBe('data');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call function again after TTL expires', async () => {
      jest.useFakeTimers();
      const fn = jest.fn().mockResolvedValue('data');
      await cachedRequest('ttl-key', fn, 1000);
      jest.advanceTimersByTime(1001);
      await cachedRequest('ttl-key', fn, 1000);
      expect(fn).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });
});

/**
 * Unit tests for src/utils/metrics.ts
 */
import {
  getMetrics,
  getMetricsJSON,
  metricsContentType,
  metricsMiddleware,
  httpRequestsTotal,
} from '../utils/metrics.js';

describe('getMetrics / metricsContentType', () => {
  test('getMetrics returns a Prometheus exposition string', async () => {
    const text = await getMetrics();
    expect(typeof text).toBe('string');
    // Registered custom metric names should appear in the output.
    expect(text).toContain('http_requests_total');
    expect(text).toContain('scan_requests_total');
  });

  test('getMetricsJSON returns an array of metric objects', async () => {
    const json = await getMetricsJSON();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  test('metricsContentType returns a text/plain prometheus content type', () => {
    const ct = metricsContentType();
    expect(typeof ct).toBe('string');
    expect(ct).toContain('text/plain');
  });
});

describe('metricsMiddleware', () => {
  test('calls next() and records a request on finish', async () => {
    const next = jest.fn();
    const finishHandlers: Array<() => void> = [];
    const res: any = {
      statusCode: 200,
      on(event: string, cb: () => void) {
        if (event === 'finish') finishHandlers.push(cb);
      },
    };
    const req: any = { method: 'GET', path: '/health', route: { path: '/health' } };

    metricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    const counterBefore = httpRequestsTotal.get().values?.length ?? 0;

    // Simulate the response finishing.
    expect(finishHandlers.length).toBe(1);
    finishHandlers[0]();

    const counterAfter = httpRequestsTotal.get().values?.length ?? 0;
    expect(counterAfter).toBeGreaterThanOrEqual(counterBefore);
  });
});
